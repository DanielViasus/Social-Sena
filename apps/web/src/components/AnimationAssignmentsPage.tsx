import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore, type DragEvent, type FormEvent } from 'react'
import { AnimationLeaveDialog } from './AnimationEditorPage'
import { getAnimationElapsedMs, getAnimationFrameIndex, subscribeAnimationClock } from '../game/avatar/animationClock'
import {
  ASSIGNMENT_DIRECTIONS,
  DEFAULT_SLOT_ANIMATIONS,
  DEFAULT_VARIATION_ID,
  MAX_STATE_NAME_LENGTH,
  MAX_VARIATION_NAME_LENGTH,
  conventionalFlip,
  countAssigned,
  directionFromVector,
  listStates,
  loadAssignments,
  resolveSlotAnimation,
  saveAssignments,
  slotKey,
  slotLabel,
  type AnimationAssignments,
  type AnimationVariation,
  type AssignmentDirection,
} from '../game/avatar/animationAssignmentStorage'
import { listAnimations, loadAnimation, type AnimationEditorDocument, type AnimationSummary } from '../game/avatar/animationEditorStorage'
import { navigateInApp } from '../hooks/usePathname'
import type { AuthSession } from '../auth/localSession'
import {
  buildAnimationPack,
  downloadAnimationPack,
  listAnimationHistory,
  parseAnimationPack,
  publishAnimationPack,
  publishAvatarAnimations,
  restoreAnimationVersion,
  type AnimationHistoryVersion,
} from '../game/avatar/publishAvatarAnimations'

const PIXELS_PER_UNIT = 128
const REFERENCE_ZOOM = 1 // 1:1 with the game's pixels.
const SLOT_SIZE = 100
const CARD_THUMB_SIZE = 84
const ANIMATION_DRAG_TYPE = 'application/x-social-sena-animation'
const DEFAULT_DIRECTION: AssignmentDirection = 'e'

// Keys that simulate movement: arrows and WASD.
const MOVEMENT_KEYS: Record<string, [number, number]> = {
  ArrowUp: [0, -1], KeyW: [0, -1],
  ArrowDown: [0, 1], KeyS: [0, 1],
  ArrowLeft: [-1, 0], KeyA: [-1, 0],
  ArrowRight: [1, 0], KeyD: [1, 0],
}

type DocumentLoader = (id: string) => Promise<AnimationEditorDocument>
const DocumentLoaderContext = createContext<DocumentLoader>((id) => loadAnimation(id).then((record) => record.document))

function useAnimationDocument(animationId: string | null) {
  const load = useContext(DocumentLoaderContext)
  const [result, setResult] = useState<{ id: string; document?: AnimationEditorDocument; error?: string } | null>(null)

  useEffect(() => {
    if (!animationId) return
    let cancelled = false
    load(animationId)
      .then((document) => { if (!cancelled) setResult({ id: animationId, document }) })
      .catch((error: unknown) => {
        if (!cancelled) setResult({ id: animationId, error: error instanceof Error ? error.message : 'No se pudo abrir la animación.' })
      })
    return () => { cancelled = true }
  }, [animationId, load])

  const current = animationId && result?.id === animationId ? result : null
  return { document: current?.document, error: current?.error }
}

// A scene box that plays an animation. Without one (none assigned, loading) the box stays empty.
// `scale` draws at a fixed zoom; `fitSize` shrinks the scene to fit a square of that many pixels.
function AnimationScene({ animationId, label, scale = 1, fitSize, decorative = false, playing = true, flipX = false, flipY = false }: {
  animationId: string | null
  label: string
  scale?: number
  fitSize?: number
  decorative?: boolean
  playing?: boolean // When false it shows the first frame and does not tick.
  flipX?: boolean // Invert the X scale (mirror horizontally).
  flipY?: boolean // Invert the Y scale (mirror vertically).
}) {
  const { document } = useAnimationDocument(animationId)
  const subscribe = useCallback((listener: () => void) => (
    playing ? subscribeAnimationClock(listener) : () => {}
  ), [playing])
  const getFrameIndex = useCallback(() => (
    document && playing ? getAnimationFrameIndex(document, getAnimationElapsedMs()) : 0
  ), [document, playing])
  const frameIndex = useSyncExternalStore(subscribe, getFrameIndex, () => 0)

  const frame = document ? (document.frames[frameIndex] ?? document.frames[0]) : null
  const sceneSize = document?.sceneSize ?? { width: 1, height: 1 }
  const pixelWidth = sceneSize.width * PIXELS_PER_UNIT
  const pixelHeight = sceneSize.height * PIXELS_PER_UNIT
  const zoom = fitSize ? fitSize / Math.max(pixelWidth, pixelHeight) : scale
  return (
    <div className="animation-editor-scene-scale" style={{ width: pixelWidth * zoom, height: pixelHeight * zoom }}>
      <div
        className="animation-editor-scene"
        {...(decorative ? { 'aria-hidden': true } : { role: 'img', 'aria-label': frame ? `Vista previa de ${label}` : `${label}: sin animación` })}
        style={{ width: pixelWidth, height: pixelHeight, transform: `scale(${zoom})`, transformOrigin: 'top left' }}
      >
        {frame && (
          <div className="animation-editor-skin-preview" style={flipX || flipY ? { transform: `translate(-50%, -50%) scale(${flipX ? -1 : 1}, ${flipY ? -1 : 1})` } : undefined}>
            {frame.layers.map((layer, index) => layer.visible && (
              <div key={layer.id} className="animation-editor-preview-layer" style={{
                zIndex: frame.layers.length - index,
                transformOrigin: `calc(50% + ${layer.pivotX}px) calc(50% + ${layer.pivotY}px)`,
                transform: `translate(${layer.x}px, ${layer.y}px) rotate(${layer.rotationX}deg) rotateY(${layer.rotationY}deg) rotate(${layer.rotation}deg)`,
              }}>
                <img src={layer.url} alt="" draggable={false} />
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

// Catalog entry: first frame at rest, animated on hover or focus. Draggable onto a direction.
function CatalogCard({ animation, selected, disabled, targetLabel, onAssign, onDragEnd }: {
  animation: AnimationSummary
  selected: boolean
  disabled: boolean
  targetLabel: string
  onAssign: () => void
  onDragEnd: () => void
}) {
  const cardRef = useRef<HTMLButtonElement>(null)
  const [visible, setVisible] = useState(false)
  const [active, setActive] = useState(false)

  // Animations are only read once their card scrolls into view.
  useEffect(() => {
    const card = cardRef.current
    if (!card || visible) return
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) { setVisible(true); observer.disconnect() }
    })
    observer.observe(card)
    return () => observer.disconnect()
  }, [visible])

  return (
    <button
      ref={cardRef}
      type="button"
      className={`animation-assignments-card${selected ? ' is-selected' : ''}`}
      aria-pressed={selected}
      title={`${animation.name} · Clic: asignar a ${targetLabel} · Arrastrar: soltar en una dirección`}
      disabled={disabled}
      draggable={!disabled}
      onMouseEnter={() => setActive(true)}
      onMouseLeave={() => setActive(false)}
      onFocus={() => setActive(true)}
      onBlur={() => setActive(false)}
      onDragStart={(event) => {
        event.dataTransfer.effectAllowed = 'copy'
        event.dataTransfer.setData(ANIMATION_DRAG_TYPE, animation.id)
      }}
      onDragEnd={onDragEnd}
      onClick={onAssign}
    >
      <span className="animation-assignments-card-thumb">
        <AnimationScene animationId={visible ? animation.id : null} label={animation.name} fitSize={CARD_THUMB_SIZE} decorative playing={active} />
      </span>
      <span className="animation-assignments-card-name">{animation.name}</span>
    </button>
  )
}

function VariationDialog({ title, initialName, description, submitLabel, error, onSubmit, onClose }: {
  title: string
  initialName: string
  description: string
  submitLabel: string
  error: string
  onSubmit: (name: string) => void
  onClose: () => void
}) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const [name, setName] = useState(initialName)

  useEffect(() => {
    const dialog = dialogRef.current
    dialog?.showModal()
    return () => dialog?.close()
  }, [])

  return (
    <dialog
      ref={dialogRef}
      className="edit-room-publication-dialog animation-editor-save-dialog"
      aria-labelledby="animation-variation-title"
      aria-modal="true"
      onCancel={(event) => { event.preventDefault(); onClose() }}
    >
      <form onSubmit={(event) => { event.preventDefault(); if (name.trim()) onSubmit(name) }}>
        <h2 id="animation-variation-title">{title}</h2>
        <label>
          Nombre de la variación
          <input type="text" required autoFocus maxLength={MAX_VARIATION_NAME_LENGTH} placeholder="Ej. Levitar, Nadar" value={name} onChange={(event) => setName(event.target.value)} />
        </label>
        <p>{description}</p>
        {error && <output role="alert">{error}</output>}
        <div className="edit-room-publication-actions">
          <button type="button" onClick={onClose}>Cancelar</button>
          <button type="submit" disabled={!name.trim()}>{submitLabel}</button>
        </div>
      </form>
    </dialog>
  )
}

export default function AnimationAssignmentsPage({ session }: { session?: AuthSession }) {
  const [initial] = useState(() => {
    const loaded = loadAssignments()
    const params = new URLSearchParams(window.location.search)
    const requested = params.get('variation')
    return {
      loaded,
      variationId: loaded.variations.find((item) => item.id === requested)?.id ?? loaded.variations[0]?.id ?? null,
      openCreate: params.get('new') === '1',
    }
  })
  const [data, setData] = useState<AnimationAssignments>(initial.loaded)
  const [savedData, setSavedData] = useState<AnimationAssignments>(initial.loaded)
  const [pendingPath, setPendingPath] = useState<string | null>(null)
  const [isSaving, setIsSaving] = useState(false)
  const [leaveError, setLeaveError] = useState('')
  const hasUnsavedChanges = useMemo(() => JSON.stringify(data) !== JSON.stringify(savedData), [data, savedData])
  const [selectedVariationId, setSelectedVariationId] = useState<string | null>(initial.variationId)
  const [variationDialog, setVariationDialog] = useState<'create' | 'saveAs' | null>(initial.openCreate ? 'create' : null)
  const [variationError, setVariationError] = useState('')
  const [animations, setAnimations] = useState<AnimationSummary[]>([])
  const [catalogStatus, setCatalogStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [selectedStateId, setSelectedStateId] = useState('idle')
  const [selectedDirection, setSelectedDirection] = useState<AssignmentDirection>(DEFAULT_DIRECTION)
  const [dropDirection, setDropDirection] = useState<AssignmentDirection | null>(null)
  const [heldDirection, setHeldDirection] = useState<AssignmentDirection | null>(null)
  const [facing, setFacing] = useState<AssignmentDirection>(DEFAULT_DIRECTION)
  const facingRef = useRef<AssignmentDirection>(DEFAULT_DIRECTION)
  const [newStateName, setNewStateName] = useState('')
  const [message, setMessage] = useState('Las variaciones se guardan en este navegador (botón Guardar) y se aplican a todos con «Publicar al servidor» (solo administradores).')

  // Animations are read once per visit so edits made in the animation editor show up on return.
  const documentCache = useRef(new Map<string, Promise<AnimationEditorDocument>>())
  const loadDocument = useCallback<DocumentLoader>((id) => {
    let pending = documentCache.current.get(id)
    if (!pending) {
      pending = loadAnimation(id).then((record) => record.document)
      documentCache.current.set(id, pending)
      pending.catch(() => documentCache.current.delete(id))
    }
    return pending
  }, [])

  useEffect(() => {
    // Drop the one-shot ?new=1 so a reload does not reopen the dialog.
    if (initial.openCreate) window.history.replaceState({}, '', window.location.pathname)
  }, [initial.openCreate])

  useEffect(() => {
    let cancelled = false
    listAnimations()
      .then((records) => { if (!cancelled) { setAnimations(records); setCatalogStatus('ready') } })
      .catch(() => { if (!cancelled) setCatalogStatus('error') })
    return () => { cancelled = true }
  }, [])

  const modalOpen = Boolean(variationDialog || pendingPath)
  const activeHeldDirection = modalOpen ? null : heldDirection

  // Simulated movement: arrows or WASD. Holding two keys gives the diagonal.
  useEffect(() => {
    if (modalOpen) return
    const pressed = new Set<string>()
    const update = () => {
      let dx = 0
      let dy = 0
      for (const code of pressed) { dx += MOVEMENT_KEYS[code][0]; dy += MOVEMENT_KEYS[code][1] }
      if (dx === 0 && dy === 0) {
        setHeldDirection(null)
        return
      }
      // Pure up or down has no slot (the character is always in profile): keep the last direction.
      const direction = directionFromVector(dx, dy) ?? facingRef.current
      facingRef.current = direction
      setFacing(direction)
      setHeldDirection(direction)
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (!(event.code in MOVEMENT_KEYS) || event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || event.isComposing) return
      const target = event.target
      if (target instanceof HTMLElement && (target.closest('input, textarea, select, dialog') || target.isContentEditable)) return
      event.preventDefault()
      if (pressed.has(event.code)) return
      pressed.add(event.code)
      update()
    }
    const handleKeyUp = (event: KeyboardEvent) => {
      if (!pressed.delete(event.code)) return
      update()
    }
    const releaseAll = () => { pressed.clear(); update() }
    window.addEventListener('keydown', handleKeyDown)
    window.addEventListener('keyup', handleKeyUp)
    window.addEventListener('blur', releaseAll)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
      window.removeEventListener('keyup', handleKeyUp)
      window.removeEventListener('blur', releaseAll)
    }
  }, [modalOpen])

  const states = listStates(data)
  const selectedState = states.find((state) => state.id === selectedStateId) ?? states[0]
  const activeSlot = slotKey(selectedState.id, selectedDirection)
  const selectedLabel = slotLabel(selectedState, selectedDirection)
  const variation = data.variations.find((item) => item.id === selectedVariationId) ?? null
  const ownId = variation?.assignments[activeSlot]
  const resolved = variation ? resolveSlotAnimation(data, variation.id, activeSlot) : null
  const isDefaultVariation = variation?.id === DEFAULT_VARIATION_ID
  const defaultAnimation = DEFAULT_SLOT_ANIMATIONS[activeSlot]

  const animationName = (id: string) => animations.find((item) => item.id === id)?.name
  const isMissing = (id: string | undefined) => Boolean(id) && catalogStatus === 'ready' && !animationName(id as string)

  const detailAnimation = resolved
    ? (animationName(resolved.animationId) ?? (catalogStatus === 'ready' ? 'Animación eliminada' : 'Cargando…'))
    : defaultAnimation ? `Juego · ${defaultAnimation}` : 'Sin animación'
  const detailOrigin = ownId ? 'Propia' : resolved ? 'Heredada de Default' : defaultAnimation ? 'Predeterminada del juego' : 'Sin asignar'

  // The center is a reference that behaves like the game, whichever tab is open: Walk while
  // a key is held, Idle (facing the last direction) when stopped.
  const playState = states.find((state) => state.id === (activeHeldDirection ? 'walk' : 'idle')) ?? states[0]
  const playDirection = activeHeldDirection ?? facing
  const playSlot = variation ? resolveSlotAnimation(data, variation.id, slotKey(playState.id, playDirection)) : null
  const playMissing = isMissing(playSlot?.animationId)
  const previewAnimationId = playSlot && !playMissing ? playSlot.animationId : null
  const playLabel = slotLabel(playState, playDirection)
  const playDefault = DEFAULT_SLOT_ANIMATIONS[slotKey(playState.id, playDirection)]
  const previewCaption = !variation
    ? 'Crea una variación (por ejemplo “Levitar” o “Nadar”) para elegir qué animación usa cada estado.'
    : playMissing
      ? `${playLabel}: la animación asignada ya no existe. Elige otra del catálogo.`
      : playSlot
        ? `${playLabel} · ${animationName(playSlot.animationId) ?? 'Animación'}${playSlot.inherited ? ' · heredada de Default' : ''}`
        : playDefault
          ? `${playLabel}: sin animación en esta variación. El juego usa su animación predeterminada (${playDefault}).`
          : `${playLabel}: sin animación.`

  // Edits stay in a draft until the user saves them.
  const commit = (next: AnimationAssignments, successMessage: string) => {
    setData(next)
    setMessage(successMessage)
  }

  const persist = (next: AnimationAssignments, successMessage: string) => {
    if (!saveAssignments(next)) {
      setMessage('No se pudo guardar en este navegador.')
      return false
    }
    setSavedData(next)
    setMessage(successMessage)
    return true
  }

  const [isPublishing, setIsPublishing] = useState(false)
  // El rol guardado en el navegador puede estar desactualizado; el servidor valida el rol real al publicar.
  const canPublish = Boolean(session)
  const handlePublish = async () => {
    if (!session || isPublishing) return
    if (hasUnsavedChanges) { setMessage('Guarda los cambios antes de publicar.'); return }
    if (!window.confirm('Publicar cambiará las animaciones de todos los jugadores del servidor. ¿Continuar?')) return
    setIsPublishing(true)
    const result = await publishAvatarAnimations(session, savedData, setMessage)
    setIsPublishing(false)
    setMessage(result.ok ? 'Publicado: los cambios ya aplican a todos los jugadores.' : (result.message ?? 'No se pudo publicar.'))
  }

  const handleExportPack = async () => {
    const built = await buildAnimationPack(savedData)
    if (!built.ok) { setMessage(built.message); return }
    downloadAnimationPack(built.pack)
    setMessage(`Paquete exportado (${built.pack.animations.length} animaciones). Para incluirlo en el juego, guárdalo como apps/web/src/game/avatar/defaultAnimationPack.json.`)
  }

  const handleImportPack = async (file: File | undefined) => {
    if (!file || !session || isPublishing) return
    const parsed = parseAnimationPack(await file.text())
    if (!parsed.ok) { setMessage(parsed.message); return }
    if (!window.confirm(`Se publicará el paquete (${parsed.pack.animations.length} animaciones, ${parsed.pack.config.variations.length} variaciones) para todos los jugadores. ¿Continuar?`)) return
    setIsPublishing(true)
    const result = await publishAnimationPack(session, parsed.pack, setMessage)
    setIsPublishing(false)
    setMessage(result.ok ? 'Paquete publicado: los cambios ya aplican a todos los jugadores.' : (result.message ?? 'No se pudo publicar el paquete.'))
  }

  const [history, setHistory] = useState<AnimationHistoryVersion[] | null>(null)
  const handleOpenHistory = async () => {
    if (!session || isPublishing) return
    setMessage('Consultando el historial…')
    const result = await listAnimationHistory(session)
    if (!result.ok || !result.versions) { setMessage(result.message ?? 'No se pudo cargar el historial.'); return }
    setMessage(result.versions.length ? 'Historial cargado.' : 'Todavía no hay versiones en el historial.')
    setHistory(result.versions)
  }
  const handleRestore = async (version: AnimationHistoryVersion) => {
    if (!session || isPublishing) return
    if (!window.confirm('Restaurar esta versión cambiará las animaciones de todos los jugadores. ¿Continuar?')) return
    setIsPublishing(true)
    const result = await restoreAnimationVersion(session, version.id)
    setIsPublishing(false)
    setHistory(null)
    setMessage(result.ok ? 'Versión restaurada: ya aplica a todos los jugadores.' : (result.message ?? 'No se pudo restaurar.'))
  }

  const handleSave = () => persist(data, 'Variaciones guardadas en este navegador.')

  const go = (path: string) => {
    if (!hasUnsavedChanges) {
      navigateInApp(path)
      return
    }
    setLeaveError('')
    setPendingPath(path)
  }

  const saveAndLeave = () => {
    if (!pendingPath) return
    setIsSaving(true)
    const saved = handleSave()
    setIsSaving(false)
    if (!saved) {
      setLeaveError('No se pudo guardar en este navegador.')
      return
    }
    navigateInApp(pendingPath)
  }

  useEffect(() => {
    if (!hasUnsavedChanges) return
    const warnBeforeUnload = (event: BeforeUnloadEvent) => { event.preventDefault() }
    window.addEventListener('beforeunload', warnBeforeUnload)
    return () => window.removeEventListener('beforeunload', warnBeforeUnload)
  }, [hasUnsavedChanges])

  const saveShortcut = useRef(handleSave)
  useEffect(() => { saveShortcut.current = handleSave })
  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.altKey || event.shiftKey || event.key.toLowerCase() !== 's') return
      event.preventDefault()
      saveShortcut.current()
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [])

  const updateVariation = (update: (current: AnimationVariation) => AnimationVariation, successMessage: string) => {
    if (!variation) return
    commit({ ...data, variations: data.variations.map((item) => item.id === variation.id ? update(item) : item) }, successMessage)
  }

  // Choosing a direction edits it and also points the center at it, so the preview follows the click.
  const selectDirection = (direction: AssignmentDirection) => {
    setSelectedDirection(direction)
    facingRef.current = direction
    setFacing(direction)
  }

  const assign = (animation: AnimationSummary, direction: AssignmentDirection = selectedDirection) => {
    if (!variation) return
    const key = slotKey(selectedState.id, direction)
    selectDirection(direction)
    updateVariation(
      (current) => ({ ...current, assignments: { ...current.assignments, [key]: animation.id } }),
      `${variation.name} · ${slotLabel(selectedState, direction)} ahora usa “${animation.name}”.`,
    )
  }

  const clearAssignment = (direction: AssignmentDirection = selectedDirection) => {
    const key = slotKey(selectedState.id, direction)
    if (!variation?.assignments[key]) return
    updateVariation(
      (current) => ({
        ...current,
        assignments: Object.fromEntries(Object.entries(current.assignments).filter(([item]) => item !== key)),
        settings: Object.fromEntries(Object.entries(current.settings).filter(([item]) => item !== key)),
      }),
      `${variation.name} · ${slotLabel(selectedState, direction)} ${isDefaultVariation ? (DEFAULT_SLOT_ANIMATIONS[key] ? 'volvió a la animación del juego' : 'quedó vacío') : 'vuelve a heredar de Default'}.`,
    )
  }

  // Flip settings belong to the selected slot. An inherited slot gets its own entry as soon
  // as it is changed, so Default keeps its own value.
  const setFlip = (axis: 'flipX' | 'flipY', value: boolean) => {
    if (!variation || !resolved) return
    const next = { flipX: resolved.flipX, flipY: resolved.flipY, [axis]: value }
    // A slot only stores settings when they differ from what it would use anyway:
    // Default's values for an inherited animation, the convention otherwise.
    const baseline = resolved.inherited
      ? resolveSlotAnimation(data, DEFAULT_VARIATION_ID, activeSlot) ?? conventionalFlip(activeSlot)
      : conventionalFlip(activeSlot)
    const needsEntry = next.flipX !== baseline.flipX || next.flipY !== baseline.flipY
    const axisName = axis === 'flipX' ? 'X' : 'Y'
    updateVariation(
      (current) => {
        const settings = Object.fromEntries(Object.entries(current.settings).filter(([item]) => item !== activeSlot))
        return { ...current, settings: needsEntry ? { ...settings, [activeSlot]: next } : settings }
      },
      `${variation.name} · ${selectedLabel}: invertir en ${axisName} ${value ? 'activado' : 'desactivado'}.`,
    )
  }

  const addVariation = (requestedName: string, assignments: Record<string, string>, settings: AnimationVariation['settings'], successMessage: (name: string) => string) => {
    const name = requestedName.trim().slice(0, MAX_VARIATION_NAME_LENGTH)
    if (!name) return
    if (data.variations.some((item) => item.name.toLowerCase() === name.toLowerCase())) {
      setVariationError(`Ya existe una variación llamada “${name}”.`)
      return
    }
    const id = crypto.randomUUID()
    const next = { ...data, variations: [...data.variations, { id, name, assignments, settings }] }
    setData(next)
    if (!persist(next, successMessage(name))) setMessage('No se pudo guardar en este navegador. La variación quedó sin guardar.')
    setSelectedVariationId(id)
    setVariationDialog(null)
    setVariationError('')
  }

  const createVariation = (name: string) => addVariation(name, {}, {}, (created) => (
    `Variación “${created}” creada. Lo que no asignes se tomará de Default.`
  ))

  const saveVariationAs = (name: string) => addVariation(name, { ...variation?.assignments }, structuredClone(variation?.settings ?? {}), (created) => (
    `“${variation?.name}” guardada como “${created}”.`
  ))

  const removeVariation = () => {
    if (!variation || isDefaultVariation || !window.confirm(`¿Eliminar la variación “${variation.name}” y sus asignaciones?`)) return
    const remaining = data.variations.filter((item) => item.id !== variation.id)
    commit({ ...data, variations: remaining }, `Variación “${variation.name}” eliminada.`)
    setSelectedVariationId(DEFAULT_VARIATION_ID)
  }

  const addState = (event: FormEvent) => {
    event.preventDefault()
    const name = newStateName.trim().slice(0, MAX_STATE_NAME_LENGTH)
    if (!name) return
    if (states.some((state) => state.name.toLowerCase() === name.toLowerCase())) {
      setMessage(`Ya existe un estado llamado “${name}”.`)
      return
    }
    const id = crypto.randomUUID()
    commit({ ...data, customStates: [...data.customStates, { id, name }] }, `Estado “${name}” creado.`)
    setNewStateName('')
    setSelectedStateId(id)
  }

  const removeState = (id: string, name: string) => {
    if (!window.confirm(`¿Eliminar el estado “${name}” y sus asignaciones?`)) return
    const variations = data.variations.map((item) => ({
      ...item,
      assignments: Object.fromEntries(Object.entries(item.assignments).filter(([key]) => !key.startsWith(`${id}:`))),
      settings: Object.fromEntries(Object.entries(item.settings).filter(([key]) => !key.startsWith(`${id}:`))),
    }))
    commit({ ...data, customStates: data.customStates.filter((state) => state.id !== id), variations }, `Estado “${name}” eliminado.`)
    if (selectedState.id === id) setSelectedStateId('idle')
  }

  const handleSlotDrop = (event: DragEvent, direction: AssignmentDirection) => {
    event.preventDefault()
    setDropDirection(null)
    const animation = animations.find((item) => item.id === event.dataTransfer.getData(ANIMATION_DRAG_TYPE))
    if (animation) assign(animation, direction)
  }

  return (
    <DocumentLoaderContext.Provider value={loadDocument}>
    <main className="edit-room-page animation-editor-page" aria-label="Asignación de animaciones">
      {pendingPath && (
        <AnimationLeaveDialog
          saving={isSaving}
          error={leaveError}
          message="¿Quieres guardar las variaciones antes de salir?"
          onSave={saveAndLeave}
          onDiscard={() => navigateInApp(pendingPath)}
          onCancel={() => setPendingPath(null)}
        />
      )}
      {variationDialog && (
        <VariationDialog
          key={variationDialog}
          title={variationDialog === 'saveAs' ? 'Guardar como' : 'Crear variación'}
          initialName={variationDialog === 'saveAs' && variation ? `${variation.name.slice(0, MAX_VARIATION_NAME_LENGTH - 7)} copia` : ''}
          description={variationDialog === 'saveAs'
            ? `Crea una variación nueva con una copia de las asignaciones de “${variation?.name}”.`
            : 'Una variación agrupa qué animación usa cada estado. Lo que no asignes se tomará de Default.'}
          submitLabel={variationDialog === 'saveAs' ? 'Guardar' : 'Crear'}
          error={variationError}
          onSubmit={variationDialog === 'saveAs' ? saveVariationAs : createVariation}
          onClose={() => setVariationDialog(null)}
        />
      )}
      <header className="edit-room-toolbar">
        <strong className="edit-room-scene-name">Asignación de animaciones</strong>
        <section className="edit-room-map-size" aria-label="Variación activa">
          <label>
            <span>Variación</span>
            <select
              className="animation-editor-saved-select"
              style={{ width: 200 }}
              aria-label="Variación activa"
              value={variation?.id ?? ''}
              disabled={data.variations.length === 0}
              onChange={(event) => setSelectedVariationId(event.target.value)}
            >
              {data.variations.length === 0 && <option value="">Sin variaciones</option>}
              {data.variations.map((item) => <option key={item.id} value={item.id}>{item.name} · {countAssigned(item)}</option>)}
            </select>
          </label>
        </section>
        <button type="button" className="edit-room-exit-button" disabled={!hasUnsavedChanges} title="Guardar los cambios (Ctrl/Cmd + S)" onClick={handleSave}>Guardar</button>
        <button type="button" className="edit-room-exit-button" disabled={!variation} title="Duplicar la variación activa con otro nombre" onClick={() => { setVariationError(''); setVariationDialog('saveAs') }}>Guardar como</button>
        <button type="button" className="edit-room-exit-button" disabled={!variation || isDefaultVariation} title={isDefaultVariation ? 'Default es la variación de referencia y no se puede eliminar' : 'Eliminar la variación activa'} onClick={removeVariation}>Eliminar variación</button>
        <div className="edit-room-toolbar-spacer" />
        {canPublish && (
          <button type="button" className="edit-room-exit-button" disabled={isPublishing || hasUnsavedChanges} title="Aplicar las variaciones guardadas a todo el servidor (solo administradores)" onClick={handlePublish}>{isPublishing ? 'Publicando…' : 'Publicar al servidor'}</button>
        )}
        <button type="button" className="edit-room-exit-button" disabled={hasUnsavedChanges} title="Descargar las variaciones guardadas y sus animaciones como archivo JSON" onClick={handleExportPack}>Exportar paquete</button>
        {canPublish && (
          <>
            <label className="edit-room-exit-button" title="Publicar un paquete JSON para todo el servidor (solo administradores)" style={{ cursor: 'pointer' }}>
              Importar paquete
              <input type="file" accept="application/json,.json" hidden disabled={isPublishing} onChange={(event) => { void handleImportPack(event.target.files?.[0]); event.target.value = '' }} />
            </label>
            <button type="button" className="edit-room-exit-button" disabled={isPublishing} title="Ver y restaurar publicaciones anteriores (solo administradores)" onClick={handleOpenHistory}>Historial</button>
          </>
        )}
        <button type="button" className="edit-room-exit-button" onClick={() => go('/editor/animations')}>Crear animación</button>
        <button type="button" className="edit-room-exit-button" onClick={() => go('/editor')}>Volver</button>
      </header>
      <section className="edit-room-layout animation-editor-layout" aria-label="Espacio de asignación">
        <aside className="animation-editor-sidebar is-left edit-room-panel edit-room-layers-section animation-editor-hierarchy" aria-label="Estados de animación">
          <header><span>Estados</span><output>{states.length}</output></header>
          <div className="edit-room-panel-body edit-room-layers-body">
            <form className="edit-room-layer-creator" onSubmit={addState}>
              <input
                type="text"
                aria-label="Nombre del nuevo estado"
                placeholder="Nuevo estado (ej. Interactuar)"
                maxLength={MAX_STATE_NAME_LENGTH}
                value={newStateName}
                onChange={(event) => setNewStateName(event.target.value)}
              />
              <button type="submit" aria-label="Crear estado" title="Crear estado" disabled={!newStateName.trim()}>+</button>
            </form>
            <div className="edit-room-layer-list" role="list" aria-label="Estados">
              {states.map((state) => {
                const assignedCount = ASSIGNMENT_DIRECTIONS.filter((direction) => variation?.assignments[slotKey(state.id, direction.id)]).length
                return (
                  <div key={state.id} className="edit-room-layer-node" role="listitem">
                    <div className={`edit-room-layer-row${selectedState.id === state.id ? ' is-active' : ''}`}>
                      <button type="button" className="edit-room-layer-select" aria-pressed={selectedState.id === state.id} title={`Editar las ${ASSIGNMENT_DIRECTIONS.length} direcciones de ${state.name}`} onClick={() => setSelectedStateId(state.id)}>
                        <span className="edit-room-layer-icon-slot" aria-hidden="true" />
                        <span className="edit-room-layer-name">{state.name}</span>
                      </button>
                      <span className="edit-room-layer-mode" title={`${assignedCount} de ${ASSIGNMENT_DIRECTIONS.length} direcciones con animación propia`}>{assignedCount}/{ASSIGNMENT_DIRECTIONS.length}</span>
                      {!state.builtin && (
                        <button type="button" className="edit-room-layer-delete" aria-label={`Eliminar estado ${state.name}`} title={`Eliminar ${state.name}`} onClick={() => removeState(state.id, state.name)}>×</button>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        </aside>
        <section className="edit-room-workspace" aria-label="Vista previa de la asignación">
          <div className="edit-room-canvas-viewport animation-editor-viewport" role="region" aria-label="Brújula de direcciones">
            <div className="animation-editor-stage animation-assignments-stage">
              <div className="animation-assignments-tabs" role="group" aria-label="Estado de animación">
                {states.map((state) => (
                  <button
                    key={state.id}
                    type="button"
                    className="animation-assignments-tab"
                    aria-pressed={selectedState.id === state.id}
                    title={`Asignar las ${ASSIGNMENT_DIRECTIONS.length} direcciones de ${state.name}`}
                    onClick={() => setSelectedStateId(state.id)}
                  >
                    {state.name}
                    <small>{ASSIGNMENT_DIRECTIONS.filter((direction) => variation?.assignments[slotKey(state.id, direction.id)]).length}/{ASSIGNMENT_DIRECTIONS.length}</small>
                  </button>
                ))}
              </div>
              <div className="animation-assignments-compass" role="group" aria-label={`Direcciones de ${selectedState.name}`}>
                {ASSIGNMENT_DIRECTIONS.map((direction) => {
                  const key = slotKey(selectedState.id, direction.id)
                  const slot = variation ? resolveSlotAnimation(data, variation.id, key) : null
                  const missing = isMissing(slot?.animationId)
                  const own = Boolean(variation?.assignments[key])
                  const label = slotLabel(selectedState, direction.id)
                  const name = slot ? (animationName(slot.animationId) ?? (catalogStatus === 'ready' ? 'eliminada' : '')) : ''
                  return (
                    <div
                      key={direction.id}
                      className="animation-assignments-slot-cell"
                      style={{ gridRow: direction.row, gridColumn: direction.column }}
                      onDragOver={(event) => {
                        if (!variation || !event.dataTransfer.types.includes(ANIMATION_DRAG_TYPE)) return
                        event.preventDefault()
                        event.dataTransfer.dropEffect = 'copy'
                        setDropDirection(direction.id)
                      }}
                      onDragLeave={(event) => {
                        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDropDirection(null)
                      }}
                      onDrop={(event) => handleSlotDrop(event, direction.id)}
                    >
                      <button
                        type="button"
                        className={`animation-assignments-slot${selectedDirection === direction.id ? ' is-selected' : ''}${playDirection === direction.id ? ' is-active' : ''}${slot?.inherited ? ' is-inherited' : ''}${dropDirection === direction.id ? ' is-drop-target' : ''}`}
                        aria-pressed={selectedDirection === direction.id}
                        title={`${label}${name ? ` · ${name}${slot?.inherited ? ' (de Default)' : ''}` : ' · sin animación'} · Arrastra una animación aquí o elige una del catálogo`}
                        onClick={() => selectDirection(direction.id)}
                      >
                        <AnimationScene animationId={slot && !missing ? slot.animationId : null} label={label} fitSize={SLOT_SIZE} decorative flipX={slot?.flipX} flipY={slot?.flipY} />
                        <span className="animation-assignments-slot-label">{direction.label}</span>
                        {(slot?.flipX || slot?.flipY) && <span className="animation-assignments-slot-flip" title="Invertida">{slot.flipX ? '↔' : ''}{slot.flipY ? '↕' : ''}</span>}
                        {name && <span className="animation-assignments-slot-name">{slot?.inherited ? '↳ ' : ''}{name}</span>}
                      </button>
                      {own && (
                        <button type="button" className="animation-assignments-slot-clear" aria-label={`Quitar la animación de ${label}`} title={isDefaultVariation ? 'Quitar la asignación' : 'Quitar y heredar de Default'} onClick={() => { selectDirection(direction.id); clearAssignment(direction.id) }}>×</button>
                      )}
                      <span className="animation-assignments-arrow" data-direction={direction.id} aria-hidden="true">{direction.arrow}</span>
                    </div>
                  )
                })}
                <div className="animation-assignments-reference">
                  <AnimationScene animationId={previewAnimationId} label={playLabel} scale={REFERENCE_ZOOM} flipX={playSlot?.flipX} flipY={playSlot?.flipY} />
                </div>
              </div>
              <p className="animation-assignments-caption" aria-live="polite">{previewCaption}</p>
              <p className="animation-assignments-hint">Mueve con las flechas o WASD (dos teclas = diagonal) para simular la dirección. Arriba o abajo solos mantienen la última dirección.</p>
            </div>
          </div>
        </section>
        <aside className="edit-room-inspector-sidebar animation-editor-inspector animation-assignments-inspector" aria-label="Detalles y catálogo de animaciones">
          <section className="edit-room-panel edit-room-details-panel animation-assignments-details" aria-label="Detalles de la dirección seleccionada">
            <header><span>Detalles</span><output>{selectedLabel}</output></header>
            <div className="edit-room-panel-body edit-room-details-body">
              {variation ? (
                <div className="edit-room-details-content">
                  <dl className="edit-room-details-fields">
                    <div className="edit-room-details-field is-name">
                      <dt>Animación</dt>
                      <dd title={detailAnimation}>{detailAnimation}</dd>
                    </div>
                    <div className="edit-room-details-field">
                      <dt>Variación</dt>
                      <dd title={variation.name}>{variation.name}</dd>
                    </div>
                    <div className="edit-room-details-field">
                      <dt>Origen</dt>
                      <dd title={detailOrigin}>{detailOrigin}</dd>
                    </div>
                    <div className="edit-room-details-field">
                      <dt>Estado</dt>
                      <dd title={selectedState.name}>{selectedState.name}</dd>
                    </div>
                    <div className="edit-room-details-field">
                      <dt>Dirección</dt>
                      <dd>{ASSIGNMENT_DIRECTIONS.find((item) => item.id === selectedDirection)?.arrow} {selectedDirection.toUpperCase()}</dd>
                    </div>
                  </dl>
                  <fieldset className="edit-room-property-group" disabled={!resolved}>
                    <legend>Invertir escala</legend>
                    <div className="animation-assignments-toggles">
                      <label className="animation-assignments-toggle">
                        <input type="checkbox" checked={Boolean(resolved?.flipX)} onChange={(event) => setFlip('flipX', event.target.checked)} />
                        <span>Eje X <small>(espejo horizontal)</small></span>
                      </label>
                      <label className="animation-assignments-toggle">
                        <input type="checkbox" checked={Boolean(resolved?.flipY)} onChange={(event) => setFlip('flipY', event.target.checked)} />
                        <span>Eje Y <small>(espejo vertical)</small></span>
                      </label>
                    </div>
                    {!resolved && <p className="edit-room-layer-empty">Asigna una animación para poder invertirla.</p>}
                  </fieldset>
                  <button
                    type="button"
                    className="edit-room-exit-button"
                    disabled={!ownId}
                    title={isDefaultVariation ? 'Quitar la animación de esta dirección' : 'Quitar la animación propia y heredar de Default'}
                    onClick={() => clearAssignment()}
                  >
                    {isDefaultVariation ? 'Quitar asignación' : 'Heredar de Default'}
                  </button>
                </div>
              ) : <p className="edit-room-layer-empty">Crea una variación para ver y editar los detalles de cada dirección.</p>}
            </div>
          </section>
          <section className="edit-room-panel animation-assignments-catalog" aria-label="Animaciones guardadas">
            <header><span>Catálogo</span><output>{animations.length}</output></header>
            <div className="edit-room-panel-body edit-room-layers-body">
              {catalogStatus === 'loading' && <p className="edit-room-layer-empty">Cargando animaciones…</p>}
              {catalogStatus === 'error' && <p className="edit-room-layer-empty">No se pudieron leer las animaciones de este navegador.</p>}
              {catalogStatus === 'ready' && animations.length === 0 && <p className="edit-room-layer-empty">Todavía no hay animaciones guardadas. Crea una en el editor de animaciones.</p>}
              <div className="animation-assignments-catalog-grid">
                {animations.map((animation) => (
                  <CatalogCard
                    key={animation.id}
                    animation={animation}
                    selected={ownId === animation.id}
                    disabled={!variation}
                    targetLabel={selectedLabel}
                    onAssign={() => assign(animation)}
                    onDragEnd={() => setDropDirection(null)}
                  />
                ))}
              </div>
            </div>
          </section>
        </aside>
      </section>
      {history && (
        <div role="dialog" aria-label="Historial de versiones" style={{ position: 'fixed', top: 70, right: 16, zIndex: 50, width: 340, maxHeight: '70vh', overflow: 'auto', padding: 12, background: '#2a2220', color: '#fff', border: '1px solid #7a4a2a', borderRadius: 8, boxShadow: '0 8px 24px rgba(0,0,0,.4)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
            <strong>Historial de versiones</strong>
            <button type="button" className="edit-room-exit-button" onClick={() => setHistory(null)}>Cerrar</button>
          </div>
          {history.length === 0 && <p>No hay versiones guardadas todavía.</p>}
          {history.map((version, index) => (
            <div key={version.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, padding: '6px 0', borderTop: '1px solid rgba(255,255,255,.15)' }}>
              <span style={{ fontSize: 13 }}>
                {new Date(version.createdAt).toLocaleString()}{index === 0 ? ' · actual' : ''}<br />
                {version.variations} variaciones · {version.animations} animaciones · {version.createdBy}
              </span>
              <button type="button" className="edit-room-exit-button" disabled={isPublishing || index === 0} onClick={() => handleRestore(version)}>Restaurar</button>
            </div>
          ))}
        </div>
      )}
      <footer className="edit-room-statusbar"><span role="status">{message}{hasUnsavedChanges ? ' · Cambios sin guardar' : ''}</span><span>{variation ? `${variation.name} · ${selectedLabel}` : selectedLabel}</span></footer>
    </main>
    </DocumentLoaderContext.Provider>
  )
}
