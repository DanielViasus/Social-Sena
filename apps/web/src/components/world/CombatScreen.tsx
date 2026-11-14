import { memo, useEffect, useMemo, useRef, useState } from 'react'
import {
  isCorrectCombatAnswer,
  pickCombatQuestion,
  type CombatQuestion,
} from '../../game/combat/questionCatalog'
import type { RoomEnemyTemplate } from '@social-sena/shared'
import type { WorldNpcFrameDefinition } from './WorldNpc'
import { LayeredAvatar } from './LayeredAvatar'
import { EditorLayeredAvatar } from './EditorLayeredAvatar'
import { getAnimatedEnemyFrame } from './Enemigo'
import {
  avatarAnimations,
  chapBackAnimationEquipment,
  chapBackEquipment,
  chapFrontAnimationEquipment,
  chapFrontEquipment,
} from '../../game/avatar/layeredAvatar'
import type { AssignmentDirection } from '../../game/avatar/animationAssignmentStorage'
import {
  resolveRuntimeAnimation,
  useAvatarAnimationRuntimeVersion,
} from '../../game/avatar/avatarAnimationRuntime'

// Interfaz de combate por turnos, al estilo de los JRPG clasicos.
// Por ahora solo es la interfaz: las acciones no resuelven nada todavia.
const MESSAGE_SPEED_MS = 26
// Mientras el combate esta abierto el jugador no camina por el mundo de atras.
const BLOCKED_MOVEMENT_KEYS = new Set([
  'w', 'a', 's', 'd',
  'arrowup', 'arrowdown', 'arrowleft', 'arrowright',
])

interface CombatHealth {
  current: number
  max: number
}

export type CombatSoundName = 'typing' | 'confirm' | 'cancel'

export interface CombatScenery {
  // Proporcion de la zona de vigilancia, para recortar el fondo sin deformarlo.
  aspect: number
  // Suelo que rellena lo que quede fuera de los bloques colocados.
  fillSrc?: string | null
  fillWidthPercent?: number
  fillHeightPercent?: number
  fillOffsetXPercent?: number
  fillOffsetYPercent?: number
  tiles: Array<{
    key: string
    src: string
    flippedX: boolean
    leftPercent: number
    topPercent: number
    widthPercent: number
    heightPercent: number
  }>
}

interface CombatScreenProps {
  enemyName: string
  enemyLevel: number
  enemyHealth: CombatHealth
  // Plantilla del enemigo: de ahi salen sus frames segun la fase del ataque.
  enemyTemplate?: RoomEnemyTemplate | null
  playerName: string
  playerLevel: number
  playerHealth: CombatHealth
  // Companeros de grupo que se sumaron al combate.
  allies?: Array<{ userId: string; displayName: string; level: number }>
  // Bloques del mapa que ambientan el combate.
  scenery?: CombatScenery | null
  // Sonidos del combate: cada letra del texto y la pulsacion de los botones.
  onSound?: (sound: CombatSoundName) => void
  onFlee: () => void
}

interface CombatAction {
  id: string
  label: string
  pendingMessage: string
}

// Duracion total de la secuencia de ataque; debe coincidir con las animaciones del CSS.
const ATTACK_SEQUENCE_MS = 1500
// Momentos de la secuencia, en sintonia con los fotogramas del CSS:
// avanza, llega y golpea, y vuelve a su sitio.
const ATTACK_ARRIVAL_MS = 480
const ATTACK_RETREAT_MS = 780
// Cada cuanto se revisa el frame de los sprites del combate.
const SPRITE_TICK_MS = 110

type AttackStep = 'advance' | 'strike' | 'retreat'

// Tamano del enemigo en la ventana de combate (128 px por 1,5 = 192 px).
const ENEMY_SPRITE_SCALE = 1.5

// Lo que tardan los combatientes en entrar en pantalla al abrirse el combate.
const ENTRANCE_MS = 700
// A esta distancia del rival se detiene el atacante, y esto retrocede el que recibe el golpe.
const ATTACK_GAP_PX = 180
const RECOIL_PX = 38

type CombatPhase = 'menu' | 'question' | 'attacking'

const COMBAT_ACTIONS: readonly CombatAction[] = [
  { id: 'attack', label: 'ATACAR', pendingMessage: '' },
  { id: 'skill', label: 'HABILIDAD', pendingMessage: 'Todavía no aprendiste ninguna habilidad.' },
  { id: 'items', label: 'OBJETOS', pendingMessage: 'Tu mochila todavía no sirve en combate.' },
  { id: 'flee', label: 'HUIR', pendingMessage: 'Escapaste del combate.' },
]

function getHealthLevel(health: CombatHealth) {
  const ratio = health.max > 0 ? health.current / health.max : 0
  if (ratio <= 0.2) return 'is-critical'
  if (ratio <= 0.5) return 'is-low'
  return 'is-ok'
}

function HealthBar({ health }: { health: CombatHealth }) {
  const percentage = health.max > 0 ? Math.max(0, Math.min(100, (health.current / health.max) * 100)) : 0

  return (
    <div className="combat-screen-hp">
      <span className="combat-screen-hp-label">HP</span>
      <div className="combat-screen-hp-track">
        <div
          className={`combat-screen-hp-fill ${getHealthLevel(health)}`}
          style={{ width: `${percentage}%` }}
        />
      </div>
    </div>
  )
}

function SheetSprite({ frame, scale }: { frame: WorldNpcFrameDefinition; scale: number }) {
  if (
    !frame.sheetUrl
    || typeof frame.sheetWidth !== 'number'
    || typeof frame.sheetHeight !== 'number'
    || typeof frame.frameWidth !== 'number'
    || typeof frame.frameHeight !== 'number'
    || typeof frame.row !== 'number'
    || typeof frame.column !== 'number'
  ) {
    return frame.url
      ? (
        <img
          className="combat-screen-sprite-image"
          src={frame.url}
          alt=""
          draggable={false}
          style={{ width: `${128 * scale}px`, height: `${128 * scale}px` }}
        />
      )
      : null
  }

  return (
    <div
      className="combat-screen-sheet"
      style={{
        width: `${frame.frameWidth * scale}px`,
        height: `${frame.frameHeight * scale}px`,
      }}
    >
      <img
        src={frame.sheetUrl}
        alt=""
        draggable={false}
        style={{
          width: `${frame.sheetWidth * scale}px`,
          height: `${frame.sheetHeight * scale}px`,
          left: `${-frame.column * frame.frameWidth * scale}px`,
          top: `${-frame.row * frame.frameHeight * scale}px`,
        }}
      />
    </div>
  )
}

function CombatScreenComponent({
  enemyName,
  enemyLevel,
  enemyHealth,
  enemyTemplate,
  playerName,
  playerLevel,
  playerHealth,
  allies,
  scenery,
  onSound,
  onFlee,
}: CombatScreenProps) {
  // El texto y las letras reveladas viajan juntos para reiniciar la escritura al cambiar el mensaje.
  const [messageState, setMessageState] = useState(() => ({
    text: `¡Un ${enemyName} salvaje te bloquea el paso!`,
    revealed: 0,
  }))
  const [selectedIndex, setSelectedIndex] = useState(0)
  const [phase, setPhase] = useState<CombatPhase>('menu')
  const [question, setQuestion] = useState<CombatQuestion | null>(null)
  // Quien ataca en la secuencia actual: acierto del jugador o fallo que aprovecha el enemigo.
  const [attacker, setAttacker] = useState<'player' | 'enemy' | null>(null)
  // La animacion de entrada se usa una sola vez, al abrirse el combate.
  const [isEntering, setIsEntering] = useState(true)
  const [attackStep, setAttackStep] = useState<AttackStep | null>(null)
  // Reloj propio para animar los sprites sin depender de los redibujados del mundo.
  const [spriteNow, setSpriteNow] = useState(() => performance.now())
  const runtimeVersion = useAvatarAnimationRuntimeVersion()
  useEffect(() => {
    const timer = window.setTimeout(() => setIsEntering(false), ENTRANCE_MS)
    return () => window.clearTimeout(timer)
  }, [])

  useEffect(() => {
    const interval = window.setInterval(() => setSpriteNow(performance.now()), SPRITE_TICK_MS)
    return () => window.clearInterval(interval)
  }, [])

  // Encadena los pasos del ataque para ir cambiando de animacion.
  useEffect(() => {
    if (!attacker) {
      return
    }

    const arrivalTimer = window.setTimeout(() => setAttackStep('strike'), ATTACK_ARRIVAL_MS)
    const retreatTimer = window.setTimeout(() => setAttackStep('retreat'), ATTACK_RETREAT_MS)

    return () => {
      window.clearTimeout(arrivalTimer)
      window.clearTimeout(retreatTimer)
      setAttackStep(null)
    }
  }, [attacker])

  // El avance se mide sobre la pantalla real, asi queda al lado del rival en cualquier tamano.
  const stageRef = useRef<HTMLDivElement | null>(null)
  const playerActorRef = useRef<HTMLDivElement | null>(null)
  const enemyActorRef = useRef<HTMLDivElement | null>(null)
  const onFleeRef = useRef(onFlee)
  const onSoundRef = useRef(onSound)

  useEffect(() => {
    onFleeRef.current = onFlee
  }, [onFlee])

  useEffect(() => {
    onSoundRef.current = onSound
  }, [onSound])

  // Texto que se escribe letra por letra, como en los JRPG. El temporizador se apaga al terminar.
  useEffect(() => {
    if (messageState.revealed >= messageState.text.length) {
      return
    }

    const timer = window.setTimeout(() => {
      // Un sonido por letra, saltando los espacios, como en el sistema de dialogos.
      if (messageState.text.charAt(messageState.revealed).trim().length > 0) {
        onSoundRef.current?.('typing')
      }

      setMessageState((currentState) => (
        currentState.revealed >= currentState.text.length
          ? currentState
          : { ...currentState, revealed: currentState.revealed + 1 }
      ))
    }, MESSAGE_SPEED_MS)

    return () => window.clearTimeout(timer)
  }, [messageState.revealed, messageState.text])

  const isMessageComplete = messageState.revealed >= messageState.text.length

  // Pose del jugador: de espaldas mientras avanza y golpea, de frente y hacia la izquierda
  // al volver, y de espaldas en su sitio.
  const playerAttacking = attacker === 'player'
  const playerPose = playerAttacking && attackStep === 'retreat'
    ? { view: 'f' as const, flipX: true, moving: true }
    : playerAttacking && attackStep === 'advance'
      ? { view: 'b' as const, flipX: false, moving: true }
      : { view: 'b' as const, flipX: false, moving: false }
  const playerStateId = playerPose.moving ? ('walk' as const) : ('idle' as const)
  const playerDirection: AssignmentDirection = playerPose.view === 'b'
    ? (playerPose.flipX ? 'nw' : 'ne')
    : (playerPose.flipX ? 'sw' : 'se')
  // Si hay animaciones publicadas se usan esas; si no, las del avatar clasico.
  const playerEditorAnimation = useMemo(
    () => resolveRuntimeAnimation(playerStateId, playerDirection),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [playerStateId, playerDirection, runtimeVersion],
  )
  const playerLegacyAnimation = playerPose.moving
    ? (playerPose.view === 'b' ? 'walkBack' as const : 'walkFront' as const)
    : ('idle' as const)

  // Pose del enemigo: de frente al jugador, caminando hacia el al atacar y de espaldas al volver.
  const enemyAttacking = attacker === 'enemy'
  const enemyPose = enemyAttacking && attackStep === 'retreat'
    ? { facing: 'back-right' as const, moving: true, flipX: false }
    : enemyAttacking && attackStep === 'advance'
      ? { facing: 'front-left' as const, moving: true, flipX: true }
      : enemyAttacking && attackStep === 'strike'
        ? { facing: 'front-left' as const, moving: false, flipX: true }
        : { facing: 'front-right' as const, moving: false, flipX: false }
  const enemySprite: WorldNpcFrameDefinition | null = enemyTemplate
    ? getAnimatedEnemyFrame(enemyTemplate, spriteNow, enemyPose.facing, enemyPose.moving)
    : null

  // Calcula cuanto tiene que avanzar el atacante para quedar junto al rival, y hacia donde
  // sale despedido el que recibe el golpe.
  const applyLungeDistance = (who: 'player' | 'enemy') => {
    const stage = stageRef.current
    const attackerElement = who === 'player' ? playerActorRef.current : enemyActorRef.current
    const defenderElement = who === 'player' ? enemyActorRef.current : playerActorRef.current
    if (!stage || !attackerElement || !defenderElement) {
      return
    }

    const attackerRect = attackerElement.getBoundingClientRect()
    const defenderRect = defenderElement.getBoundingClientRect()
    const deltaX = (defenderRect.left + defenderRect.width / 2) - (attackerRect.left + attackerRect.width / 2)
    const deltaY = (defenderRect.top + defenderRect.height / 2) - (attackerRect.top + attackerRect.height / 2)
    const distance = Math.hypot(deltaX, deltaY)
    if (distance < 1) {
      return
    }

    const ratio = Math.max(0, (distance - ATTACK_GAP_PX) / distance)
    stage.style.setProperty('--combat-lunge-x', `${Math.round(deltaX * ratio)}px`)
    stage.style.setProperty('--combat-lunge-y', `${Math.round(deltaY * ratio)}px`)
    stage.style.setProperty('--combat-recoil-x', `${Math.round((deltaX / distance) * RECOIL_PX)}px`)
    stage.style.setProperty('--combat-recoil-y', `${Math.round((deltaY / distance) * RECOIL_PX)}px`)
  }

  const choices = phase === 'question' && question
    ? question.options.map((option) => ({ id: option.id, label: option.label }))
    : COMBAT_ACTIONS.map((action) => ({ id: action.id, label: action.label }))

  const startQuestion = () => {
    const nextQuestion = pickCombatQuestion('facil', question?.id ?? null)
    setQuestion(nextQuestion)
    setPhase('question')
    setSelectedIndex(0)
    setMessageState({ text: nextQuestion.prompt, revealed: 0 })
  }

  const answerQuestion = (optionId: string) => {
    if (!question) {
      return
    }

    const answeredWell = isCorrectCombatAnswer(question, optionId)
    applyLungeDistance(answeredWell ? 'player' : 'enemy')
    setAttackStep('advance')
    setAttacker(answeredWell ? 'player' : 'enemy')
    setPhase('attacking')
    setSelectedIndex(0)
    setMessageState({
      text: answeredWell
        ? `¡Correcto! Atacas a ${enemyName}.`
        : `Fallaste. ¡${enemyName} aprovecha y te ataca!`,
      revealed: 0,
    })
  }

  const cancelQuestion = () => {
    onSoundRef.current?.('cancel')
    setPhase('menu')
    setSelectedIndex(0)
    setMessageState({ text: '¿Qué vas a hacer?', revealed: 0 })
  }

  const runChoice = (index: number) => {
    if (phase === 'attacking') {
      return
    }

    if (phase === 'question') {
      const option = question?.options[index]
      if (option) {
        onSoundRef.current?.('confirm')
        answerQuestion(option.id)
      }
      return
    }

    const action = COMBAT_ACTIONS[index]
    if (!action) {
      return
    }

    if (action.id === 'flee') {
      onSoundRef.current?.('cancel')
      onFleeRef.current()
      return
    }

    onSoundRef.current?.('confirm')

    if (action.id === 'attack') {
      startQuestion()
      return
    }

    setMessageState({ text: action.pendingMessage, revealed: 0 })
  }

  // Al terminar la secuencia de ataque se vuelve al menu.
  useEffect(() => {
    if (phase !== 'attacking') {
      return
    }

    const timer = window.setTimeout(() => {
      setAttacker(null)
      setPhase('menu')
      setSelectedIndex(0)
      setMessageState({ text: '¿Qué vas a hacer?', revealed: 0 })
    }, ATTACK_SEQUENCE_MS)

    return () => window.clearTimeout(timer)
  }, [phase])

  // El manejador de teclas se registra una sola vez y lee el estado por referencia.
  const interactionRef = useRef({
    phase,
    selectedIndex,
    choiceCount: choices.length,
    runChoice,
    cancelQuestion,
  })
  useEffect(() => {
    interactionRef.current = {
      phase,
      selectedIndex,
      choiceCount: choices.length,
      runChoice,
      cancelQuestion,
    }
  })

  // Se bloquean las teclas de movimiento del mundo mientras el combate esta abierto.
  useEffect(() => {
    // Si el foco esta en un campo de texto (el chat, por ejemplo) no se roban las teclas.
    const isTypingTarget = (target: EventTarget | null) => {
      const element = target as HTMLElement | null
      const tagName = element?.tagName?.toLowerCase()
      return tagName === 'input' || tagName === 'textarea' || element?.isContentEditable === true
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (isTypingTarget(event.target)) {
        return
      }

      const key = event.key.toLowerCase()

      if (key === 'escape') {
        event.preventDefault()
        event.stopPropagation()
        const interaction = interactionRef.current
        if (interaction.phase === 'question') {
          interaction.cancelQuestion()
        } else if (interaction.phase === 'menu') {
          onFleeRef.current()
        }
        return
      }

      if (!BLOCKED_MOVEMENT_KEYS.has(key) && key !== 'enter' && key !== ' ') {
        return
      }

      event.preventDefault()
      event.stopPropagation()

      const interaction = interactionRef.current
      if (interaction.phase === 'attacking') {
        return
      }

      const total = Math.max(1, interaction.choiceCount)
      if (key === 'arrowleft' || key === 'a') {
        setSelectedIndex((currentIndex) => (currentIndex + total - 1) % total)
        return
      }

      if (key === 'arrowright' || key === 'd') {
        setSelectedIndex((currentIndex) => (currentIndex + 1) % total)
        return
      }

      if (key === 'arrowup' || key === 'w') {
        setSelectedIndex((currentIndex) => (currentIndex + total - 2) % total)
        return
      }

      if (key === 'arrowdown' || key === 's') {
        setSelectedIndex((currentIndex) => (currentIndex + 2) % total)
        return
      }

      if (key === 'enter' || key === ' ') {
        interaction.runChoice(interaction.selectedIndex)
      }
    }

    // El keyup se deja pasar a proposito: si se bloquea, el juego se queda creyendo que
    // la tecla sigue pulsada y el personaje sale disparado al cerrar el combate.
    window.addEventListener('keydown', handleKeyDown, true)
    return () => {
      window.removeEventListener('keydown', handleKeyDown, true)
    }
  }, [])

  return (
    <div className="combat-screen" role="dialog" aria-label="Combate">
      {scenery ? (
        <div className="combat-screen-scenery" aria-hidden="true">
          <div
            className="combat-screen-scenery-crop"
            style={{
              '--combat-scenery-aspect': scenery.aspect,
              ...(scenery.fillSrc
                ? {
                    backgroundImage: `url("${scenery.fillSrc}")`,
                    backgroundSize: `${scenery.fillWidthPercent}% ${scenery.fillHeightPercent}%`,
                    backgroundPosition: `${scenery.fillOffsetXPercent}% ${scenery.fillOffsetYPercent}%`,
                  }
                : null),
            } as React.CSSProperties}
          >
            {scenery.tiles.map((tile, index) => (
              <img
                key={`${tile.key}-${index}`}
                src={tile.src}
                alt=""
                draggable={false}
                style={{
                  left: `${tile.leftPercent}%`,
                  top: `${tile.topPercent}%`,
                  width: `${tile.widthPercent}%`,
                  height: `${tile.heightPercent}%`,
                  transform: tile.flippedX ? 'scaleX(-1)' : undefined,
                }}
              />
            ))}
          </div>
          <div className="combat-screen-scenery-veil" />
        </div>
      ) : null}

      <div ref={stageRef} className={`combat-screen-stage${scenery ? ' has-scenery' : ''}`}>
        <section className="combat-screen-status is-enemy" aria-label={`Estado de ${enemyName}`}>
          <header>
            <strong>{enemyName.toLocaleUpperCase()}</strong>
            <span>Nv{enemyLevel}</span>
          </header>
          <HealthBar health={enemyHealth} />
        </section>

        <div
          ref={enemyActorRef}
          className={`combat-screen-actor is-enemy${isEntering ? ' is-entering' : ''}${attacker === 'enemy' ? ' is-attacking' : ''}${attacker === 'player' ? ' is-hit' : ''}`}
        >
          <div className="combat-screen-platform" aria-hidden="true" />
          <div className="combat-screen-sprite">
            <span
              className="combat-screen-sprite-flip"
              style={enemyPose.flipX ? { transform: 'scaleX(-1)' } : undefined}
            >
              {enemySprite ? <SheetSprite frame={enemySprite} scale={ENEMY_SPRITE_SCALE} /> : (
                <div className="combat-screen-sprite-placeholder" aria-hidden="true" />
              )}
            </span>
          </div>
        </div>

        <div
          ref={playerActorRef}
          className={`combat-screen-actor is-player${isEntering ? ' is-entering' : ''}${attacker === 'player' ? ' is-attacking' : ''}${attacker === 'enemy' ? ' is-hit' : ''}`}
        >
          <div className="combat-screen-platform" aria-hidden="true" />
          <div className="combat-screen-sprite is-avatar" aria-hidden="true">
            {playerEditorAnimation ? (
              <EditorLayeredAvatar
                document={playerEditorAnimation.document}
                equipment={playerPose.view === 'b' ? chapBackAnimationEquipment : chapFrontAnimationEquipment}
                displayName={playerName}
                view={playerPose.view}
                flipX={playerEditorAnimation.flipX}
                flipY={playerEditorAnimation.flipY}
                stateId={playerStateId}
              />
            ) : (
              <LayeredAvatar
                view={playerPose.view}
                flipX={playerPose.flipX}
                equipment={playerPose.view === 'b' ? chapBackEquipment : chapFrontEquipment}
                animationName={playerLegacyAnimation}
                animation={avatarAnimations[playerLegacyAnimation]}
                displayName={playerName}
              />
            )}
          </div>
        </div>

        <section className="combat-screen-status is-player" aria-label={`Estado de ${playerName}`}>
          <header>
            <strong>{playerName.toLocaleUpperCase()}</strong>
            <span>Nv{playerLevel}</span>
          </header>
          <HealthBar health={playerHealth} />
          <output className="combat-screen-hp-numbers">
            {playerHealth.current}/{playerHealth.max}
          </output>
        </section>

        {allies && allies.length > 0 ? (
          <section className="combat-screen-allies" aria-label="Compañeros en combate">
            <strong>GRUPO</strong>
            <ul>
              {allies.map((ally) => (
                <li key={ally.userId}>
                  <span>{ally.displayName.toLocaleUpperCase()}</span>
                  <span>Nv{ally.level}</span>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
      </div>

      <div className="combat-screen-dialog">
        <p className="combat-screen-message" aria-live="polite">
          {messageState.text.slice(0, messageState.revealed)}
          {isMessageComplete ? <span className="combat-screen-caret" aria-hidden="true">▼</span> : null}
        </p>
        <ul className={`combat-screen-actions${phase === 'question' ? ' is-answers' : ''}`}>
          {choices.map((choice, index) => (
            <li key={`${phase}-${choice.id}`}>
              <button
                type="button"
                className={`combat-screen-action${index === selectedIndex ? ' is-selected' : ''}`}
                disabled={phase === 'attacking'}
                onMouseEnter={() => setSelectedIndex(index)}
                onClick={() => {
                  setSelectedIndex(index)
                  runChoice(index)
                }}
              >
                {choice.label}
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}

// El mundo de atras se redibuja cada frame; esta pantalla solo cuando cambia su contenido.
export const CombatScreen = memo(CombatScreenComponent, (previous, next) => (
  previous.enemyName === next.enemyName
  && previous.enemyLevel === next.enemyLevel
  && previous.enemyHealth === next.enemyHealth
  && previous.enemyTemplate === next.enemyTemplate
  && previous.playerName === next.playerName
  && previous.playerLevel === next.playerLevel
  && previous.playerHealth === next.playerHealth
  && previous.allies === next.allies
  && previous.scenery === next.scenery
  && previous.onSound === next.onSound
  && previous.onFlee === next.onFlee
))
