import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  interactWithRoomObject,
  PLAYER_REACH_THRESHOLD,
  PLAYER_SPEED,
  type Direction,
  type PlayerFacing,
  type Position,
  type Presence,
  type RoomEnemyState,
  type RoomEnemyTemplate,
  type RoomObjectTemplate,
  type RoomState,
  type RoomTemplate,
  type UserProfile,
} from '@social-sena/shared'
import { navigateInApp } from '../hooks/usePathname'
import {
  disableLocalAnimationPreview,
  enableLocalAnimationPreview,
} from '../game/avatar/avatarAnimationRuntime'
import { createUiSoundController } from '../audio/chiptuneSounds'
import { isCoinAssetId } from './coinAssetCatalog'
import ReactWorld, { type WorldInteractableTarget } from './ReactWorld'
import { getObjectNavigationBoundsList } from './world/ObjectDecoration'
import { PLAYER_COLLIDER_HEIGHT, PLAYER_COLLIDER_WIDTH } from './world/WorldPlayer'

const TEST_ROOM_ID = 'edit-room-local-test'
const TEST_SESSION_ID = 'edit-room-local-player'
const TEST_MOVEMENT_TICK_MS = 1000 / 20
const TEST_ENEMY_HALF_SIZE = 64
const TEST_ENEMY_REACH_PX = 12

interface EditRoomTestModeProps {
  template: RoomTemplate
  profile: UserProfile
  debugEnabled: boolean
  resolveObjectSpriteSrc: (objectTemplate: RoomObjectTemplate) => string | undefined
}

interface Bounds {
  left: number
  right: number
  top: number
  bottom: number
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}

function createPlayer(profile: UserProfile, spawn: Position): Presence {
  return {
    userId: profile.userId,
    displayName: profile.displayName,
    sessionId: TEST_SESSION_ID,
    roomId: TEST_ROOM_ID,
    level: 1,
    position: spawn,
    direction: 'down',
    facing: 'front-right',
    moving: false,
    skinId: profile.skinId,
    skinColors: profile.skinColors,
    partyId: null,
    partyLeaderUserId: null,
    partyLeaderDisplayName: null,
    partyLeaderSkinId: null,
    partyLeaderSkinColors: null,
    animation: 'idle',
    destination: null,
    route: null,
  }
}

interface TestEnemyRuntime {
  x: number
  y: number
  targetX: number
  targetY: number
  idleUntilMs: number
  moving: boolean
}

// El enemigo ocupa el mismo espacio que un jugador, apoyado en la base de su figura.
function getTestEnemyBodyBounds(position: Position): Bounds {
  const feetY = position.y + TEST_ENEMY_HALF_SIZE
  return {
    left: position.x - PLAYER_COLLIDER_WIDTH / 2,
    right: position.x + PLAYER_COLLIDER_WIDTH / 2,
    top: feetY - PLAYER_COLLIDER_HEIGHT,
    bottom: feetY,
  }
}

// Zona de vigilancia completa: si el jugador la toca, el enemigo lo detecta.
function getTestEnemyZoneBounds(enemyTemplate: RoomEnemyTemplate): Bounds {
  const area = enemyTemplate.surveillanceArea ?? {
    width: enemyTemplate.ancho_de_patrullaje_,
    height: enemyTemplate.alto_de_patrullaje_,
    offsetX: 0,
    offsetY: 0,
  }
  const centerX = enemyTemplate.posicion_relativa_X + area.offsetX
  const centerY = enemyTemplate.posicion_relativa_Y + area.offsetY

  return {
    left: centerX - area.width / 2,
    right: centerX + area.width / 2,
    top: centerY - area.height / 2,
    bottom: centerY + area.height / 2,
  }
}

// Area donde el enemigo puede moverse: su zona de vigilancia menos media figura por lado.
// En el juego real esto lo calcula y simula el servidor; aqui es solo una vista previa.
function getTestEnemyBounds(enemyTemplate: RoomEnemyTemplate) {
  const area = enemyTemplate.surveillanceArea ?? {
    width: enemyTemplate.ancho_de_patrullaje_,
    height: enemyTemplate.alto_de_patrullaje_,
    offsetX: 0,
    offsetY: 0,
  }
  const centerX = enemyTemplate.posicion_relativa_X + area.offsetX
  const centerY = enemyTemplate.posicion_relativa_Y + area.offsetY
  const halfWidth = Math.max(0, area.width / 2 - TEST_ENEMY_HALF_SIZE)
  const halfHeight = Math.max(0, area.height / 2 - TEST_ENEMY_HALF_SIZE)

  return {
    left: centerX - halfWidth,
    right: centerX + halfWidth,
    top: centerY - halfHeight,
    bottom: centerY + halfHeight,
  }
}

function getTestEnemyIdleDurationMs() {
  return Math.random() < 0.35
    ? 2600 + Math.round(Math.random() * 3400)
    : 700 + Math.round(Math.random() * 1300)
}

function getTestEnemyPatrolPoint(
  enemyTemplate: RoomEnemyTemplate,
  from?: { x: number; y: number },
  isBlocked?: (position: Position) => boolean,
) {
  const bounds = getTestEnemyBounds(enemyTemplate)
  const areaWidth = bounds.right - bounds.left
  const areaHeight = bounds.bottom - bounds.top
  const minimumTravel = Math.min(96, Math.max(areaWidth, areaHeight) * 0.35)
  let candidate = {
    x: bounds.left + areaWidth * Math.random(),
    y: bounds.top + areaHeight * Math.random(),
  }

  for (let attempt = 0; attempt < 6; attempt += 1) {
    const isFarEnough = !from
      || Math.hypot(candidate.x - from.x, candidate.y - from.y) >= minimumTravel
    if (isFarEnough && !isBlocked?.(candidate)) break

    candidate = {
      x: bounds.left + areaWidth * Math.random(),
      y: bounds.top + areaHeight * Math.random(),
    }
  }

  return candidate
}

function getPlayerBounds(position: Position): Bounds {
  return {
    left: position.x - PLAYER_COLLIDER_WIDTH / 2,
    right: position.x + PLAYER_COLLIDER_WIDTH / 2,
    top: position.y - PLAYER_COLLIDER_HEIGHT,
    bottom: position.y,
  }
}

function getObjectVisualBounds(objectTemplate: RoomObjectTemplate): Bounds {
  return {
    left: objectTemplate.x - objectTemplate.width / 2,
    right: objectTemplate.x + objectTemplate.width / 2,
    top: objectTemplate.y - objectTemplate.height / 2,
    bottom: objectTemplate.y + objectTemplate.height / 2,
  }
}

function overlaps(first: Bounds, second: Bounds) {
  return first.left < second.right
    && first.right > second.left
    && first.top < second.bottom
    && first.bottom > second.top
}

function segmentIntersectsPlayerBounds(from: Position, to: Position, bounds: Bounds) {
  const expandedBounds = {
    left: bounds.left - PLAYER_COLLIDER_WIDTH / 2,
    right: bounds.right + PLAYER_COLLIDER_WIDTH / 2,
    top: bounds.top,
    bottom: bounds.bottom + PLAYER_COLLIDER_HEIGHT,
  }
  const deltaX = to.x - from.x
  const deltaY = to.y - from.y
  let entry = 0
  let exit = 1

  const updateInterval = (p: number, q: number) => {
    if (Math.abs(p) < 0.000001) {
      return q >= 0
    }

    const ratio = q / p
    if (p < 0) {
      if (ratio > exit) return false
      entry = Math.max(entry, ratio)
    } else {
      if (ratio < entry) return false
      exit = Math.min(exit, ratio)
    }
    return true
  }

  return updateInterval(-deltaX, from.x - expandedBounds.left)
    && updateInterval(deltaX, expandedBounds.right - from.x)
    && updateInterval(-deltaY, from.y - expandedBounds.top)
    && updateInterval(deltaY, expandedBounds.bottom - from.y)
    && entry <= exit
    && exit > 0.0001
    && entry < 0.9999
}

function resolveDirection(deltaX: number, deltaY: number, fallback: Direction): Direction {
  if (Math.abs(deltaX) > Math.abs(deltaY)) {
    return deltaX < 0 ? 'left' : 'right'
  }

  if (Math.abs(deltaY) > 0.001) {
    return deltaY < 0 ? 'up' : 'down'
  }

  return fallback
}

function resolveFacing(
  deltaX: number,
  deltaY: number,
  fallback: PlayerFacing = 'front-right',
): PlayerFacing {
  if (Math.abs(deltaX) < 0.001 && Math.abs(deltaY) < 0.001) {
    return fallback
  }

  const wasFacingLeft = fallback === 'front-left' || fallback === 'back-left'
  const isLeft = Math.abs(deltaX) < 0.001 ? wasFacingLeft : deltaX < 0
  const isBack = deltaY < 0 && Math.abs(deltaY) >= Math.abs(deltaX) * 0.65

  if (isBack) {
    return isLeft ? 'back-left' : 'back-right'
  }

  return isLeft ? 'front-left' : 'front-right'
}

export default function EditRoomTestMode({
  template,
  profile,
  debugEnabled,
  resolveObjectSpriteSrc,
}: EditRoomTestModeProps) {
  const [runtimeTemplate, setRuntimeTemplate] = useState(template)
  const [player, setPlayer] = useState(() => createPlayer(profile, template.world.spawn))
  const playerRef = useRef(player)
  const pressedKeysRef = useRef(new Set<string>())
  const navigationTargetRef = useRef<Position | null>(null)
  const collectedObjectIdsRef = useRef(new Set<string>())
  const [uiSoundController] = useState(createUiSoundController)
  const [animationSource, setAnimationSource] = useState('')
  // Con la interfaz de combate abierta nadie se mueve en la vista previa.
  const combatEnemyIdRef = useRef<string | null>(null)
  const handleCombatSound = useCallback((sound: 'typing' | 'confirm' | 'cancel') => {
    void uiSoundController.play(sound === 'typing' ? 'dialogue-blip' : sound)
  }, [uiSoundController])
  const handleCombatChange = useCallback((enemyId: string | null) => {
    combatEnemyIdRef.current = enemyId
    if (enemyId) {
      navigationTargetRef.current = null
      pressedKeysRef.current.clear()
    }
  }, [])
  const enemyTemplates = useMemo(() => runtimeTemplate.enemies ?? [], [runtimeTemplate.enemies])
  const [enemyStates, setEnemyStates] = useState<RoomEnemyState[]>([])
  const enemyRuntimesRef = useRef(new Map<string, TestEnemyRuntime>())
  const enemyStatesRef = useRef<RoomEnemyState[]>([])
  const colliders = useMemo(() => [
    ...runtimeTemplate.objects.flatMap(getObjectNavigationBoundsList),
    ...(runtimeTemplate.npcs ?? []).flatMap((npcTemplate) => {
      const collider = npcTemplate.collider
      if (!collider || collider.width <= 0 || collider.height <= 0) return []

      return [{
        left: npcTemplate.x + collider.offsetX - collider.width / 2,
        right: npcTemplate.x + collider.offsetX + collider.width / 2,
        top: npcTemplate.y + collider.offsetY - collider.height / 2,
        bottom: npcTemplate.y + collider.offsetY + collider.height / 2,
      }]
    }),
  ], [runtimeTemplate.npcs, runtimeTemplate.objects])
  // Los colliders se leen por referencia para no reiniciar la simulacion de enemigos.
  const collidersRef = useRef(colliders)
  useEffect(() => {
    collidersRef.current = colliders
  }, [colliders])
  const collectibleObjects = useMemo(
    () => runtimeTemplate.objects.filter((objectTemplate) => objectTemplate.collectible === true),
    [runtimeTemplate.objects],
  )

  // El modo de prueba no abre conexión con el juego, así que el sistema de animaciones
  // se alimenta aquí de la caché, del paquete incluido o de las animaciones de este navegador.
  useEffect(() => {
    let cancelled = false
    void enableLocalAnimationPreview().then((status) => {
      if (!cancelled) setAnimationSource(status)
    })
    return () => {
      cancelled = true
      disableLocalAnimationPreview()
    }
  }, [])

  useEffect(() => {
    uiSoundController.updateSettings({
      sfxEnabled: profile.audioSettings.sfxEnabled,
      sfxVolume: profile.audioSettings.sfxVolume,
    })
  }, [profile.audioSettings.sfxEnabled, profile.audioSettings.sfxVolume, uiSoundController])

  useEffect(() => {
    const unlockAudio = () => {
      void uiSoundController.unlock()
    }

    window.addEventListener('pointerdown', unlockAudio, { passive: true })
    window.addEventListener('keydown', unlockAudio)
    return () => {
      window.removeEventListener('pointerdown', unlockAudio)
      window.removeEventListener('keydown', unlockAudio)
      void uiSoundController.close()
    }
  }, [uiSoundController])

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      if (target?.matches('input, textarea, select, [contenteditable="true"]')) {
        return
      }

      const movementKeys = ['arrowup', 'arrowdown', 'arrowleft', 'arrowright', 'w', 'a', 's', 'd']
      const key = event.key.toLocaleLowerCase()
      if (!movementKeys.includes(key)) {
        return
      }

      event.preventDefault()
      navigationTargetRef.current = null
      pressedKeysRef.current.add(key)
    }

    const handleKeyUp = (event: KeyboardEvent) => {
      pressedKeysRef.current.delete(event.key.toLocaleLowerCase())
    }

    const releaseKeys = () => pressedKeysRef.current.clear()
    window.addEventListener('keydown', handleKeyDown)
    window.addEventListener('keyup', handleKeyUp)
    window.addEventListener('blur', releaseKeys)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
      window.removeEventListener('keyup', handleKeyUp)
      window.removeEventListener('blur', releaseKeys)
    }
  }, [])

  useEffect(() => {
    let previousTime = performance.now()

    const canOccupy = (position: Position) => {
      const bounds = getPlayerBounds(position)
      if (
        bounds.left < 0
        || bounds.right > runtimeTemplate.world.width
        || bounds.top < 0
        || bounds.bottom > runtimeTemplate.world.height
      ) {
        return false
      }

      return !colliders.some((collider) => overlaps(bounds, collider))
    }

    const canTraverse = (from: Position, to: Position) => (
      canOccupy(to)
      && !colliders.some((collider) => segmentIntersectsPlayerBounds(from, to, collider))
    )

    const tick = () => {
      if (combatEnemyIdRef.current) {
        return
      }

      const now = performance.now()
      const deltaSeconds = Math.min(0.05, Math.max(0, (now - previousTime) / 1000))
      previousTime = now
      const currentPlayer = playerRef.current
      const keys = pressedKeysRef.current
      let directionX = Number(keys.has('arrowright') || keys.has('d'))
        - Number(keys.has('arrowleft') || keys.has('a'))
      let directionY = Number(keys.has('arrowdown') || keys.has('s'))
        - Number(keys.has('arrowup') || keys.has('w'))
      const keyboardIsActive = directionX !== 0 || directionY !== 0
      const navigationTarget = navigationTargetRef.current

      if (!keyboardIsActive && navigationTarget) {
        const targetDeltaX = navigationTarget.x - currentPlayer.position.x
        const targetDeltaY = navigationTarget.y - currentPlayer.position.y
        const targetDistance = Math.hypot(targetDeltaX, targetDeltaY)

        if (targetDistance <= PLAYER_REACH_THRESHOLD) {
          navigationTargetRef.current = null
        } else {
          directionX = targetDeltaX / targetDistance
          directionY = targetDeltaY / targetDistance
        }
      }

      const directionLength = Math.hypot(directionX, directionY)
      const isMoving = directionLength > 0.001
      if (isMoving) {
        directionX /= directionLength
        directionY /= directionLength
      }

      const travelDistance = PLAYER_SPEED * deltaSeconds
      const deltaX = directionX * travelDistance
      const deltaY = directionY * travelDistance
      let nextPosition = currentPlayer.position

      if (isMoving) {
        const combinedPosition = {
          x: clamp(currentPlayer.position.x + deltaX, PLAYER_COLLIDER_WIDTH / 2, runtimeTemplate.world.width - PLAYER_COLLIDER_WIDTH / 2),
          y: clamp(currentPlayer.position.y + deltaY, PLAYER_COLLIDER_HEIGHT, runtimeTemplate.world.height - 20),
        }
        const xOnlyPosition = {
          x: combinedPosition.x,
          y: currentPlayer.position.y,
        }
        const yOnlyPosition = {
          x: currentPlayer.position.x,
          y: combinedPosition.y,
        }

        if (canTraverse(currentPlayer.position, combinedPosition)) {
          nextPosition = combinedPosition
        } else if (Math.abs(deltaX) > 0.001 && canTraverse(currentPlayer.position, xOnlyPosition)) {
          nextPosition = xOnlyPosition
        } else if (Math.abs(deltaY) > 0.001 && canTraverse(currentPlayer.position, yOnlyPosition)) {
          nextPosition = yOnlyPosition
        }
      }

      const didMove = nextPosition.x !== currentPlayer.position.x || nextPosition.y !== currentPlayer.position.y
      if (navigationTarget && isMoving && !didMove) {
        navigationTargetRef.current = null
      }

      const playerBounds = getPlayerBounds(nextPosition)
      const collectedObjects = collectibleObjects
        .filter((objectTemplate) => (
          !collectedObjectIdsRef.current.has(objectTemplate.id)
          && overlaps(playerBounds, getObjectVisualBounds(objectTemplate))
        ))
      const collectedObjectIds = collectedObjects
        .map((objectTemplate) => objectTemplate.id)

      if (collectedObjectIds.length > 0) {
        if (collectedObjects.some((objectTemplate) => isCoinAssetId(objectTemplate.spriteAssetId))) {
          void uiSoundController.play('coin-pickup')
        }
        collectedObjectIds.forEach((objectId) => collectedObjectIdsRef.current.add(objectId))
        const collectedObjectIdSet = new Set(collectedObjectIds)
        setRuntimeTemplate((currentTemplate) => {
          const nextObjects = currentTemplate.objects.filter(
            (objectTemplate) => !collectedObjectIdSet.has(objectTemplate.id),
          )

          return nextObjects.length === currentTemplate.objects.length
            ? currentTemplate
            : { ...currentTemplate, objects: nextObjects }
        })
      }

      const nextPlayer: Presence = {
        ...currentPlayer,
        position: nextPosition,
        direction: isMoving
          ? resolveDirection(directionX, directionY, currentPlayer.direction)
          : currentPlayer.direction,
        facing: isMoving
          ? resolveFacing(directionX, directionY, currentPlayer.facing)
          : currentPlayer.facing,
        moving: didMove,
        animation: didMove ? 'walk' : 'idle',
        destination: didMove && !keyboardIsActive
          ? navigationTargetRef.current
          : null,
        route: null,
      }

      playerRef.current = nextPlayer
      if (
        didMove
        || currentPlayer.moving
        || nextPlayer.direction !== currentPlayer.direction
        || nextPlayer.facing !== currentPlayer.facing
      ) {
        setPlayer(nextPlayer)
      }
    }

    const movementInterval = window.setInterval(tick, TEST_MOVEMENT_TICK_MS)
    return () => window.clearInterval(movementInterval)
  }, [collectibleObjects, colliders, runtimeTemplate.world.height, runtimeTemplate.world.width, uiSoundController])

  // Vista previa del patrullaje dentro de la zona de vigilancia. En la escena publicada
  // esto lo simula el servidor, que tambien hace que el enemigo persiga al jugador.
  useEffect(() => {
    const runtimes = enemyRuntimesRef.current
    const activeIds = new Set(enemyTemplates.map((enemyTemplate) => enemyTemplate.id))
    runtimes.forEach((_runtime, enemyId) => {
      if (!activeIds.has(enemyId)) runtimes.delete(enemyId)
    })

    enemyTemplates.forEach((enemyTemplate) => {
      if (runtimes.has(enemyTemplate.id)) return

      const bounds = getTestEnemyBounds(enemyTemplate)
      const start = {
        x: clamp(enemyTemplate.posicion_relativa_X, bounds.left, bounds.right),
        y: clamp(enemyTemplate.posicion_relativa_Y, bounds.top, bounds.bottom),
      }
      const target = getTestEnemyPatrolPoint(enemyTemplate, start)
      runtimes.set(enemyTemplate.id, {
        ...start,
        targetX: target.x,
        targetY: target.y,
        idleUntilMs: Date.now() + getTestEnemyIdleDurationMs(),
        moving: false,
      })
    })

    enemyStatesRef.current = enemyTemplates.map((enemyTemplate) => {
      const runtime = runtimes.get(enemyTemplate.id)
      return {
        enemyId: enemyTemplate.id,
        x: runtime?.x ?? enemyTemplate.posicion_relativa_X,
        y: runtime?.y ?? enemyTemplate.posicion_relativa_Y,
        mode: 'patrol' as const,
        targetUserId: null,
        moving: false,
      }
    })
    setEnemyStates(enemyStatesRef.current)

    if (enemyTemplates.length === 0) return

    const isEnemyBlocked = (position: Position) => collidersRef.current.some((collider) => (
      overlaps(getTestEnemyBodyBounds(position), collider)
    ))

    // Si el destino esta bloqueado, intenta deslizarse por un solo eje.
    const resolveEnemyStep = (from: Position, to: Position): Position => {
      if (!isEnemyBlocked(to)) return to

      const horizontalOnly = { x: to.x, y: from.y }
      if (Math.abs(to.x - from.x) > 0.001 && !isEnemyBlocked(horizontalOnly)) return horizontalOnly

      const verticalOnly = { x: from.x, y: to.y }
      if (Math.abs(to.y - from.y) > 0.001 && !isEnemyBlocked(verticalOnly)) return verticalOnly

      return { x: from.x, y: from.y }
    }

    const enemyInterval = window.setInterval(() => {
      if (combatEnemyIdRef.current) {
        return
      }

      const nowMs = Date.now()
      const deltaSeconds = TEST_MOVEMENT_TICK_MS / 1000

      const nextStates = enemyTemplates.map((enemyTemplate): RoomEnemyState => {
        const runtime = runtimes.get(enemyTemplate.id)
        if (!runtime) {
          return {
            enemyId: enemyTemplate.id,
            x: enemyTemplate.posicion_relativa_X,
            y: enemyTemplate.posicion_relativa_Y,
            mode: 'patrol' as const,
            targetUserId: null,
            moving: false,
          }
        }

        const baseSpeed = Math.max(0, enemyTemplate.velocidad_de_patrullaje_ ?? 72)
        const speed = baseSpeed * 0.8
        const bounds = getTestEnemyBounds(enemyTemplate)
        const detected = overlaps(
          getPlayerBounds(playerRef.current.position),
          getTestEnemyZoneBounds(enemyTemplate),
        )

        if (detected) {
          // Persecucion: el enemigo va hacia el jugador sin salir de su zona.
          const target = {
            x: clamp(playerRef.current.position.x, bounds.left, bounds.right),
            y: clamp(playerRef.current.position.y, bounds.top, bounds.bottom),
          }
          const deltaX = target.x - runtime.x
          const deltaY = target.y - runtime.y
          const distance = Math.hypot(deltaX, deltaY)
          const step = Math.min(baseSpeed * 1.2 * deltaSeconds, distance)

          const nextChasePosition = distance > 0.05 && step > 0
            ? resolveEnemyStep(runtime, {
                x: runtime.x + (deltaX / distance) * step,
                y: runtime.y + (deltaY / distance) * step,
              })
            : { x: runtime.x, y: runtime.y }
          runtime.moving = Math.hypot(nextChasePosition.x - runtime.x, nextChasePosition.y - runtime.y) > 0.001
          runtime.x = nextChasePosition.x
          runtime.y = nextChasePosition.y

          runtime.targetX = target.x
          runtime.targetY = target.y
          runtime.idleUntilMs = 0

          return {
            enemyId: enemyTemplate.id,
            x: runtime.x,
            y: runtime.y,
            mode: 'chase' as const,
            targetUserId: profile.userId,
            moving: runtime.moving,
          }
        }

        if (runtime.idleUntilMs > nowMs) {
          runtime.moving = false
        } else {
          const deltaX = runtime.targetX - runtime.x
          const deltaY = runtime.targetY - runtime.y
          const distance = Math.hypot(deltaX, deltaY)

          if (distance <= Math.max(TEST_ENEMY_REACH_PX, speed * deltaSeconds)) {
            const nextTarget = getTestEnemyPatrolPoint(enemyTemplate, runtime, isEnemyBlocked)
            runtime.targetX = nextTarget.x
            runtime.targetY = nextTarget.y
            runtime.idleUntilMs = nowMs + getTestEnemyIdleDurationMs()
            runtime.moving = false
          } else {
            const step = Math.min(speed * deltaSeconds, distance)
            const nextPosition = resolveEnemyStep(runtime, {
              x: runtime.x + (deltaX / distance) * step,
              y: runtime.y + (deltaY / distance) * step,
            })

            if (Math.hypot(nextPosition.x - runtime.x, nextPosition.y - runtime.y) <= 0.001) {
              // Camino bloqueado: descansa y busca otro destino.
              const nextTarget = getTestEnemyPatrolPoint(enemyTemplate, runtime, isEnemyBlocked)
              runtime.targetX = nextTarget.x
              runtime.targetY = nextTarget.y
              runtime.idleUntilMs = nowMs + getTestEnemyIdleDurationMs()
              runtime.moving = false
            } else {
              runtime.x = nextPosition.x
              runtime.y = nextPosition.y
              runtime.moving = true
            }
          }
        }

        return {
          enemyId: enemyTemplate.id,
          x: runtime.x,
          y: runtime.y,
          mode: 'patrol' as const,
          targetUserId: null,
          moving: runtime.moving,
        }
      })

      // Sin cambios no se vuelve a renderizar: los enemigos quietos no cuestan nada.
      const previousStates = enemyStatesRef.current
      const unchanged = previousStates.length === nextStates.length
        && nextStates.every((nextState, index) => {
          const previousState = previousStates[index]
          return previousState
            && previousState.enemyId === nextState.enemyId
            && previousState.x === nextState.x
            && previousState.y === nextState.y
            && previousState.moving === nextState.moving
            && previousState.mode === nextState.mode
            && previousState.targetUserId === nextState.targetUserId
        })

      if (unchanged) return

      enemyStatesRef.current = nextStates
      setEnemyStates(nextStates)
    }, TEST_MOVEMENT_TICK_MS)

    return () => window.clearInterval(enemyInterval)
  }, [enemyTemplates, profile.userId])

  const room = useMemo<RoomState>(() => ({
    roomId: TEST_ROOM_ID,
    templateId: runtimeTemplate.id,
    name: 'Prueba local del editor',
    maxUsers: 1,
    template: runtimeTemplate,
    players: [player],
    enemies: enemyStates,
  }), [enemyStates, player, runtimeTemplate])

  const handleNavigate = useCallback((target: Position) => {
    navigationTargetRef.current = target
  }, [])

  const handleInteract = useCallback((interactable: WorldInteractableTarget) => {
    if (interactable.entityType === 'teleport') {
      const targetRoutePath = interactable.teleportTarget.routePath
      if (typeof targetRoutePath === 'string') {
        navigateInApp(targetRoutePath)
        return
      }
    }

    if (interactable.entityType !== 'object') {
      return
    }

    setRuntimeTemplate((currentTemplate) => (
      interactWithRoomObject(currentTemplate, interactable.id)?.template ?? currentTemplate
    ))
  }, [])

  return (
    <main className="edit-room-test-mode" aria-label="Modo de prueba de la sala">
      <ReactWorld
        room={room}
        currentUserId={profile.userId}
        template={runtimeTemplate}
        onNavigate={handleNavigate}
        onInteract={handleInteract}
        onCombatChange={handleCombatChange}
        onCombatSound={handleCombatSound}
        debugEnabled={debugEnabled}
        playerIdentityMode="names"
        navigationEnabled
        interactionEnabled
        pointerInteractionEnabled={false}
        resolveObjectSpriteSrc={resolveObjectSpriteSrc}
        centerWorldWhenSmaller
        cameraVerticalMargin={300}
      />
      <div className="edit-room-test-hint" role="status">
        Modo Test · WASD/Flechas o clic para moverte · T para volver{animationSource ? ` · ${animationSource}` : ''}
      </div>
    </main>
  )
}
