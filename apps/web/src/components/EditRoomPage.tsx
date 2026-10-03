import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { io, type Socket } from 'socket.io-client'
import {
  clientEvents,
  serverEvents,
  type ConnectionAcceptedPayload,
  type Position,
  type RoomObjectKind,
  type RoomObjectTemplate,
  type RoomEditorLayerData,
  type RoomEditorPlacementData,
  type RoomTemplate,
  type SavedRoomEditorMap,
  type UserProfile,
} from '@social-sena/shared'
import { saveAuthSession, type AuthSession } from '../auth/localSession'
import { navigateInApp } from '../hooks/usePathname'
import { canAccessRoomEditor } from '../rooms/roomEditorAccess'
import {
  formatAssetLabel,
  loadRoomEditorAssetCategories,
  type RoomEditorAsset,
  type RoomEditorAssetCategory,
} from './roomEditorAssetCatalog'
import EditRoomTestMode from './EditRoomTestMode'
import { ObjectDecoration } from './world/ObjectDecoration'

const SERVER_URL = import.meta.env.VITE_GAME_SERVER_URL ?? 'http://localhost:3001'
const MIN_ZOOM = 0.25
const MAX_ZOOM = 2
const ZOOM_STEP = 0.25
const MAX_EDIT_HISTORY = 100

function createGlobalRouteSlug(sceneName: string) {
  const words = sceneName
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .match(/[A-Za-z0-9]+/g) ?? []
  const slug = words.map((word) => `${word.charAt(0).toUpperCase()}${word.slice(1)}`).join('')
  const safeSlug = /^[A-Za-z]/.test(slug) ? slug : `Scene${slug}`
  return safeSlug.slice(0, 48)
}

type EditorLayer = RoomEditorLayerData

const REQUIRED_EDITOR_LAYERS: EditorLayer[] = [
  { id: 'floor', name: 'Floor', collidersEnabled: false, required: true },
  { id: 'walls', name: 'Walls', collidersEnabled: true, required: true },
  { id: 'object-decoration', name: 'ObjectDecoration', collidersEnabled: true, required: true },
  { id: 'teleports', name: 'Teleports', collidersEnabled: true, required: true },
]

const EDITOR_LAYER_PRIORITY: Record<string, number> = {
  floor: 0,
  walls: 1,
  'object-decoration': 2,
  teleports: 3,
}

function getEditorLayerPriority(layerId: string) {
  return EDITOR_LAYER_PRIORITY[layerId] ?? EDITOR_LAYER_PRIORITY['object-decoration']
}

type PlacedRoomAsset = RoomEditorPlacementData

interface MapCellPosition {
  x: number
  y: number
}

interface MapCellArea {
  startX: number
  startY: number
  endX: number
  endY: number
}

interface SelectedMapArea extends MapCellArea {
  layerId: string
}

function getNormalizedCellArea(start: MapCellPosition, end: MapCellPosition): MapCellArea {
  return {
    startX: Math.min(start.x, end.x),
    startY: Math.min(start.y, end.y),
    endX: Math.max(start.x, end.x),
    endY: Math.max(start.y, end.y),
  }
}

function isCellInsideArea(cellX: number, cellY: number, area: MapCellArea) {
  return cellX >= area.startX
    && cellX <= area.endX
    && cellY >= area.startY
    && cellY <= area.endY
}

function getObjectKindFromAssetType(assetType: string): RoomObjectKind {
  const normalizedType = assetType.toLocaleLowerCase()

  if (normalizedType.includes('wall')) return 'wall'
  if (normalizedType.includes('floor')) return 'floor'
  if (normalizedType.includes('door')) return 'door'
  if (normalizedType.includes('portal')) return 'portal'
  if (normalizedType.includes('zone')) return 'zone'
  return 'landmark'
}

function createPlacedObjectTemplate(
  placement: PlacedRoomAsset,
  asset: RoomEditorAsset,
  collidersEnabled = true,
): RoomObjectTemplate {
  const hasCollider = collidersEnabled && asset.colliderWidth > 0 && asset.colliderHeight > 0
  const collider = hasCollider ? {
    offsetX: asset.colliderOffsetX,
    offsetY: asset.colliderOffsetY,
    width: asset.colliderWidth,
    height: asset.colliderHeight,
  } : undefined
  const layerKind: Partial<Record<string, RoomObjectKind>> = {
    floor: 'floor',
    walls: 'wall',
    'object-decoration': 'landmark',
    teleports: 'portal',
  }

  return {
    id: `editor-object-${placement.layerId}-${placement.cellX}-${placement.cellY}`,
    kind: layerKind[placement.layerId] ?? getObjectKindFromAssetType(asset.category),
    x: placement.cellX * 128 + asset.frameWidth / 2,
    y: placement.cellY * 128 + asset.frameHeight / 2,
    width: asset.frameWidth,
    height: asset.frameHeight,
    opacity: 1,
    spriteAssetId: asset.id,
    flippedX: placement.flippedX,
    layerOrder: getEditorLayerPriority(placement.layerId),
    gridFootprint: {
      columns: asset.occupiedColumns,
      rows: asset.occupiedRows,
    },
    collider,
    zIndexRef: {
      offsetX: collider?.offsetX ?? 0,
      offsetY: asset.zIndexOffsetY,
      width: Math.max(48, collider ? collider.width * 0.45 : asset.frameWidth * 0.35),
      thickness: 2,
    },
  }
}

interface EditRoomPageProps {
  session: AuthSession
  onSessionChange: (session: AuthSession) => void
}

export default function EditRoomPage({ session, onSessionChange }: EditRoomPageProps) {
  const sessionRef = useRef(session)
  const socketRef = useRef<Socket | null>(null)
  const requestedMapCodeRef = useRef<string | null>(null)
  const profileResolvedRef = useRef(false)
  const [resolvedProfile, setResolvedProfile] = useState<UserProfile | null>(null)
  const [validationFailed, setValidationFailed] = useState(false)
  const [mapGridWidth, setMapGridWidth] = useState(10)
  const [mapGridHeight, setMapGridHeight] = useState(10)
  const [mapName, setMapName] = useState('Nueva Escena')
  const [publicationSceneName, setPublicationSceneName] = useState('')
  const [savedMapCode, setSavedMapCode] = useState<string | null>(null)
  const [savedMapOwnerUserId, setSavedMapOwnerUserId] = useState<string | null>(null)
  const [publishedRoutePath, setPublishedRoutePath] = useState<string | null>(null)
  const [publicationType, setPublicationType] = useState<'system' | 'room' | 'event' | 'official'>(
    session.profile.role === 'developer' ? 'system' : 'room',
  )
  const [classCode, setClassCode] = useState('')
  const [mapPersistenceMessage, setMapPersistenceMessage] = useState('Mapa sin guardar')
  const [isSavingMap, setIsSavingMap] = useState(false)
  const [isPublicationDialogOpen, setIsPublicationDialogOpen] = useState(false)
  const [mapZoom, setMapZoom] = useState(1)
  const [layers, setLayers] = useState<EditorLayer[]>(REQUIRED_EDITOR_LAYERS)
  const [activeLayerId, setActiveLayerId] = useState('floor')
  const [newLayerName, setNewLayerName] = useState('')
  const [assetCategories, setAssetCategories] = useState<RoomEditorAssetCategory[]>([])
  const [selectedAssetId, setSelectedAssetId] = useState<string | null>(null)
  const [placedAssets, setPlacedAssets] = useState<PlacedRoomAsset[]>([])
  const [isPaintToolActive, setIsPaintToolActive] = useState(false)
  const [isEraseToolActive, setIsEraseToolActive] = useState(false)
  const [isSelectToolActive, setIsSelectToolActive] = useState(true)
  const [isTestSpawnToolActive, setIsTestSpawnToolActive] = useState(false)
  const [testSpawn, setTestSpawn] = useState<Position | null>(null)
  const [hoveredMapCell, setHoveredMapCell] = useState<MapCellPosition | null>(null)
  const [selectedMapArea, setSelectedMapArea] = useState<SelectedMapArea | null>(null)
  const [draggedMapArea, setDraggedMapArea] = useState<MapCellArea | null>(null)
  const [isAssetFlippedX, setIsAssetFlippedX] = useState(false)
  const [isDebugEnabled, setIsDebugEnabled] = useState(false)
  const nextLayerIdRef = useRef(1)
  const placedAssetsRef = useRef<PlacedRoomAsset[]>([])
  const assetEditHistoryRef = useRef<PlacedRoomAsset[][]>([])
  const dragStartCellRef = useRef<MapCellPosition | null>(null)

  useEffect(() => {
    const socket = io(SERVER_URL, { autoConnect: true })
    socketRef.current = socket

    socket.on('connect', () => {
      setValidationFailed(false)
      socket.emit(clientEvents.connectToGame, { profile: sessionRef.current.profile })
    })

    socket.on(serverEvents.connectionAccepted, ({ profile }: ConnectionAcceptedPayload) => {
      const nextSession: AuthSession = {
        ...sessionRef.current,
        profile,
      }

      sessionRef.current = nextSession
      profileResolvedRef.current = true
      setResolvedProfile(profile)
      if (nextSession.provider === 'local') {
        saveAuthSession(nextSession)
      }
      onSessionChange(nextSession)

      const code = new URLSearchParams(window.location.search).get('room')?.trim().toUpperCase()
      if (code && requestedMapCodeRef.current !== code) {
        requestedMapCodeRef.current = code
        setMapPersistenceMessage('Cargando mapa...')
        socket.emit(
          clientEvents.loadRoomEditorMap,
          { code },
          (response: { ok: boolean; map?: SavedRoomEditorMap; message?: string }) => {
            if (!response.ok || !response.map) {
              setMapPersistenceMessage(response.message ?? 'No fue posible cargar el mapa.')
              return
            }

            const loadedMap = response.map
            setMapName(loadedMap.name)
            setSavedMapCode(loadedMap.code)
            setSavedMapOwnerUserId(loadedMap.ownerUserId)
            setPublishedRoutePath(loadedMap.routePath)
            setClassCode(loadedMap.classCode ?? '')
            setPublicationType(
              loadedMap.publicationKind === 'classroom' ? 'room'
                : loadedMap.publicationKind === 'draft'
                  ? profile.role === 'developer' ? 'system' : 'room'
                  : loadedMap.publicationKind,
            )
            setMapGridWidth(loadedMap.document.gridWidth)
            setMapGridHeight(loadedMap.document.gridHeight)
            setLayers(loadedMap.document.layers)
            setActiveLayerId(loadedMap.document.layers[0]?.id ?? 'floor')
            placedAssetsRef.current = loadedMap.document.placements
            setPlacedAssets(loadedMap.document.placements)
            assetEditHistoryRef.current = []
            setSelectedMapArea(null)
            setTestSpawn(null)
            const highestCustomLayerId = loadedMap.document.layers.reduce((highest, layer) => {
              const match = /^layer-(\d+)$/.exec(layer.id)
              return match ? Math.max(highest, Number(match[1])) : highest
            }, 0)
            nextLayerIdRef.current = highestCustomLayerId + 1
            setMapPersistenceMessage(`Mapa cargado · ${loadedMap.code}`)
          },
        )
      }
    })

    socket.on('disconnect', () => {
      if (!profileResolvedRef.current) {
        setValidationFailed(true)
      }
    })

    return () => {
      socketRef.current = null
      socket.disconnect()
    }
  }, [onSessionChange])

  useEffect(() => {
    let isActive = true

    void loadRoomEditorAssetCategories().then((categories) => {
      if (isActive) {
        setAssetCategories(categories)
      }
    }).catch((error: unknown) => {
      console.error('[room-editor] No fue posible preparar la paleta de assets.', error)
    })

    return () => {
      isActive = false
    }
  }, [])

  useEffect(() => {
    const handleEditorShortcut = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      if (target?.matches('input, textarea, select, [contenteditable="true"]')) {
        return
      }

      const key = event.key.toLocaleLowerCase()

      if (key === 't') {
        event.preventDefault()
        if (testSpawn) {
          setTestSpawn(null)
          setIsSelectToolActive(true)
        } else {
          setIsTestSpawnToolActive(true)
          setIsPaintToolActive(false)
          setIsEraseToolActive(false)
          setIsSelectToolActive(false)
          setSelectedMapArea(null)
        }
        return
      }

      if (testSpawn) {
        if (key === 'escape') {
          event.preventDefault()
          setTestSpawn(null)
          setIsSelectToolActive(true)
          return
        }

        if (key === 'p') {
          event.preventDefault()
          setIsDebugEnabled((isEnabled) => !isEnabled)
        }
        return
      }

      if ((event.metaKey || event.ctrlKey) && !event.shiftKey && key === 'z') {
        const previousAssets = assetEditHistoryRef.current.pop()
        if (previousAssets) {
          event.preventDefault()
          placedAssetsRef.current = previousAssets
          setPlacedAssets(previousAssets)
        }
        return
      }

      if ((key === 'delete' || key === 'backspace') && selectedMapArea) {
        event.preventDefault()
        const currentAssets = placedAssetsRef.current
        const nextAssets = currentAssets.filter((asset) => (
          asset.layerId !== selectedMapArea.layerId
          || !isCellInsideArea(asset.cellX, asset.cellY, selectedMapArea)
        ))

        if (nextAssets.length !== currentAssets.length) {
          assetEditHistoryRef.current.push(currentAssets)
          if (assetEditHistoryRef.current.length > MAX_EDIT_HISTORY) {
            assetEditHistoryRef.current.shift()
          }
          placedAssetsRef.current = nextAssets
          setPlacedAssets(nextAssets)
        }
        return
      }

      if (key === 'escape') {
        setIsPaintToolActive(false)
        setIsEraseToolActive(false)
        setIsSelectToolActive(true)
        setIsTestSpawnToolActive(false)
        setSelectedMapArea(null)
        setDraggedMapArea(null)
        dragStartCellRef.current = null
        return
      }

      if (key === 'w') {
        event.preventDefault()
        setIsPaintToolActive(true)
        setIsEraseToolActive(false)
        setIsSelectToolActive(false)
        setIsTestSpawnToolActive(false)
        setSelectedMapArea(null)
        return
      }

      if (key === 'd') {
        event.preventDefault()
        setIsPaintToolActive(false)
        setIsEraseToolActive(true)
        setIsSelectToolActive(false)
        setIsTestSpawnToolActive(false)
        setSelectedMapArea(null)
        return
      }

      if (key === 's') {
        event.preventDefault()
        setIsPaintToolActive(false)
        setIsEraseToolActive(false)
        setIsSelectToolActive(true)
        setIsTestSpawnToolActive(false)
        return
      }

      if (key === 'r' && selectedAssetId) {
        event.preventDefault()
        setIsAssetFlippedX((isFlipped) => !isFlipped)
        return
      }

      if (key === 'p') {
        event.preventDefault()
        setIsDebugEnabled((isEnabled) => !isEnabled)
      }
    }

    window.addEventListener('keydown', handleEditorShortcut)
    return () => window.removeEventListener('keydown', handleEditorShortcut)
  }, [selectedAssetId, selectedMapArea, testSpawn])

  if (!resolvedProfile && !validationFailed) {
    return <main className="edit-room-page" aria-label="Validando acceso al editor" />
  }

  const canAccessEditor = resolvedProfile
    ? canAccessRoomEditor(resolvedProfile.role)
    : false

  if (!canAccessEditor) {
    return (
      <main className="edit-room-page is-denied">
        <section className="edit-room-access-panel" aria-labelledby="edit-room-denied-title">
          <p className="edit-room-kicker">Acceso restringido</p>
          <h1 id="edit-room-denied-title">No puedes ingresar al editor</h1>
          <p>
            {validationFailed ? (
              <>No fue posible validar tu rol con el servidor.</>
            ) : (
              <>
                Tu rol actual es <strong>{resolvedProfile?.role}</strong>. El rol visitante puede acceder a
                salas publicadas, pero no crear escenas.
              </>
            )}
          </p>
          <button type="button" onClick={() => navigateInApp('/Tavern')}>
            Volver a la taberna
          </button>
        </section>
      </main>
    )
  }

  const mapWidthPx = mapGridWidth * 128
  const mapHeightPx = mapGridHeight * 128
  const scaledMapWidthPx = Math.round(mapWidthPx * mapZoom)
  const scaledMapHeightPx = Math.round(mapHeightPx * mapZoom)
  const zoomPercentage = Math.round(mapZoom * 100)
  const activeLayer = layers.find((layer) => layer.id === activeLayerId) ?? layers[0]
  const activeToolLabel = isPaintToolActive
    ? 'ModoPintar'
    : isEraseToolActive
      ? 'ModoBorrar'
      : isSelectToolActive
        ? 'ModoSeleccionar'
        : isTestSpawnToolActive
          ? 'ModoTest'
          : 'ModoSeleccionar'
  const availableAssets = assetCategories.flatMap((category) => category.assets)
  const selectedAsset = availableAssets.find((asset) => asset.id === selectedAssetId) ?? null
  const visiblePlacedAssets = [...placedAssets].sort((left, right) => (
    getEditorLayerPriority(left.layerId) - getEditorLayerPriority(right.layerId)
  ))
  const assetById = new Map(availableAssets.map((asset) => [asset.id, asset]))
  const layerById = new Map(layers.map((layer) => [layer.id, layer]))
  const testObjects = placedAssets.flatMap((placement) => {
    const asset = assetById.get(placement.assetId)
    const layer = layerById.get(placement.layerId)
    return asset
      ? [createPlacedObjectTemplate(placement, asset, layer?.collidersEnabled ?? true)]
      : []
  })
  const testTemplate: RoomTemplate = {
    id: 'edit-room-test',
    routeSegment: 'edit-room-test',
    name: 'Prueba del editor',
    chatMode: 'scene',
    world: {
      width: mapWidthPx,
      height: mapHeightPx,
      spawn: testSpawn ?? { x: 64, y: 64 },
      backgroundColor: 0x3a3a3a,
      gridColor: 0x666666,
    },
    camera: {
      delayMs: 120,
      offsetX: 0,
      offsetY: 0,
      clampBorders: true,
      marginX: 0,
      marginY: 0,
    },
    objects: testObjects,
    npcs: [],
    teleports: [],
    enemies: [],
  }

  if (testSpawn && resolvedProfile) {
    return (
      <EditRoomTestMode
        template={testTemplate}
        profile={resolvedProfile}
        debugEnabled={isDebugEnabled}
        resolveObjectSpriteSrc={(objectTemplate) => (
          objectTemplate.spriteAssetId
            ? assetById.get(objectTemplate.spriteAssetId)?.url
            : undefined
        )}
      />
    )
  }

  const updateGridSize = (
    rawValue: string,
    setter: (nextValue: number) => void,
  ) => {
    const numericValue = Number(rawValue)
    if (!Number.isFinite(numericValue)) {
      return
    }

    setter(Math.min(50, Math.max(1, Math.floor(numericValue))))
  }

  const updateZoom = (nextZoom: number) => {
    setMapZoom(Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, nextZoom)))
  }

  const commitPlacedAssetEdit = (
    update: (currentAssets: PlacedRoomAsset[]) => PlacedRoomAsset[],
  ) => {
    const currentAssets = placedAssetsRef.current
    const nextAssets = update(currentAssets)
    const didChange = currentAssets.length !== nextAssets.length
      || currentAssets.some((asset, index) => {
        const nextAsset = nextAssets[index]
        return !nextAsset
          || asset.layerId !== nextAsset.layerId
          || asset.assetId !== nextAsset.assetId
          || asset.cellX !== nextAsset.cellX
          || asset.cellY !== nextAsset.cellY
          || asset.flippedX !== nextAsset.flippedX
      })

    if (!didChange) {
      return
    }

    assetEditHistoryRef.current.push(currentAssets)
    if (assetEditHistoryRef.current.length > MAX_EDIT_HISTORY) {
      assetEditHistoryRef.current.shift()
    }

    placedAssetsRef.current = nextAssets
    setPlacedAssets(nextAssets)
  }

  const createLayer = () => {
    const requestedName = newLayerName.trim()
    const fallbackName = `Capa ${nextLayerIdRef.current}`
    const baseName = requestedName || fallbackName
    const existingNames = new Set(layers.map((layer) => layer.name.toLocaleLowerCase()))
    let layerName = baseName
    let duplicateIndex = 2

    while (existingNames.has(layerName.toLocaleLowerCase())) {
      layerName = `${baseName} ${duplicateIndex}`
      duplicateIndex += 1
    }

    const layerId = `layer-${nextLayerIdRef.current}`
    nextLayerIdRef.current += 1
    setLayers((currentLayers) => [
      ...currentLayers,
      { id: layerId, name: layerName, collidersEnabled: true },
    ])
    setActiveLayerId(layerId)
    setNewLayerName('')
  }

  const deleteLayer = (layerId: string) => {
    const layerToDelete = layers.find((layer) => layer.id === layerId)
    if (!layerToDelete || layerToDelete.required || layers.length <= REQUIRED_EDITOR_LAYERS.length) {
      return
    }

    const layerIndex = layers.findIndex((layer) => layer.id === layerId)
    const remainingLayers = layers.filter((layer) => layer.id !== layerId)

    setLayers(remainingLayers)
    const remainingPlacedAssets = placedAssetsRef.current.filter((asset) => asset.layerId !== layerId)
    placedAssetsRef.current = remainingPlacedAssets
    assetEditHistoryRef.current = []
    setPlacedAssets(remainingPlacedAssets)
    if (activeLayerId === layerId) {
      const nextActiveLayer = remainingLayers[Math.min(layerIndex, remainingLayers.length - 1)]
      setActiveLayerId(nextActiveLayer.id)
    }
  }

  const toggleLayerColliders = (layerId: string) => {
    setLayers((currentLayers) => currentLayers.map((layer) => (
      layer.id === layerId
        ? { ...layer, collidersEnabled: !layer.collidersEnabled }
        : layer
    )))
  }

  const getMapCellFromPointer = (event: ReactPointerEvent<HTMLDivElement>): MapCellPosition => {
    const mapBounds = event.currentTarget.getBoundingClientRect()
    const borderSize = 2 * mapZoom
    const mapX = (event.clientX - mapBounds.left - borderSize) / mapZoom
    const mapY = (event.clientY - mapBounds.top - borderSize) / mapZoom

    return {
      x: Math.min(mapGridWidth - 1, Math.max(0, Math.floor(mapX / 128))),
      y: Math.min(mapGridHeight - 1, Math.max(0, Math.floor(mapY / 128))),
    }
  }

  const trackMapCell = (event: ReactPointerEvent<HTMLDivElement>) => {
    const nextCell = getMapCellFromPointer(event)
    setHoveredMapCell((currentCell) => (
      currentCell?.x === nextCell.x && currentCell.y === nextCell.y
        ? currentCell
        : nextCell
    ))

    if (dragStartCellRef.current) {
      setDraggedMapArea(getNormalizedCellArea(dragStartCellRef.current, nextCell))
    }
  }

  const applyMapAreaEdit = (area: MapCellArea) => {
    if (isSelectToolActive) {
      setSelectedMapArea({
        layerId: activeLayer.id,
        ...area,
      })
      return
    }

    if (isTestSpawnToolActive) {
      setIsTestSpawnToolActive(false)
      setHoveredMapCell(null)
      setTestSpawn({
        x: area.endX * 128 + 64,
        y: area.endY * 128 + 96,
      })
      return
    }

    if (isEraseToolActive) {
      commitPlacedAssetEdit((currentAssets) => currentAssets.filter((asset) => (
        asset.layerId !== activeLayer.id
        || !isCellInsideArea(asset.cellX, asset.cellY, area)
      )))
      return
    }

    if (!isPaintToolActive || !selectedAsset) {
      return
    }

    const newPlacements: PlacedRoomAsset[] = []
    for (let cellY = area.startY; cellY <= area.endY; cellY += 1) {
      for (let cellX = area.startX; cellX <= area.endX; cellX += 1) {
        newPlacements.push({
          layerId: activeLayer.id,
          assetId: selectedAsset.id,
          cellX,
          cellY,
          flippedX: isAssetFlippedX,
        })
      }
    }

    commitPlacedAssetEdit((currentAssets) => [
      ...currentAssets.filter((asset) => (
        asset.layerId !== activeLayer.id
        || !isCellInsideArea(asset.cellX, asset.cellY, area)
      )),
      ...newPlacements,
    ])
  }

  const beginMapDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (
      event.button !== 0
      || (!isPaintToolActive && !isEraseToolActive && !isSelectToolActive && !isTestSpawnToolActive)
    ) {
      return
    }

    event.preventDefault()
    const startCell = getMapCellFromPointer(event)
    dragStartCellRef.current = startCell
    setDraggedMapArea(getNormalizedCellArea(startCell, startCell))
    if (isSelectToolActive) {
      setSelectedMapArea(null)
    }
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  const finishMapDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    const startCell = dragStartCellRef.current
    if (!startCell) {
      return
    }

    const endCell = getMapCellFromPointer(event)
    const completedArea = getNormalizedCellArea(startCell, endCell)
    dragStartCellRef.current = null
    setDraggedMapArea(null)
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
    applyMapAreaEdit(completedArea)
  }

  const cancelMapDrag = () => {
    dragStartCellRef.current = null
    setDraggedMapArea(null)
  }

  const renderPlacedAsset = (placement: PlacedRoomAsset) => {
    const asset = availableAssets.find((candidate) => candidate.id === placement.assetId)
    if (!asset) {
      return null
    }

    const layer = layerById.get(placement.layerId)
    const objectTemplate = createPlacedObjectTemplate(
      placement,
      asset,
      layer?.collidersEnabled ?? true,
    )

    return (
      <ObjectDecoration
        key={`${placement.layerId}-${placement.cellX}-${placement.cellY}`}
        objectTemplate={objectTemplate}
        spriteSrc={asset.url}
        debugEnabled={isDebugEnabled}
        flippedX={placement.flippedX}
        zIndex={getEditorLayerPriority(placement.layerId)}
      />
    )
  }

  const saveMap = (publicationConfirmed = false) => {
    const socket = socketRef.current
    if (!socket?.connected || !resolvedProfile) {
      setMapPersistenceMessage('El servidor no esta conectado.')
      return
    }
    const canOverwrite = Boolean(savedMapCode && savedMapOwnerUserId === resolvedProfile.userId)
    const requiresPublication = !publishedRoutePath || !canOverwrite
    if (requiresPublication && !publicationConfirmed) {
      if (!canOverwrite && savedMapCode) {
        setPublicationType(resolvedProfile.role === 'developer' ? 'system' : 'room')
        setClassCode('')
      }
      setPublicationSceneName(!canOverwrite && savedMapCode ? `${mapName} copia` : '')
      setIsPublicationDialogOpen(true)
      return
    }
    const normalizedName = requiresPublication ? publicationSceneName.trim() : mapName.trim()
    if (!normalizedName) {
      setMapPersistenceMessage('Escribe el nombre de la escena.')
      return
    }
    if (requiresPublication && classCode.trim().length < 2) {
      setMapPersistenceMessage('Escribe el codigo de la clase.')
      return
    }

    setIsSavingMap(true)
    setMapPersistenceMessage('Guardando mapa...')
    socket.emit(
      clientEvents.saveRoomEditorMap,
      {
        code: canOverwrite ? savedMapCode : undefined,
        name: normalizedName,
        document: {
          version: 1,
          gridWidth: mapGridWidth,
          gridHeight: mapGridHeight,
          layers,
          placements: placedAssetsRef.current,
          assets: availableAssets.map((asset) => ({
            id: asset.id,
            category: asset.category,
            frameWidth: asset.frameWidth,
            frameHeight: asset.frameHeight,
            occupiedColumns: asset.occupiedColumns,
            occupiedRows: asset.occupiedRows,
            colliderWidth: asset.colliderWidth,
            colliderHeight: asset.colliderHeight,
            colliderOffsetX: asset.colliderOffsetX,
            colliderOffsetY: asset.colliderOffsetY,
            zIndexOffsetY: asset.zIndexOffsetY,
          })),
        },
        publication: !requiresPublication
          ? undefined
          : publicationType === 'system'
            ? {
                kind: 'system',
                routeSlug: createGlobalRouteSlug(normalizedName),
                classCode: classCode.trim(),
              }
            : { kind: publicationType, accessCode: classCode.trim() },
      },
      (response: { ok: boolean; map?: SavedRoomEditorMap; message?: string }) => {
        setIsSavingMap(false)
        if (!response.ok || !response.map) {
          setMapPersistenceMessage(response.message ?? 'No fue posible guardar el mapa.')
          return
        }

        setSavedMapCode(response.map.code)
        setSavedMapOwnerUserId(response.map.ownerUserId)
        setPublishedRoutePath(response.map.routePath)
        setMapName(response.map.name)
        setIsPublicationDialogOpen(false)
        window.history.replaceState({}, '', `/EditRoom?room=${response.map.code}`)
        setMapPersistenceMessage(
          `Guardado correctamente · ${response.map.routePath ?? response.map.code}`,
        )
      },
    )
  }

  const copyMapLink = () => {
    if (!publishedRoutePath) return
    const mapUrl = `${window.location.origin}${publishedRoutePath}`
    if (!navigator.clipboard) {
      setMapPersistenceMessage(`URL de la sala: ${publishedRoutePath}`)
      return
    }
    void navigator.clipboard.writeText(mapUrl).then(() => {
      setMapPersistenceMessage(`Enlace copiado · ${publishedRoutePath}`)
    }).catch(() => {
      setMapPersistenceMessage(`URL de la sala: ${publishedRoutePath}`)
    })
  }

  return (
    <main className="edit-room-page" aria-label="Editor de salas">
      <header className="edit-room-toolbar">
        <section className="edit-room-map-size" aria-label="Tamaño del mapa">
          <strong>Tamaño del mapa</strong>
          <label htmlFor="edit-room-grid-x">
            <span>X</span>
            <input
              id="edit-room-grid-x"
              type="number"
              min="1"
              max="50"
              value={mapGridWidth}
              onChange={(event) => updateGridSize(event.target.value, setMapGridWidth)}
            />
          </label>
          <label htmlFor="edit-room-grid-y">
            <span>Y</span>
            <input
              id="edit-room-grid-y"
              type="number"
              min="1"
              max="50"
              value={mapGridHeight}
              onChange={(event) => updateGridSize(event.target.value, setMapGridHeight)}
            />
          </label>
          <output>{mapWidthPx} × {mapHeightPx} px</output>
        </section>

        <section className="edit-room-save-controls" aria-label="Guardar mapa">
          <strong className="edit-room-scene-name">{mapName}</strong>
          <button type="button" onClick={() => saveMap()} disabled={isSavingMap}>
            {savedMapCode && savedMapOwnerUserId !== resolvedProfile?.userId
              ? 'Guardar copia'
              : isSavingMap ? 'Guardando...' : 'Guardar'}
          </button>
          <button
            type="button"
            onClick={copyMapLink}
            title={publishedRoutePath ? 'Copiar URL de acceso a la sala' : 'Guarda primero la escena'}
            disabled={!publishedRoutePath}
          >
            Copiar enlace
          </button>
        </section>

        <div className="edit-room-toolbar-spacer" />
        <span className="edit-room-role-chip">{resolvedProfile?.role}</span>
        <button type="button" className="edit-room-exit-button" onClick={() => navigateInApp('/Editor')}>
          Salir
        </button>
      </header>

      <section className="edit-room-layout">
        <aside className="edit-room-panel edit-room-assets-panel" aria-label="Assets por categoría">
          <header>
            <span>Assets</span>
            <output>{assetCategories.reduce((total, category) => total + category.assets.length, 0)}</output>
          </header>
          <div className="edit-room-panel-body edit-room-assets-body">
            {assetCategories.length === 0 ? (
              <p className="edit-room-assets-empty">No hay assets disponibles.</p>
            ) : assetCategories.map((category) => (
              <details key={category.id} className="edit-room-asset-collection" open>
                <summary>
                  <span>{category.name}</span>
                  <output>{category.assets.length}</output>
                </summary>
                <div className="edit-room-asset-grid">
                  {category.assets.map((asset) => {
                    const assetLabel = formatAssetLabel(asset.name)
                    const previewScale = Math.min(64 / asset.frameWidth, 64 / asset.frameHeight)

                    return (
                      <button
                        key={asset.id}
                        type="button"
                        className={`edit-room-asset-tile${selectedAssetId === asset.id ? ' is-selected' : ''}`}
                        aria-label={`${assetLabel}, categoría ${category.name}`}
                        aria-pressed={selectedAssetId === asset.id}
                        title={`${assetLabel} · ${asset.frameWidth}×${asset.frameHeight} · ${asset.occupiedColumns}×${asset.occupiedRows} celdas`}
                        onClick={() => {
                          setSelectedAssetId(asset.id)
                          setIsPaintToolActive(true)
                          setIsEraseToolActive(false)
                          setIsSelectToolActive(false)
                          setIsTestSpawnToolActive(false)
                          setSelectedMapArea(null)
                        }}
                      >
                        <span className="edit-room-asset-preview" aria-hidden="true">
                          <img
                            src={asset.url}
                            alt=""
                            draggable={false}
                            style={{
                              width: `${asset.frameWidth}px`,
                              height: `${asset.frameHeight}px`,
                              transform: `scale(${previewScale})`,
                            }}
                          />
                        </span>
                        <span className="edit-room-asset-name">{assetLabel}</span>
                        <span className="edit-room-asset-size">
                          {asset.occupiedColumns}×{asset.occupiedRows} celdas · {asset.frameWidth}×{asset.frameHeight} px
                        </span>
                      </button>
                    )
                  })}
                </div>
              </details>
            ))}
          </div>
        </aside>

        <section className="edit-room-workspace" aria-label="Área de trabajo">
          <div className="edit-room-active-layer-badge">
            <strong>{activeLayer.name} : {activeToolLabel}</strong>
          </div>
          <div className="edit-room-canvas-viewport">
            <div className="edit-room-canvas-stage">
              <div
                className="edit-room-map-scale-frame"
                style={{
                  width: `${scaledMapWidthPx}px`,
                  height: `${scaledMapHeightPx}px`,
                }}
              >
                <div
                  className={`edit-room-map-canvas${isPaintToolActive ? ' is-painting' : ''}${isEraseToolActive ? ' is-erasing' : ''}${isSelectToolActive ? ' is-selecting' : ''}${isTestSpawnToolActive ? ' is-testing-spawn' : ''}`}
                  data-active-layer={activeLayer.id}
                  style={{
                    width: `${mapWidthPx}px`,
                    height: `${mapHeightPx}px`,
                    transform: `scale(${mapZoom})`,
                  }}
                  aria-label={`Mapa de ${mapWidthPx} por ${mapHeightPx} pixeles, capa ${activeLayer.name}, al ${zoomPercentage} por ciento`}
                  onPointerDown={beginMapDrag}
                  onPointerMove={trackMapCell}
                  onPointerUp={finishMapDrag}
                  onPointerCancel={cancelMapDrag}
                  onPointerLeave={() => {
                    if (!dragStartCellRef.current) {
                      setHoveredMapCell(null)
                    }
                  }}
                  onContextMenu={(event) => {
                    if (isPaintToolActive || isEraseToolActive || isSelectToolActive || isTestSpawnToolActive) {
                      event.preventDefault()
                      setIsPaintToolActive(false)
                      setIsEraseToolActive(false)
                      setIsSelectToolActive(true)
                      setIsTestSpawnToolActive(false)
                      setSelectedMapArea(null)
                      cancelMapDrag()
                    }
                  }}
                >
                  {visiblePlacedAssets.map(renderPlacedAsset)}
                  {isTestSpawnToolActive && hoveredMapCell ? (
                    <span
                      className="edit-room-cell-tool-preview is-test"
                      style={{
                        left: `${hoveredMapCell.x * 128}px`,
                        top: `${hoveredMapCell.y * 128}px`,
                      }}
                      aria-hidden="true"
                    />
                  ) : null}
                  {selectedMapArea?.layerId === activeLayer.id ? (
                    <span
                      className="edit-room-cell-tool-preview is-select"
                      style={{
                        left: `${selectedMapArea.startX * 128}px`,
                        top: `${selectedMapArea.startY * 128}px`,
                        width: `${(selectedMapArea.endX - selectedMapArea.startX + 1) * 128}px`,
                        height: `${(selectedMapArea.endY - selectedMapArea.startY + 1) * 128}px`,
                      }}
                      aria-hidden="true"
                    />
                  ) : null}
                  {isSelectToolActive && draggedMapArea ? (
                    <span
                      className="edit-room-cell-tool-preview is-select"
                      style={{
                        left: `${draggedMapArea.startX * 128}px`,
                        top: `${draggedMapArea.startY * 128}px`,
                        width: `${(draggedMapArea.endX - draggedMapArea.startX + 1) * 128}px`,
                        height: `${(draggedMapArea.endY - draggedMapArea.startY + 1) * 128}px`,
                      }}
                      aria-hidden="true"
                    />
                  ) : null}
                  {isEraseToolActive && (draggedMapArea || hoveredMapCell) ? (
                    <span
                      className="edit-room-cell-tool-preview is-erase"
                      style={{
                        left: `${(draggedMapArea?.startX ?? hoveredMapCell?.x ?? 0) * 128}px`,
                        top: `${(draggedMapArea?.startY ?? hoveredMapCell?.y ?? 0) * 128}px`,
                        width: `${draggedMapArea ? (draggedMapArea.endX - draggedMapArea.startX + 1) * 128 : 128}px`,
                        height: `${draggedMapArea ? (draggedMapArea.endY - draggedMapArea.startY + 1) * 128 : 128}px`,
                      }}
                      aria-hidden="true"
                    />
                  ) : null}
                  {isPaintToolActive && selectedAsset && (draggedMapArea || hoveredMapCell) ? (
                    <span
                      className="edit-room-cell-tool-preview is-paint"
                      style={{
                        left: `${(draggedMapArea?.startX ?? hoveredMapCell?.x ?? 0) * 128}px`,
                        top: `${(draggedMapArea?.startY ?? hoveredMapCell?.y ?? 0) * 128}px`,
                        width: `${draggedMapArea ? (draggedMapArea.endX - draggedMapArea.startX + 1) * 128 : selectedAsset.occupiedColumns * 128}px`,
                        height: `${draggedMapArea ? (draggedMapArea.endY - draggedMapArea.startY + 1) * 128 : selectedAsset.occupiedRows * 128}px`,
                      }}
                      aria-hidden="true"
                    >
                      {!draggedMapArea ? (
                        <img
                          className="edit-room-paint-preview-sprite"
                          src={selectedAsset.url}
                          alt=""
                          draggable={false}
                          style={{
                            width: `${selectedAsset.frameWidth}px`,
                            height: `${selectedAsset.frameHeight}px`,
                            transform: isAssetFlippedX ? 'scaleX(-1)' : undefined,
                          }}
                        />
                      ) : null}
                    </span>
                  ) : null}
                </div>
              </div>
            </div>
          </div>
        </section>

        <aside className="edit-room-tools-panel" aria-label="Herramientas y capas">
          <section className="edit-room-panel edit-room-tools-section" aria-label="Herramientas">
            <header>Herramientas</header>
            <div className="edit-room-panel-body edit-room-tools-body">
              <section className="edit-room-tool-group edit-room-paint-tool" aria-label="Herramienta de pintura">
                <strong>Editar celdas</strong>
                <output>
                  {isPaintToolActive
                    ? 'Pintar'
                    : isEraseToolActive
                      ? 'Borrar'
                      : isSelectToolActive
                        ? 'Seleccionar'
                        : isTestSpawnToolActive
                          ? 'Elegir respawn'
                          : 'Seleccionar'}
                </output>
                <button
                  type="button"
                  className={isPaintToolActive ? 'is-active' : ''}
                  aria-pressed={isPaintToolActive}
                  onClick={() => {
                    const nextIsActive = !isPaintToolActive
                    setIsPaintToolActive(nextIsActive)
                    setIsEraseToolActive(false)
                    setIsSelectToolActive(!nextIsActive)
                    setIsTestSpawnToolActive(false)
                    setSelectedMapArea(null)
                  }}
                >
                  Pintar
                </button>
                <button
                  type="button"
                  className={isEraseToolActive ? 'is-active is-erase' : ''}
                  aria-pressed={isEraseToolActive}
                  onClick={() => {
                    const nextIsActive = !isEraseToolActive
                    setIsEraseToolActive(nextIsActive)
                    setIsPaintToolActive(false)
                    setIsSelectToolActive(!nextIsActive)
                    setIsTestSpawnToolActive(false)
                    setSelectedMapArea(null)
                  }}
                >
                  Borrar
                </button>
                <button
                  type="button"
                  className={isSelectToolActive ? 'is-active is-select' : ''}
                  aria-pressed={isSelectToolActive}
                  onClick={() => {
                    setIsSelectToolActive(true)
                    setIsPaintToolActive(false)
                    setIsEraseToolActive(false)
                    setIsTestSpawnToolActive(false)
                  }}
                >
                  Seleccionar
                </button>
                <button
                  type="button"
                  className={isTestSpawnToolActive ? 'is-active is-test' : ''}
                  aria-pressed={isTestSpawnToolActive}
                  onClick={() => {
                    const nextIsActive = !isTestSpawnToolActive
                    setIsTestSpawnToolActive(nextIsActive)
                    setIsPaintToolActive(false)
                    setIsEraseToolActive(false)
                    setIsSelectToolActive(!nextIsActive)
                    setSelectedMapArea(null)
                  }}
                >
                  Test: elegir respawn
                </button>
                <small>
                  {selectedAsset
                    ? `${formatAssetLabel(selectedAsset.name)} seleccionado · ${isAssetFlippedX ? 'Invertido X' : 'Normal'}`
                    : 'Selecciona un asset de la paleta'}
                </small>
                <small className="edit-room-tool-shortcuts">
                  W: pintar · D: borrar · S: seleccionar · Del/Backspace: borrar selección · R: invertir X · T: probar/salir · P: debug · ⌘/Ctrl+Z: deshacer · Esc: seleccionar
                </small>
              </section>

              <section className="edit-room-tool-group" aria-label="Herramienta de zoom">
                <strong>Zoom</strong>
                <output>{zoomPercentage}%</output>
                <div className="edit-room-zoom-controls">
                  <button
                    type="button"
                    aria-label="Alejar mapa"
                    title="Alejar mapa"
                    disabled={mapZoom <= MIN_ZOOM}
                    onClick={() => updateZoom(mapZoom - ZOOM_STEP)}
                  >
                    −
                  </button>
                  <button
                    type="button"
                    aria-label="Restablecer zoom"
                    title="Restablecer zoom"
                    onClick={() => updateZoom(1)}
                  >
                    1:1
                  </button>
                  <button
                    type="button"
                    aria-label="Acercar mapa"
                    title="Acercar mapa"
                    disabled={mapZoom >= MAX_ZOOM}
                    onClick={() => updateZoom(mapZoom + ZOOM_STEP)}
                  >
                    +
                  </button>
                </div>
              </section>
            </div>
          </section>

          <section className="edit-room-panel edit-room-layers-section" aria-label="Capas del mapa">
            <header>
              <span>Capas</span>
              <output>{layers.length}</output>
            </header>
            <div className="edit-room-panel-body edit-room-layers-body">
              <form
                className="edit-room-layer-creator"
                onSubmit={(event) => {
                  event.preventDefault()
                  createLayer()
                }}
              >
                <input
                  type="text"
                  maxLength={32}
                  value={newLayerName}
                  aria-label="Nombre de la nueva capa"
                  placeholder="Nombre de la capa"
                  onChange={(event) => setNewLayerName(event.target.value)}
                />
                <button type="submit" aria-label="Crear capa" title="Crear capa">+</button>
              </form>

              <div className="edit-room-layer-list" role="list" aria-label="Capas disponibles">
                {layers.map((layer) => (
                  <div
                    key={layer.id}
                    className={`edit-room-layer-row${layer.id === activeLayer.id ? ' is-active' : ''}`}
                    role="listitem"
                  >
                    <button
                      type="button"
                      className="edit-room-layer-select"
                      aria-pressed={layer.id === activeLayer.id}
                      onClick={() => {
                        setActiveLayerId(layer.id)
                        setSelectedMapArea(null)
                      }}
                    >
                      <span aria-hidden="true" className="edit-room-layer-visibility">◆</span>
                      <span className="edit-room-layer-name">{layer.name}</span>
                      {layer.id === activeLayer.id ? (
                        <span className="edit-room-layer-mode">: {activeToolLabel}</span>
                      ) : null}
                    </button>
                    <button
                      type="button"
                      className={`edit-room-layer-collider-toggle${layer.collidersEnabled ? ' is-enabled' : ''}`}
                      aria-label={`${layer.collidersEnabled ? 'Desactivar' : 'Activar'} colliders de ${layer.name}`}
                      aria-pressed={layer.collidersEnabled}
                      title={`Colliders ${layer.collidersEnabled ? 'activos' : 'desactivados'} · ${layer.name}`}
                      onClick={() => toggleLayerColliders(layer.id)}
                    >
                      C
                    </button>
                    <button
                      type="button"
                      className="edit-room-layer-delete"
                      aria-label={`Eliminar capa ${layer.name}`}
                      title={layer.required ? 'Capa base del editor' : `Eliminar ${layer.name}`}
                      disabled={layer.required}
                      onClick={() => deleteLayer(layer.id)}
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
            </div>
          </section>
        </aside>
      </section>

      <footer className="edit-room-statusbar">
        <span>Cuadrícula: 128 × 128 px</span>
        <span>
          {mapGridWidth} × {mapGridHeight} celdas · Zoom {zoomPercentage}% · {activeLayer.name}: {activeToolLabel}
          {isPaintToolActive && isAssetFlippedX ? ' · X invertido' : ''}
          {isDebugEnabled ? ' · Debug activo' : ''}
        </span>
      </footer>

      {isPublicationDialogOpen ? (
        <div className="edit-room-publication-overlay" role="presentation">
          <section
            className="edit-room-publication-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="edit-room-publication-title"
          >
            <h2 id="edit-room-publication-title">Publicar escena</h2>
            <p>Estos datos quedarán bloqueados después del primer guardado.</p>

            <label htmlFor="edit-room-publication-name">
              Nombre de la escena
              <input
                id="edit-room-publication-name"
                value={publicationSceneName}
                maxLength={80}
                placeholder="Nueva escena"
                onChange={(event) => setPublicationSceneName(event.target.value)}
              />
            </label>

            <label htmlFor="edit-room-publication-type">Tipo de sala</label>
            <select
              id="edit-room-publication-type"
              value={publicationType}
              disabled={resolvedProfile?.role !== 'admin' && resolvedProfile?.role !== 'developer'}
              onChange={(event) => setPublicationType(
                event.target.value as 'system' | 'room' | 'event' | 'official',
              )}
            >
              {(resolvedProfile?.role === 'user' || resolvedProfile?.role === 'mage' || resolvedProfile?.role === 'admin')
                ? <option value="room">Sala</option> : null}
              {(resolvedProfile?.role === 'admin' || resolvedProfile?.role === 'developer')
                ? <option value="event">Evento</option> : null}
              {resolvedProfile?.role === 'developer' ? (
                <>
                  <option value="official">Sala oficial</option>
                  <option value="system">URL global</option>
                </>
              ) : null}
            </select>

            <label htmlFor="edit-room-class-code">
              Código de la clase
              <input
                id="edit-room-class-code"
                value={classCode}
                maxLength={40}
                placeholder="Código de la clase"
                onChange={(event) => setClassCode(event.target.value.toUpperCase())}
              />
            </label>

            {publicationType === 'system' && publicationSceneName.trim() ? (
              <p className="edit-room-publication-preview">
                URL global: /{createGlobalRouteSlug(publicationSceneName.trim())}
              </p>
            ) : null}

            <div className="edit-room-publication-actions">
              <button type="button" onClick={() => setIsPublicationDialogOpen(false)} disabled={isSavingMap}>
                Cancelar
              </button>
              <button type="button" onClick={() => saveMap(true)} disabled={isSavingMap}>
                {isSavingMap ? 'Guardando...' : 'Guardar y publicar'}
              </button>
            </div>
            {mapPersistenceMessage !== 'Mapa sin guardar' ? <output>{mapPersistenceMessage}</output> : null}
          </section>
        </div>
      ) : null}
    </main>
  )
}
