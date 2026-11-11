import { skinReferenceImages, skinReferenceGroups, type SkinReferenceImage } from '../game/avatar/skinReferenceCatalog'
import EditorGridGuides from './EditorGridGuides'
import NumericAxisScrubber from './NumericAxisScrubber'
import { useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type MouseEvent, type SetStateAction } from 'react'
import { PIVOT_GRID_SIZE, placeImagePivot, snapPivotCoordinate } from '../game/avatar/pivotPlacement'
import { getAnimationElapsedMs, getAnimationFrameIndex, subscribeAnimationClock } from '../game/avatar/animationClock'
import { useUndoableState } from '../hooks/useUndoableState'
import { avatarAnimations, chapFrontEquipment } from '../game/avatar/layeredAvatar'
import shadowUrl from '../assets/characters/Chap/Sombra_0.svg'
import zoomInIconSrc from '../assets/room-editor/sprites/icon_zoom_add.svg'
import zoomOutIconSrc from '../assets/room-editor/sprites/icon_zoom_less.svg'
import { embedAnimationImages, saveAnimation, loadAnimation, listAnimations, type AnimationSummary, type EditorImageLayer, type EditorFrame } from '../game/avatar/animationEditorStorage'
import { navigateInApp } from '../hooks/usePathname'

const PIXELS_PER_UNIT = 128
const MIN_ZOOM = 0.25
const MAX_ZOOM = 20
const ZOOM_STEP = 0.25
const SKIN_REFERENCE_DRAG_TYPE = 'application/x-social-sena-skin-reference'

function createInitialFrame(): EditorFrame {
  return {
    id: 'frame-0',
    durationMs: 85,
    layers: Object.entries(avatarAnimations.idle.frames[0].layers)
      .sort((a, b) => b[1].order - a[1].order)
      .flatMap(([part, pose]) => {
        const url = part === 'sombra' ? shadowUrl : chapFrontEquipment[part as keyof typeof chapFrontEquipment]?.url
        return url ? [{ id: part, name: part, url, visible: true, x: pose.x, y: pose.y, rotation: pose.rotation, rotationX: 0, rotationY: 0, pivotX: 0, pivotY: 0 }] : []
      }),
  }
}

type LayerDetailProperty = 'x' | 'y' | 'rotationX' | 'rotationY' | 'pivotX' | 'pivotY'

function normalizeDetailValue(property: LayerDetailProperty, value: number) {
  return property === 'pivotX' || property === 'pivotY' ? snapPivotCoordinate(value) : value
}

function LayerDetails({ layer, frameIndex, onChange, onResetPosition, onPickPivot, pickingPivot, onScrubPreview, onScrubCancel }: {
  layer: EditorImageLayer
  frameIndex: number
  onChange: (property: LayerDetailProperty, value: number) => void
  onResetPosition: () => void
  onPickPivot: () => void
  pickingPivot: boolean
  onScrubPreview: (property: LayerDetailProperty, value: number) => void
  onScrubCancel: () => void
}) {
  const [editingProperty, setEditingProperty] = useState<LayerDetailProperty | null>(null)
  const [inputs, setInputs] = useState(() => ({
    x: String(layer.x), y: String(layer.y),
    rotationX: String(layer.rotationX), rotationY: String(layer.rotationY),
    pivotX: String(layer.pivotX), pivotY: String(layer.pivotY),
  }))
  const groups: { name: string; unit: string; properties: [LayerDetailProperty, LayerDetailProperty] }[] = [
    { name: 'Posición', unit: 'px', properties: ['x', 'y'] },
    { name: 'Rotación', unit: '°', properties: ['rotationX', 'rotationY'] },
    { name: 'Pivote', unit: 'px', properties: ['pivotX', 'pivotY'] },
  ]
  return (
    <div className="edit-room-details-content">
      <dl className="edit-room-details-fields">
        <div className="edit-room-details-field is-name">
          <dt>Imagen · Frame {frameIndex}</dt>
          <dd title={layer.name}>{layer.name}</dd>
        </div>
      </dl>
      {groups.map((group) => (
        <fieldset key={group.name} className="edit-room-property-group">
          <legend>{group.name} <span>({group.unit})</span></legend>
          <div className={group.name === 'Pivote' ? 'animation-editor-pivot-controls' : ''}>
            {group.name === 'Pivote' && (
              <button
                type="button"
                className="edit-room-exit-button animation-editor-pivot-button"
                aria-label={pickingPivot ? 'Cancelar asignación del pivote' : 'Asignar pivote en el viewport'}
                title={pickingPivot ? 'Cancelar pivote' : 'Asignar pivote en el viewport'}
                aria-pressed={pickingPivot}
                onClick={onPickPivot}
                disabled={!layer.visible}
              >
                <span className="animation-editor-pivot-button-icon" aria-hidden="true"><span className="animation-editor-pivot" /></span>
              </button>
            )}
            <div className="edit-room-property-axes">
              {group.properties.map((property, index) => (
                <label key={property} className="edit-room-property-axis">
                  <NumericAxisScrubber
                    axis={index === 0 ? 'X' : 'Y'}
                    label={`${group.name} ${index === 0 ? 'X' : 'Y'}`}
                    value={layer[property]}
                    onStart={() => { setEditingProperty(null); onScrubPreview(property, layer[property]) }}
                    onPreview={(value) => onScrubPreview(property, value)}
                    onCommit={(value) => { onScrubCancel(); onChange(property, value) }}
                    onCancel={onScrubCancel}
                  />
                  <input
                    className="edit-room-details-input"
                    type="number"
                    step={group.name === 'Pivote' ? PIVOT_GRID_SIZE : 'any'}
                    aria-label={`${group.name} ${index === 0 ? 'X' : 'Y'} (${group.unit})`}
                    value={editingProperty === property ? inputs[property] : String(layer[property])}
                    onFocus={() => {
                      setEditingProperty(property)
                      setInputs((previous) => ({ ...previous, [property]: String(layer[property]) }))
                    }}
                    onChange={(event) => {
                      const value = event.target.value
                      setInputs((previous) => ({ ...previous, [property]: value }))
                      if (value.trim() && Number.isFinite(Number(value))) onChange(property, Number(value))
                    }}
                    onBlur={() => setEditingProperty(null)}
                    onKeyDown={(event) => { if (event.key === 'Enter') event.currentTarget.blur() }}
                  />
                </label>
              ))}
            </div>
          </div>
        </fieldset>
      ))}
      {pickingPivot && <p className="edit-room-layer-empty">Haz clic en el viewport. Escape para cancelar.</p>}
      <button type="button" className="edit-room-exit-button" onClick={onResetPosition} disabled={layer.x === 0 && layer.y === 0}>
        Reiniciar posición
      </button>
    </div>
  )
}

function AnimationTypeDialog({ onSelectSkin }: { onSelectSkin: () => void }) {
  const dialogRef = useRef<HTMLDialogElement>(null)

  useEffect(() => {
    const dialog = dialogRef.current
    dialog?.showModal()
    return () => dialog?.close()
  }, [])

  return (
    <dialog
      ref={dialogRef}
      className="animation-editor-start"
      aria-labelledby="animation-editor-start-title"
      aria-modal="true"
      onCancel={(event) => event.preventDefault()}
    >
      <section className="animation-editor-start-card">
        <h2 id="animation-editor-start-title">¿Qué vas a animar?</h2>
        <button type="button" className="edit-room-exit-button" onClick={onSelectSkin}>Skin</button>
        <button type="button" className="edit-room-exit-button" disabled>Asset</button>
        <p>Skin: personajes por capas y frames.</p>
      </section>
    </dialog>
  )
}

function AnimationSaveDialog({ initialName, saving, error, saveAs, onSave, onClose }: {
  initialName: string
  saveAs: boolean
  saving: boolean
  error: string
  onSave: (name: string) => void
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
      aria-labelledby="animation-save-title"
      aria-modal="true"
      onCancel={(event) => { event.preventDefault(); if (!saving) onClose() }}
    >
      <form onSubmit={(event) => { event.preventDefault(); if (!saving && name.trim()) onSave(name) }}>
        <h2 id="animation-save-title">{saveAs ? 'Guardar como' : 'Guardar animación'}</h2>
        <label>
          Nombre de la animación
          <input type="text" required maxLength={80} value={name} disabled={saving} onChange={(event) => setName(event.target.value)} />
        </label>
        <p>Se guardará en este navegador.</p>
        {error && <output role="alert">{error}</output>}
        <div className="edit-room-publication-actions">
          <button type="button" disabled={saving} onClick={onClose}>Cancelar</button>
          <button type="submit" disabled={saving || !name.trim()}>{saving ? 'Guardando…' : 'Guardar'}</button>
        </div>
      </form>
    </dialog>
  )
}

export default function AnimationEditorPage() {
  const [requestedAnimationId] = useState(() => new URLSearchParams(window.location.search).get('animation'))
  const [initialLoadPending, setInitialLoadPending] = useState(Boolean(requestedAnimationId))
  const [projectType, setProjectType] = useState<'skin' | null>(null)
  const { state: document, setState: setDocument, reset: resetDocument, undo, redo, canUndo, canRedo } = useUndoableState(() => ({
    frames: [createInitialFrame()],
    sceneSize: { width: 1, height: 1 },
  }))
  const { frames, sceneSize } = document
  const setFrames = useCallback((update: SetStateAction<EditorFrame[]>) => {
    setDocument((previous) => ({ ...previous, frames: typeof update === 'function' ? update(previous.frames) : update }))
  }, [setDocument])
  const [isSaveDialogOpen, setIsSaveDialogOpen] = useState(false)
  const [isSaveAs, setIsSaveAs] = useState(false)
  const [saveDialogError, setSaveDialogError] = useState('')
  const [animationName, setAnimationName] = useState('Nueva animación')
  const [savedAnimationId, setSavedAnimationId] = useState<string | null>(null)
  const [savedAnimations, setSavedAnimations] = useState<AnimationSummary[]>([])
  const [storageOperation, setStorageOperation] = useState<'save' | 'load' | null>(null)
  const [storageMessage, setStorageMessage] = useState('')
  const [savedFingerprint, setSavedFingerprint] = useState<string | null>(null)
  const fingerprint = JSON.stringify({ name: animationName.trim(), document })
  const hasUnsavedChanges = projectType && fingerprint !== savedFingerprint

  useEffect(() => {
    let cancelled = false
    listAnimations().then((animations) => {
      if (!cancelled) setSavedAnimations(animations)
    }).catch(() => {
      if (!cancelled) setStorageMessage('El almacenamiento local no está disponible.')
    })
    return () => { cancelled = true }
  }, [])

  const [selectedFrameId, setSelectedFrameId] = useState<string | null>(null)
  const [playbackOffsetMs, setPlaybackOffsetMs] = useState<number | null>(null)
  const [viewportZoom, setViewportZoom] = useState(1)
  const zoomDragStart = useRef(1)
  const [expandedFrames, setExpandedFrames] = useState<Set<string>>(() => new Set(['frame-0']))
  const [selectedLayerIds, setSelectedLayerIds] = useState<Set<string>>(() => new Set())
  const [draggedFrameId, setDraggedFrameId] = useState<string | null>(null)
  const [frameDropTarget, setFrameDropTarget] = useState<{ id: string; after: boolean } | null>(null)
  const [draggedLayer, setDraggedLayer] = useState<{ frameId: string; layerId: string } | null>(null)
  const [draggedReferenceId, setDraggedReferenceId] = useState<string | null>(null)
  const [dropTarget, setDropTarget] = useState<{ layerId: string; after: boolean } | null>(null)
  const [pivotPlacement, setPivotPlacement] = useState<string | null>(null)
  const [scrubPreview, setScrubPreview] = useState<{
    frameId: string; layerId: string; property: LayerDetailProperty; value: number
  } | null>(null)
  const viewportRef = useRef<HTMLDivElement>(null)
  const sceneScaleRef = useRef<HTMLDivElement>(null)
  const columnGuidesRef = useRef<HTMLDivElement>(null)
  const rowGuidesRef = useRef<HTMLDivElement>(null)
  const previewRef = useRef<HTMLDivElement>(null)
  const uploadedUrls = useRef<string[]>([])
  const subscribePlayback = useCallback((listener: () => void) => (
    playbackOffsetMs === null ? () => {} : subscribeAnimationClock(listener)
  ), [playbackOffsetMs])
  const getPlaybackFrameIndex = useCallback(() => (
    playbackOffsetMs === null
      ? (frames.findIndex((item) => item.id === selectedFrameId) < 0
          ? frames.length - 1
          : frames.findIndex((item) => item.id === selectedFrameId))
      : getAnimationFrameIndex({ frames }, getAnimationElapsedMs() - playbackOffsetMs)
  ), [frames, selectedFrameId, playbackOffsetMs])
  const frameIndex = useSyncExternalStore(subscribePlayback, getPlaybackFrameIndex, () => 0)
  const baseFrame = frames[frameIndex]
  const frame = scrubPreview?.frameId === baseFrame.id ? {
    ...baseFrame,
    layers: baseFrame.layers.map((layer) => layer.id === scrubPreview.layerId
      ? { ...layer, [scrubPreview.property]: scrubPreview.value } : layer),
  } : baseFrame
  const isPlaying = playbackOffsetMs !== null

  const togglePlayback = useCallback(() => {
    setPivotPlacement(null)
    if (isPlaying) {
      setSelectedFrameId(frame.id)
      setPlaybackOffsetMs(null)
    } else {
      const startMs = frames.slice(0, frameIndex).reduce((total, item) => total + item.durationMs, 0)
      setSelectedLayerIds(new Set())
      setPlaybackOffsetMs(getAnimationElapsedMs() - startMs)
    }
  }, [isPlaying, frame.id, frames, frameIndex])

  useEffect(() => {
    if (!projectType || isSaveDialogOpen) return
    const handleSpace = (event: KeyboardEvent) => {
      if (event.code !== 'Space' && event.key !== ' ') return
      if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || event.isComposing) return
      const target = event.target
      if (target instanceof HTMLElement && (target.closest('input, textarea, select, dialog') || target.isContentEditable)) return
      event.preventDefault()
      event.stopPropagation()
      if (!event.repeat) togglePlayback()
    }
    window.addEventListener('keydown', handleSpace, true)
    return () => window.removeEventListener('keydown', handleSpace, true)
  }, [projectType, isSaveDialogOpen, togglePlayback])
  const handleSave = async (requestedName: string, saveAs = false) => {
    if (!projectType || storageOperation) return
    const name = requestedName.trim().slice(0, 80)
    if (!name) {
      setStorageMessage('Escribe un nombre para guardar la animación.')
      return
    }
    const snapshot = document
    const snapshotFingerprint = JSON.stringify({ name, document: snapshot })
    setStorageOperation('save')
    setSaveDialogError('')
    setStorageMessage('Guardando…')
    try {
      const record = {
        version: 1 as const,
        id: saveAs ? crypto.randomUUID() : savedAnimationId ?? crypto.randomUUID(),
        name,
        type: projectType,
        updatedAt: new Date().toISOString(),
        document: await embedAnimationImages(snapshot),
      }
      await saveAnimation(record)
      setAnimationName(name)
      setSavedAnimationId(record.id)
      setSavedFingerprint(snapshotFingerprint)
      setSavedAnimations((previous) => [
        { id: record.id, name: record.name, updatedAt: record.updatedAt },
        ...previous.filter((item) => item.id !== record.id),
      ])
      setStorageMessage('Animación guardada en este navegador.')
      setIsSaveDialogOpen(false)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'No se pudo guardar la animación.'
      setStorageMessage(message)
      setSaveDialogError(message)
    } finally {
      setStorageOperation(null)
    }
  }

  const handleOpen = async (id: string) => {
    if (!id || storageOperation) return
    if (hasUnsavedChanges && !window.confirm('Hay cambios sin guardar. ¿Abrir otra animación y descartarlos?')) return
    setStorageOperation('load')
    setStorageMessage('Abriendo…')
    try {
      const record = await loadAnimation(id)
      setPlaybackOffsetMs(null)
      resetDocument(record.document)
      setProjectType(record.type)
      setAnimationName(record.name)
      setSavedAnimationId(record.id)
      setSavedFingerprint(JSON.stringify({ name: record.name, document: record.document }))
      setSelectedFrameId(record.document.frames[0].id)
      setSelectedLayerIds(new Set())
      setExpandedFrames(new Set([record.document.frames[0].id]))
      setStorageMessage('Animación abierta.')
    } catch (error) {
      setStorageMessage(error instanceof Error ? error.message : 'No se pudo abrir la animación.')
    } finally {
      setStorageOperation(null)
    }
  }

  useEffect(() => {
    if (!requestedAnimationId) return
    let cancelled = false
    loadAnimation(requestedAnimationId).then((record) => {
      if (cancelled) return
      resetDocument(record.document)
      setProjectType(record.type)
      setAnimationName(record.name)
      setSavedAnimationId(record.id)
      setSavedFingerprint(JSON.stringify({ name: record.name, document: record.document }))
      setSelectedFrameId(record.document.frames[0].id)
      setSelectedLayerIds(new Set())
      setExpandedFrames(new Set([record.document.frames[0].id]))
      setStorageMessage('Animación abierta.')
    }).catch((error: unknown) => {
      if (!cancelled) setStorageMessage(error instanceof Error ? error.message : 'No se pudo abrir la animación.')
    }).finally(() => { if (!cancelled) setInitialLoadPending(false) })
    return () => { cancelled = true }
  }, [requestedAnimationId, resetDocument])

  const activeFrameId = frame.id
  const selectedLayers = frame.layers.filter((layer) => selectedLayerIds.has(layer.id))
  const selectedLayer = selectedLayers.length === 1 ? selectedLayers[0] : undefined

  const selectLayer = (frameId: string, layerId: string, additive: boolean) => {
    setPivotPlacement(null)
    setPlaybackOffsetMs(null)
    setSelectedFrameId(frameId)
    setSelectedLayerIds((previous) => {
      if (!additive || frameId !== activeFrameId) return new Set([layerId])
      const next = new Set(previous)
      if (next.has(layerId)) next.delete(layerId)
      else next.add(layerId)
      return next
    })
  }

  useEffect(() => () => {
    uploadedUrls.current.forEach((url) => URL.revokeObjectURL(url))
  }, [])

  useEffect(() => {
    if (!projectType || selectedLayerIds.size === 0 || isSaveDialogOpen) return

    const handleArrowKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || event.isComposing) return
      const target = event.target
      if (target instanceof HTMLElement && (target.closest('input, textarea, select') || target.isContentEditable)) return

      const offsets: Record<string, { x: number; y: number }> = {
        ArrowLeft: { x: -2, y: 0 },
        ArrowRight: { x: 2, y: 0 },
        ArrowUp: { x: 0, y: -2 },
        ArrowDown: { x: 0, y: 2 },
      }
      const offset = offsets[event.key]
      if (!offset) return
      event.preventDefault()
      setFrames((previous) => previous.map((item) => item.id === activeFrameId ? {
        ...item,
        layers: item.layers.map((layer) => selectedLayerIds.has(layer.id) ? {
          ...layer, x: layer.x + offset.x, y: layer.y + offset.y,
        } : layer),
      } : item))
    }

    window.addEventListener('keydown', handleArrowKey)
    return () => window.removeEventListener('keydown', handleArrowKey)
  }, [projectType, activeFrameId, selectedLayerIds, setFrames, isSaveDialogOpen])

  useEffect(() => {
    if (!projectType || isSaveDialogOpen) return
    const handleHistoryKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing || event.altKey || !(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== 'z') return
      // Commit/leave numeric inputs so their local draft reflects the restored state.
      if (event.target instanceof HTMLElement) event.target.blur()
      event.preventDefault()
      if (event.shiftKey) redo()
      else undo()
    }
    window.addEventListener('keydown', handleHistoryKey)
    return () => window.removeEventListener('keydown', handleHistoryKey)
  }, [projectType, undo, redo, isSaveDialogOpen])

  useEffect(() => {
    if (!projectType || !selectedFrameId || selectedLayerIds.size > 0 || isPlaying || isSaveDialogOpen) return
    const navigateFrames = (event: KeyboardEvent) => {
      if (!['ArrowUp', 'ArrowDown'].includes(event.key)) return
      if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || event.isComposing) return
      const target = event.target
      if (target instanceof HTMLElement && (target.closest('input, textarea, select, dialog') || target.isContentEditable)) return
      const index = frames.findIndex((item) => item.id === selectedFrameId)
      if (index < 0) return
      event.preventDefault()
      const nextIndex = (index + (event.key === 'ArrowDown' ? 1 : -1) + frames.length) % frames.length
      setSelectedFrameId(frames[nextIndex].id)
    }
    window.addEventListener('keydown', navigateFrames)
    return () => window.removeEventListener('keydown', navigateFrames)
  }, [projectType, selectedFrameId, selectedLayerIds, isPlaying, isSaveDialogOpen, frames])

  const updateLayers = (frameId: string, update: (layers: EditorImageLayer[]) => EditorImageLayer[]) => {
    setPlaybackOffsetMs(null)
    setSelectedFrameId(frameId)
    setFrames((previous) => previous.map((item) => item.id === frameId ? { ...item, layers: update(item.layers) } : item))
  }

  const pickingPivot = Boolean(selectedLayer && !isPlaying && !isSaveDialogOpen && pivotPlacement === `${frame.id}:${selectedLayer.id}`)

  useEffect(() => {
    if (!pickingPivot) return
    const cancelPivot = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      event.stopPropagation()
      setPivotPlacement(null)
    }
    window.addEventListener('keydown', cancelPivot, true)
    return () => window.removeEventListener('keydown', cancelPivot, true)
  }, [pickingPivot])

  const assignPivot = (event: MouseEvent<HTMLDivElement>) => {
    if (!pickingPivot || !selectedLayer || !previewRef.current) return
    event.preventDefault()
    event.stopPropagation()
    const image = previewRef.current.querySelector<HTMLElement>(`[data-layer-id="${CSS.escape(selectedLayer.id)}"]`)
    if (!image) return
    const bounds = previewRef.current.getBoundingClientRect()
    const matrix = new DOMMatrixReadOnly(window.getComputedStyle(image).transform)
    const placement = placeImagePivot(selectedLayer, { x: (event.clientX - bounds.left) / viewportZoom, y: (event.clientY - bounds.top) / viewportZoom }, {
      a: matrix.m11, b: matrix.m12, c: matrix.m21, d: matrix.m22,
    })
    if (!placement) {
      setStorageMessage('La imagen está de canto. Ajusta la rotación para poder colocar el pivote.')
      return
    }
    updateLayers(frame.id, (layers) => layers.map((layer) => layer.id === selectedLayer.id ? { ...layer, ...placement } : layer))
    setPivotPlacement(null)
  }

  const moveLayer = (frameId: string, layerId: string, targetId: string, after: boolean) => {
    if (layerId === targetId) return
    updateLayers(frameId, (layers) => {
      const layer = layers.find((entry) => entry.id === layerId)
      if (!layer) return layers
      const reordered = layers.filter((entry) => entry.id !== layerId)
      const targetIndex = reordered.findIndex((entry) => entry.id === targetId)
      if (targetIndex < 0) return layers
      reordered.splice(targetIndex + (after ? 1 : 0), 0, layer)
      return reordered
    })
  }

  const moveFrame = (sourceId: string, targetId: string, after: boolean) => {
    if (sourceId === targetId) return
    setPlaybackOffsetMs(null)
    setPivotPlacement(null)
    setFrames((previous) => {
      const source = previous.find((item) => item.id === sourceId)
      if (!source) return previous
      const reordered = previous.filter((item) => item.id !== sourceId)
      const targetIndex = reordered.findIndex((item) => item.id === targetId)
      if (targetIndex < 0) return previous
      reordered.splice(targetIndex + (after ? 1 : 0), 0, source)
      return reordered
    })
  }

  const deleteFrame = (id: string) => {
    if (frames.length <= 1) return
    const index = frames.findIndex((item) => item.id === id)
    if (index < 0) return
    const remaining = frames.filter((item) => item.id !== id)
    const nextFrame = frame.id === id ? remaining[Math.min(index, remaining.length - 1)] : frame
    setPlaybackOffsetMs(null)
    setPivotPlacement(null)
    setSelectedFrameId(nextFrame.id)
    if (frame.id === id) setSelectedLayerIds(new Set())
    setDraggedFrameId(null)
    setFrameDropTarget(null)
    setFrames((previous) => previous.length > 1 ? previous.filter((item) => item.id !== id) : previous)
  }

  const addFrame = () => {
    setPlaybackOffsetMs(null)
    setPivotPlacement(null)
    const id = crypto.randomUUID()
    const sourceFrame = frames.find((item) => item.id === selectedFrameId) ?? frames[frames.length - 1]
    const newFrame: EditorFrame = {
      id,
      durationMs: sourceFrame.durationMs,
      layers: sourceFrame.layers.map((layer) => ({ ...layer, id: crypto.randomUUID() })),
    }
    setFrames((previous) => {
      const source = previous.find((item) => item.id === sourceFrame.id) ?? previous[previous.length - 1]
      const sourceIndex = previous.indexOf(source)
      return [...previous.slice(0, sourceIndex + 1), newFrame, ...previous.slice(sourceIndex + 1)]
    })
    setSelectedFrameId(id)
    setExpandedFrames((previous) => new Set([...previous, id]))
    setSelectedLayerIds(new Set())
  }

  const loadImages = (frameId: string, files: FileList | null) => {
    const layers = Array.from(files ?? []).filter((file) => file.type.startsWith('image/')).map((file) => {
      const url = URL.createObjectURL(file)
      uploadedUrls.current.push(url)
      return { id: crypto.randomUUID(), name: file.name, url, visible: true, x: 0, y: 0, rotation: 0, rotationX: 0, rotationY: 0, pivotX: 0, pivotY: 0 }
    })
    if (!layers.length) return
    updateLayers(frameId, (previous) => [...layers, ...previous])
    setSelectedFrameId(frameId)
    setSelectedLayerIds(new Set(layers.map((layer) => layer.id)))
  }

  const addReferenceImage = (image: SkinReferenceImage) => {
    const layer: EditorImageLayer = {
      id: crypto.randomUUID(), name: image.name, url: image.url,
      visible: true, x: 0, y: 0, rotation: 0, rotationX: 0, rotationY: 0, pivotX: 0, pivotY: 0,
    }
    setPivotPlacement(null)
    setScrubPreview(null)
    updateLayers(frame.id, (layers) => [layer, ...layers])
    setSelectedLayerIds(new Set([layer.id]))
    setExpandedFrames((previous) => new Set([...previous, frame.id]))
  }

  const canReplaceSelectedImage = Boolean(projectType && selectedLayer && selectedFrameId === frame.id && !isPlaying)

  const replaceSelectedImage = (image: SkinReferenceImage) => {
    if (!canReplaceSelectedImage || !selectedLayer) return
    setPivotPlacement(null)
    setScrubPreview(null)
    updateLayers(frame.id, (layers) => layers.map((layer) => (
      layer.id === selectedLayer.id ? { ...layer, name: image.name, url: image.url } : layer
    )))
    setStorageMessage(`Imagen reemplazada en Frame ${frameIndex}.`)
  }

  const [editingSizeAxis, setEditingSizeAxis] = useState<'width' | 'height' | null>(null)
  const [sizeInputs, setSizeInputs] = useState({ width: '1', height: '1' })
  const [durationInput, setDurationInput] = useState('85')
  const [editingDuration, setEditingDuration] = useState(false)

  const commitDuration = () => {
    const durationMs = Number(durationInput)
    setEditingDuration(false)
    if (!durationInput.trim() || !Number.isSafeInteger(durationMs) || durationMs < 1) return
    if (frames.every((item) => item.durationMs === durationMs)) return
    if (isPlaying) setPlaybackOffsetMs(getAnimationElapsedMs() - frameIndex * durationMs)
    setFrames((previous) => previous.map((item) => ({ ...item, durationMs })))
  }

  const updateSize = (axis: 'width' | 'height', value: string) => {
    setSizeInputs((previous) => ({ ...previous, [axis]: value }))
    const units = Number(value)
    if (value.trim() && Number.isSafeInteger(units * PIXELS_PER_UNIT) && Number.isInteger(units) && units > 0) {
      setDocument((previous) => ({ ...previous, sceneSize: { ...previous.sceneSize, [axis]: units } }))
    }
  }

  const pixelWidth = sceneSize.width * PIXELS_PER_UNIT
  const pixelHeight = sceneSize.height * PIXELS_PER_UNIT

  useLayoutEffect(() => {
    const viewport = viewportRef.current
    const scene = sceneScaleRef.current
    if (!viewport || !scene) return
    const updateGuides = () => {
      const viewportBounds = viewport.getBoundingClientRect()
      const sceneBounds = scene.getBoundingClientRect()
      const top = Math.min(sceneBounds.height + 8, Math.max(0, viewportBounds.top - sceneBounds.top + 36))
      const left = Math.min(sceneBounds.width + 8, Math.max(0, viewportBounds.left - sceneBounds.left + 44))
      if (columnGuidesRef.current) {
        columnGuidesRef.current.style.transform = `translateY(${top}px)`
        columnGuidesRef.current.classList.toggle('is-anchored', top > 0)
      }
      if (rowGuidesRef.current) {
        rowGuidesRef.current.style.transform = `translateX(${left}px)`
        rowGuidesRef.current.classList.toggle('is-anchored', left > 0)
      }
    }
    const observer = new ResizeObserver(updateGuides)
    observer.observe(viewport)
    observer.observe(scene)
    viewport.addEventListener('scroll', updateGuides)
    updateGuides()
    return () => { observer.disconnect(); viewport.removeEventListener('scroll', updateGuides) }
  }, [pixelWidth, pixelHeight, viewportZoom])

  return (
    <main className="edit-room-page animation-editor-page" aria-label="Editor de animaciones">
      {!projectType && !initialLoadPending && <AnimationTypeDialog onSelectSkin={() => setProjectType('skin')} />}
      {isSaveDialogOpen && (
        <AnimationSaveDialog
          initialName={isSaveAs ? `${animationName.slice(0, 75)} copy` : animationName}
          saveAs={isSaveAs}
          saving={storageOperation === 'save'}
          error={saveDialogError}
          onSave={(name) => { void handleSave(name, isSaveAs) }}
          onClose={() => setIsSaveDialogOpen(false)}
        />
      )}
      <header className="edit-room-toolbar">
        <section className="edit-room-map-size" aria-label="Tamaño del área de trabajo en unidades de 128 píxeles">
          {(['width', 'height'] as const).map((axis) => (
            <label key={axis}>
              <span>{axis === 'width' ? 'Ancho' : 'Alto'}</span>
              <input
                type="number"
                min="1"
                step="1"
                value={editingSizeAxis === axis ? sizeInputs[axis] : String(sceneSize[axis])}
                onFocus={() => {
                  setEditingSizeAxis(axis)
                  setSizeInputs((previous) => ({ ...previous, [axis]: String(sceneSize[axis]) }))
                }}
                onChange={(event) => updateSize(axis, event.target.value)}
                onBlur={() => setEditingSizeAxis(null)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') event.currentTarget.blur()
                }}
              />
            </label>
          ))}
        </section>
        <section className="edit-room-map-size" aria-label="Tiempo de los frames">
          <label>
            <span>ms</span>
            <input
              type="number"
              min="1"
              step="1"
              aria-label="Duración de cada frame en milisegundos"
              title="Se aplica a todos los frames de la animación"
              value={editingDuration ? durationInput : String(frame.durationMs)}
              onFocus={() => { setEditingDuration(true); setDurationInput(String(frame.durationMs)) }}
              onChange={(event) => setDurationInput(event.target.value)}
              onBlur={commitDuration}
              onKeyDown={(event) => { if (event.key === 'Enter') event.currentTarget.blur() }}
            />
          </label>
        </section>
        <div className="edit-room-save-controls animation-editor-save-controls">
          <strong className="edit-room-scene-name" title={animationName} aria-label={`Animación actual: ${animationName}`}>
            {animationName}
          </strong>
          <button type="button" disabled={!projectType || Boolean(storageOperation)} onClick={() => {
            setSelectedFrameId(frame.id)
            setPlaybackOffsetMs(null)
            setSaveDialogError('')
            setIsSaveAs(false)
            if (savedAnimationId) void handleSave(animationName)
            else setIsSaveDialogOpen(true)
          }}>
            {storageOperation === 'save' ? 'Guardando…' : 'Guardar'}
          </button>
          <button type="button" disabled={!projectType || Boolean(storageOperation)} onClick={() => {
            setSelectedFrameId(frame.id)
            setPlaybackOffsetMs(null)
            setSaveDialogError('')
            setIsSaveAs(true)
            setIsSaveDialogOpen(true)
          }}>
            Guardar como
          </button>
        </div>
        <div className="edit-room-toolbar-spacer" />
        {projectType && (
          <div className="animation-editor-history-controls">
            <button type="button" className="edit-room-exit-button" disabled={!canUndo} onClick={undo} title="Deshacer (Ctrl/Cmd + Z)">Deshacer</button>
            <button type="button" className="edit-room-exit-button" disabled={!canRedo} onClick={redo} title="Rehacer (Ctrl/Cmd + Shift + Z)">Rehacer</button>
          </div>
        )}
        <button type="button" className="edit-room-exit-button" onClick={() => navigateInApp('/editor')}>
          Volver
        </button>
      </header>
      <section className="edit-room-layout animation-editor-layout" aria-label="Espacio de animación">
        <aside className="animation-editor-sidebar is-left edit-room-panel edit-room-layers-section animation-editor-hierarchy" aria-label="Frames y jerarquía">
          <header><span>Frames</span><output>{projectType ? frames.length : 0}</output></header>
          {projectType === 'skin' ? (
            <div className="edit-room-panel-body edit-room-layers-body">
              <div className="animation-editor-frame-actions">
                <select className="animation-editor-saved-select" aria-label="Abrir animación guardada en este navegador" value="" disabled={Boolean(storageOperation) || savedAnimations.length === 0} onChange={(event) => { void handleOpen(event.target.value) }}>
            <option value="">Abrir guardada…</option>
            {savedAnimations.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
          </select>
              <form className="edit-room-layer-creator" onSubmit={(event) => { event.preventDefault(); addFrame() }}>
                <input type="text" aria-label="Nuevo frame" value={`Frame ${frames.length}`} readOnly />
                <button type="submit" aria-label="Crear frame" title="Crear frame">+</button>
              </form>
              </div>
              <div className="edit-room-layer-list" role="list" aria-label="Frames e imágenes" onClick={(event) => {
                if (event.target !== event.currentTarget) return
                setPlaybackOffsetMs(null)
                setPivotPlacement(null)
                setSelectedFrameId(null)
                setSelectedLayerIds(new Set())
              }}>
                {frames.map((item, index) => {
                  const expanded = expandedFrames.has(item.id)
                  const childrenId = `animation-frame-children-${item.id}`
                  return (
                    <div key={item.id} className="edit-room-layer-node" role="listitem">
                      <div
                        className={`edit-room-layer-row animation-editor-frame-row${(isPlaying ? frame.id : selectedFrameId) === item.id ? ' is-active' : ''}${draggedFrameId === item.id ? ' is-dragging' : ''}${frameDropTarget?.id === item.id ? (frameDropTarget.after ? ' is-drop-after' : ' is-drop-before') : ''}`}
                        draggable
                        onDragStart={(event) => {
                          event.stopPropagation()
                          event.dataTransfer.effectAllowed = 'move'
                          event.dataTransfer.setData('application/x-animation-frame', item.id)
                          setPlaybackOffsetMs(null)
                          setPivotPlacement(null)
                          setSelectedFrameId(item.id)
                          setSelectedLayerIds(new Set())
                          setDraggedLayer(null)
                          setDropTarget(null)
                          setDraggedFrameId(item.id)
                        }}
                        onDragOver={(event) => {
                          if (!draggedFrameId || draggedFrameId === item.id) return
                          event.preventDefault()
                          event.stopPropagation()
                          event.dataTransfer.dropEffect = 'move'
                          const bounds = event.currentTarget.getBoundingClientRect()
                          setFrameDropTarget({ id: item.id, after: event.clientY > bounds.top + bounds.height / 2 })
                        }}
                        onDragLeave={(event) => {
                          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setFrameDropTarget(null)
                        }}
                        onDrop={(event) => {
                          if (!draggedFrameId) return
                          event.preventDefault()
                          event.stopPropagation()
                          const bounds = event.currentTarget.getBoundingClientRect()
                          moveFrame(draggedFrameId, item.id, event.clientY > bounds.top + bounds.height / 2)
                          setDraggedFrameId(null)
                          setFrameDropTarget(null)
                        }}
                        onDragEnd={() => { setDraggedFrameId(null); setFrameDropTarget(null) }}
                      >
                        <button
                          type="button"
                          className="edit-room-layer-disclosure"
                          aria-label={`${expanded ? 'Contraer' : 'Expandir'} Frame ${index}`}
                          aria-expanded={expanded}
                          aria-controls={childrenId}
                          onClick={() => setExpandedFrames((previous) => {
                            const next = new Set(previous)
                            if (next.has(item.id)) next.delete(item.id)
                            else next.add(item.id)
                            return next
                          })}
                        >{expanded ? '▾' : '▸'}</button>
                        <button type="button" className="edit-room-layer-select" aria-pressed={(isPlaying ? frame.id : selectedFrameId) === item.id} title={`Frame ${index} · ${item.durationMs} ms · Arrastrar para ordenar (Alt + ↑/↓)`} onKeyDown={(event) => {
                          if (!event.altKey || !['ArrowUp', 'ArrowDown'].includes(event.key)) return
                          event.preventDefault()
                          const down = event.key === 'ArrowDown'
                          const target = frames[index + (down ? 1 : -1)]
                          if (target) moveFrame(item.id, target.id, down)
                        }} onClick={() => { setPlaybackOffsetMs(null); setSelectedFrameId(item.id); setSelectedLayerIds(new Set()) }}>
                          <span className="edit-room-layer-icon-slot" aria-hidden="true" />
                          <span className="edit-room-layer-name">Frame {index}</span>
                        </button>
                        <span className="edit-room-layer-mode" title={`${item.layers.length} imágenes`}>{item.layers.length}</span>
                        <button
                          type="button"
                          className="edit-room-layer-delete"
                          aria-label={`Borrar Frame ${index}`}
                          title={frames.length > 1 ? `Borrar Frame ${index}` : 'La animación debe conservar al menos un frame'}
                          disabled={frames.length <= 1}
                          onClick={(event) => { event.stopPropagation(); deleteFrame(item.id) }}
                        >×</button>
                      </div>
                      {expanded && (
                        <div id={childrenId} className="edit-room-layer-children animation-editor-frame-images">
                          <label className="edit-room-layer-child animation-editor-upload">
                            <span className="edit-room-layer-child-icon" aria-hidden="true">+</span>
                            <span className="edit-room-layer-child-name">Cargar imágenes</span>
                            <input type="file" accept="image/*" multiple onChange={(event) => {
                              loadImages(item.id, event.target.files)
                              event.target.value = ''
                            }} />
                          </label>
                          {item.layers.length === 0 && <p className="edit-room-layer-empty">Sin imágenes</p>}
                          {item.layers.map((layer, layerIndex) => (
                            <div
                              key={layer.id}
                              className={`animation-editor-image-row${draggedLayer?.layerId === layer.id ? ' is-dragging' : ''}${dropTarget?.layerId === layer.id ? (dropTarget.after ? ' is-drop-after' : ' is-drop-before') : ''}`}
                              draggable
                              onDragStart={(event) => {
                                event.dataTransfer.effectAllowed = 'move'
                                event.dataTransfer.setData('text/plain', layer.id)
                                setPlaybackOffsetMs(null)
                                setDraggedLayer({ frameId: item.id, layerId: layer.id })
                                setSelectedFrameId(item.id)
                                setSelectedLayerIds(new Set([layer.id]))
                              }}
                              onDragOver={(event) => {
                                if (draggedLayer?.frameId !== item.id || draggedLayer.layerId === layer.id) return
                                event.preventDefault()
                                event.dataTransfer.dropEffect = 'move'
                                const bounds = event.currentTarget.getBoundingClientRect()
                                setDropTarget({ layerId: layer.id, after: event.clientY > bounds.top + bounds.height / 2 })
                              }}
                              onDragLeave={(event) => {
                                if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDropTarget(null)
                              }}
                              onDrop={(event) => {
                                event.preventDefault()
                                if (draggedLayer?.frameId === item.id) {
                                  const bounds = event.currentTarget.getBoundingClientRect()
                                  moveLayer(item.id, draggedLayer.layerId, layer.id, event.clientY > bounds.top + bounds.height / 2)
                                }
                                setDraggedLayer(null)
                                setDropTarget(null)
                              }}
                              onDragEnd={() => { setDraggedLayer(null); setDropTarget(null) }}
                            >
                              <button type="button" className={`edit-room-layer-child${frame.id === item.id && selectedLayerIds.has(layer.id) ? ' is-selected' : ''}`} title={`${layer.name} · Cmd/Ctrl + clic: selección múltiple · Arrastrar: ordenar`} onKeyDown={(event) => {
                                if (!event.altKey || !['ArrowUp', 'ArrowDown'].includes(event.key)) return
                                event.preventDefault()
                                const down = event.key === 'ArrowDown'
                                const target = item.layers[layerIndex + (down ? 1 : -1)]
                                if (target) moveLayer(item.id, layer.id, target.id, down)
                              }} aria-pressed={frame.id === item.id && selectedLayerIds.has(layer.id)} onClick={(event) => selectLayer(item.id, layer.id, event.metaKey || event.ctrlKey)}>
                                <span className="edit-room-layer-child-icon" aria-hidden="true">◆</span>
                                <span className="edit-room-layer-child-name">{layer.name}</span>
                              </button>
                              <button type="button" className={`edit-room-layer-enabled-toggle${layer.visible ? ' is-enabled' : ''}`} aria-label={`Visibilidad de ${layer.name}`} aria-pressed={layer.visible} onClick={() => updateLayers(item.id, (layers) => layers.map((entry) => entry.id === layer.id ? { ...entry, visible: !entry.visible } : entry))}>{layer.visible ? '◉' : '○'}</button>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>
          ) : <p className="edit-room-layer-empty">Selecciona qué vas a animar para comenzar.</p>}
        </aside>
        <section className="edit-room-workspace" aria-label="Escena central">
          {draggedReferenceId && canReplaceSelectedImage && (
            <div className="animation-editor-reference-drop-hint">Suelta para reemplazar la imagen de la capa seleccionada</div>
          )}
          <div
            ref={viewportRef}
            className={`edit-room-canvas-viewport animation-editor-viewport${pickingPivot ? ' is-placing-pivot' : ''}${draggedReferenceId && canReplaceSelectedImage ? ' is-replacing-image' : ''}`}
            role="region"
            aria-label="Viewport de animación"
            onClickCapture={assignPivot}
            onDragOver={(event) => {
              if (!canReplaceSelectedImage || !draggedReferenceId || !event.dataTransfer.types.includes(SKIN_REFERENCE_DRAG_TYPE)) return
              event.preventDefault()
              event.dataTransfer.dropEffect = 'copy'
            }}
            onDrop={(event) => {
              const image = skinReferenceImages.find((item) => item.id === event.dataTransfer.getData(SKIN_REFERENCE_DRAG_TYPE))
              if (!image || !canReplaceSelectedImage) return
              event.preventDefault()
              event.stopPropagation()
              replaceSelectedImage(image)
              setDraggedReferenceId(null)
            }}
          >
            <div className="animation-editor-stage">
              <div ref={sceneScaleRef} className="animation-editor-scene-scale" style={{ width: pixelWidth * viewportZoom, height: pixelHeight * viewportZoom }}>
                <EditorGridGuides columns={sceneSize.width} rows={sceneSize.height} zoom={viewportZoom} columnRef={columnGuidesRef} rowRef={rowGuidesRef} />
                <span className="animation-editor-scene-size">{sceneSize.width} × {sceneSize.height} u · {pixelWidth} × {pixelHeight} px</span>
              <div
                className="animation-editor-scene"
                role="region"
                aria-label={`Escena de ${sceneSize.width} por ${sceneSize.height} unidades, ${pixelWidth} por ${pixelHeight} píxeles`}
                style={{ width: pixelWidth, height: pixelHeight, transform: `scale(${viewportZoom})`, transformOrigin: 'top left' }}
              >
                {projectType === 'skin' && (
                  <div ref={previewRef} className="animation-editor-skin-preview" role="img" aria-label={`Vista previa del frame ${frameIndex}`}>
                    {frame.layers.map((layer, index) => layer.visible && (
                      <div key={layer.id} data-layer-id={layer.id} className="animation-editor-preview-layer" style={{
                        zIndex: frame.layers.length - index,
                        transformOrigin: `calc(50% + ${layer.pivotX}px) calc(50% + ${layer.pivotY}px)`,
                        transform: `translate(${layer.x}px, ${layer.y}px) rotate(${layer.rotationX}deg) rotateY(${layer.rotationY}deg) rotate(${layer.rotation}deg)`,
                      }}>
                        <img src={layer.url} alt="" draggable={false} />
                        {selectedLayerIds.has(layer.id) && (
                          <div
                            className="animation-editor-selection-tint"
                            aria-hidden="true"
                            style={{
                              maskImage: `url(${JSON.stringify(layer.url)})`,
                              WebkitMaskImage: `url(${JSON.stringify(layer.url)})`,
                            }}
                          />
                        )}
                      </div>
                    ))}
                    {selectedLayers.map((layer) => (
                      <span
                        key={`pivot-${layer.id}`}
                        className="animation-editor-pivot"
                        aria-hidden="true"
                        style={{
                          left: PIXELS_PER_UNIT / 2 + layer.x + layer.pivotX,
                          top: PIXELS_PER_UNIT / 2 + layer.y + layer.pivotY,
                          zIndex: frame.layers.length + 1,
                          transform: `scale(${1 / viewportZoom})`,
                          transformOrigin: '0 0',
                        }}
                      />
                    ))}
                  </div>
                )}
                <div className="animation-editor-grid-overlay" aria-hidden="true" style={{
                  backgroundImage: `linear-gradient(to right, #00000020 ${Math.min(0.25, 1 / viewportZoom)}px, transparent ${Math.min(0.25, 1 / viewportZoom)}px), linear-gradient(to bottom, #00000020 ${Math.min(0.25, 1 / viewportZoom)}px, transparent ${Math.min(0.25, 1 / viewportZoom)}px)`,
                }} />
              </div>
              </div>
            </div>
          </div>
        </section>
        {projectType && (
          <section className="edit-room-panel edit-room-tools-section animation-editor-tools" aria-label="Herramientas de animación">
            <div className="edit-room-panel-body edit-room-tools-body animation-editor-tools-body" role="toolbar" aria-label="Herramientas de animación">
              <div className="edit-room-primary-tool-controls">
                <button
                  type="button"
                  className={isPlaying ? 'is-active' : ''}
                  aria-label={isPlaying ? 'Pausar animación' : 'Reproducir animación'}
                  aria-pressed={isPlaying}
                  data-tool-tooltip={isPlaying ? 'Pausar (Espacio)' : 'Reproducir (Espacio)'}
                  aria-keyshortcuts="Space"
                  onClick={togglePlayback}
                >
                  {isPlaying ? (
                    <svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true"><path d="M5 3h4v14H5zM12 3h4v14h-4z" /></svg>
                  ) : (
                    <svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true"><path d="M5 2v16l13-8z" /></svg>
                  )}
                </button>
              </div>
              <section className="edit-room-tool-group" aria-label="Zoom del viewport">
                <div className="edit-room-zoom-controls">
                  <button type="button" aria-label="Alejar" data-tool-tooltip="Alejar" disabled={viewportZoom <= MIN_ZOOM} onClick={() => setViewportZoom((previous) => Math.max(MIN_ZOOM, previous - ZOOM_STEP))}>
                    <img className="edit-room-zoom-icon" src={zoomOutIconSrc} alt="" draggable={false} />
                  </button>
                  <button type="button" aria-label="Acercar" data-tool-tooltip="Acercar" disabled={viewportZoom >= MAX_ZOOM} onClick={() => setViewportZoom((previous) => Math.min(MAX_ZOOM, previous + ZOOM_STEP))}>
                    <img className="edit-room-zoom-icon" src={zoomInIconSrc} alt="" draggable={false} />
                  </button>
                </div>
              </section>
              <div className="animation-editor-playback-status animation-editor-zoom-status">
                <NumericAxisScrubber
                  axis={`${Math.round(viewportZoom * 100)}%`}
                  label="Zoom (%)"
                  value={viewportZoom * 100}
                  min={MIN_ZOOM * 100}
                  max={MAX_ZOOM * 100}
                  onStart={() => { zoomDragStart.current = viewportZoom }}
                  onPreview={(percent) => setViewportZoom(Math.round(percent) / 100)}
                  onCommit={(percent) => setViewportZoom(Math.round(percent) / 100)}
                  onCancel={() => setViewportZoom(zoomDragStart.current)}
                />
                <output>Frame {frameIndex}</output>
              </div>
            </div>
          </section>
        )}
        <aside className="edit-room-inspector-sidebar animation-editor-inspector" aria-label="Detalles y capas de skin">
          <section className="edit-room-panel edit-room-details-panel animation-editor-details" aria-label="Detalles de la capa seleccionada">
          <header><span>Detalles</span>{projectType && selectedLayer && <output>Frame {frameIndex}</output>}</header>
          <div className="edit-room-panel-body edit-room-details-body">
            {projectType && selectedLayer ? (
              <LayerDetails
                key={`${frame.id}-${selectedLayer.id}`}
                layer={selectedLayer}
                frameIndex={frameIndex}
                onScrubPreview={(property, value) => setScrubPreview({ frameId: frame.id, layerId: selectedLayer.id, property, value: normalizeDetailValue(property, value) })}
                onScrubCancel={() => setScrubPreview(null)}
                pickingPivot={pickingPivot}
                onPickPivot={() => setPivotPlacement(pickingPivot ? null : `${frame.id}:${selectedLayer.id}`)}
                onResetPosition={() => updateLayers(frame.id, (layers) => layers.map((layer) => (
                  layer.id === selectedLayer.id ? { ...layer, x: 0, y: 0 } : layer
                )))}
                onChange={(property, value) => updateLayers(frame.id, (layers) => layers.map((layer) => (
                  layer.id === selectedLayer.id ? { ...layer, [property]: normalizeDetailValue(property, value) } : layer
                )))}
              />
            ) : projectType && selectedLayers.length > 1 ? (
              <div className="edit-room-details-content">
                <dl className="edit-room-details-fields">
                  <div className="edit-room-details-field is-name">
                    <dt>Selección · Frame {frameIndex}</dt>
                    <dd>{selectedLayers.length} capas</dd>
                  </div>
                </dl>
                <p className="edit-room-layer-empty">Usa las flechas para mover las capas juntas. Cmd/Ctrl + clic añade o quita capas.</p>
                <button type="button" className="edit-room-exit-button" onClick={() => updateLayers(frame.id, (layers) => layers.map((layer) => (
                  selectedLayerIds.has(layer.id) ? { ...layer, x: 0, y: 0 } : layer
                )))}>Reiniciar posiciones</button>
              </div>
            ) : <p className="edit-room-layer-empty">Selecciona una imagen dentro de un frame para editar sus propiedades.</p>}
          </div>
          </section>
          <section className="edit-room-panel edit-room-assets-panel" aria-label="Imágenes de referencia de skins">
            <header><span>Skins</span><output>{skinReferenceImages.length}</output></header>
            <div className="edit-room-panel-body edit-room-assets-body">
              {skinReferenceGroups.length === 0 && <p className="edit-room-assets-empty">No hay imágenes con prefijo sk_.</p>}
              {skinReferenceGroups.map((group) => (
                <details key={group.name} className="edit-room-asset-collection" open>
                  <summary><span>{group.name}</span><output>{group.images.length}</output></summary>
                  <div className="edit-room-asset-grid">
                    {group.images.map((image) => (
                      <button
                        key={image.id}
                        type="button"
                        className={`edit-room-asset-tile${selectedLayer?.url === image.url ? ' is-selected' : ''}`}
                        title={`${image.name} · Clic: añadir · Arrastrar al viewport: reemplazar imagen seleccionada`}
                        aria-label={`Añadir ${image.name} al frame ${frameIndex}`}
                        disabled={!projectType}
                        draggable={Boolean(projectType)}
                        onDragStart={(event) => {
                          event.dataTransfer.effectAllowed = 'copy'
                          event.dataTransfer.setData(SKIN_REFERENCE_DRAG_TYPE, image.id)
                          setDraggedReferenceId(image.id)
                          setPivotPlacement(null)
                        }}
                        onDragEnd={() => setDraggedReferenceId(null)}
                        onClick={() => addReferenceImage(image)}
                      >
                        <span className="edit-room-asset-preview" aria-hidden="true">
                          <img src={image.url} alt="" draggable={false} style={{ width: 128, height: 128, transform: 'scale(0.5)' }} />
                        </span>
                        <span className="edit-room-asset-name">{image.label}</span>
                      </button>
                    ))}
                  </div>
                </details>
              ))}
            </div>
          </section>
        </aside>
      </section>
      <footer className="edit-room-statusbar"><span role="status">{storageMessage}{hasUnsavedChanges ? ' · Cambios sin guardar' : ''}</span><span>{projectType ? `Skin · Frame ${frameIndex}${selectedLayer ? ` · ${selectedLayer.name}` : selectedLayers.length > 1 ? ` · ${selectedLayers.length} capas seleccionadas` : ''}` : 'Seleccionar tipo de animación'}</span></footer>
    </main>
  )
}
