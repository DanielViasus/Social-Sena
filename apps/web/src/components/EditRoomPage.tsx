import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type UIEvent as ReactUIEvent,
} from 'react'
import { io, type Socket } from 'socket.io-client'
import {
  clientEvents,
  hasMinimumUserRole,
  serverEvents,
  type ConnectionAcceptedPayload,
  type Position,
  type RoomObjectKind,
  type RoomObjectInteractionVariantTemplate,
  type RoomObjectTemplate,
  type RoomTeleportTemplate,
  type RoomEditorColliderData,
  type RoomEditorLayerData,
  type RoomEditorPlacementData,
  type RoomEditorSpawnPointData,
  type RoomTemplate,
  type SavedRoomEditorMap,
  type UserProfile,
} from '@social-sena/shared'
import { saveAuthSession, type AuthSession } from '../auth/localSession'
import eraseToolIconSrc from '../assets/room-editor/sprites/icon_Erase.svg'
import paintToolIconSrc from '../assets/room-editor/sprites/icon_Paint.svg'
import selectToolIconSrc from '../assets/room-editor/sprites/icon_Select.svg'
import testToolIconSrc from '../assets/room-editor/sprites/Icon_Test.svg'
import zoomActualSizeIconSrc from '../assets/room-editor/sprites/icon_zoom_1_1.svg'
import zoomInIconSrc from '../assets/room-editor/sprites/icon_zoom_add.svg'
import zoomOutIconSrc from '../assets/room-editor/sprites/icon_zoom_less.svg'
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
const DEFAULT_SPAWN_ID = 'default'
const TELEPORT_EDITOR_ASSET_ID = 'component-teleport'

const TELEPORT_EDITOR_ASSET: RoomEditorAsset = {
  id: TELEPORT_EDITOR_ASSET_ID,
  fileName: TELEPORT_EDITOR_ASSET_ID,
  category: 'Teleport',
  name: 'Teleport',
  frameWidth: 128,
  frameHeight: 128,
  occupiedColumns: 1,
  occupiedRows: 1,
  colliders: [],
  zIndexOffsetY: 48,
  warningArea: {
    width: 5 * 128,
    height: 5 * 128,
    offsetX: 0,
    offsetY: 0,
  },
  interactionArea: {
    width: 3 * 128,
    height: 3 * 128,
    offsetX: 0,
    offsetY: 0,
  },
  interactionIconContainer: {
    width: 128,
    height: 129,
    offsetX: 0,
    offsetY: -129,
  },
  sourceWidth: 128,
  sourceHeight: 128,
  url: '',
}

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
  { id: 'floor', name: 'Floor', enabled: true, collidersEnabled: false, required: true },
  { id: 'walls', name: 'Walls', enabled: true, collidersEnabled: true, required: true },
  { id: 'doors', name: 'Door', enabled: true, collidersEnabled: true, required: true },
  { id: 'object-decoration', name: 'ObjectDecoration', enabled: true, collidersEnabled: true, required: true },
  { id: 'teleports', name: 'Teleports', enabled: true, collidersEnabled: true, required: true },
]

const EDITOR_LAYER_PRIORITY: Record<string, number> = {
  floor: 0,
  walls: 1,
  doors: 2,
  'object-decoration': 3,
  teleports: 4,
}

const EDITOR_LAYER_COLORS: Record<string, string> = {
  floor: '#98a078',
  walls: '#75889b',
  doors: '#a18469',
  'object-decoration': '#907b99',
  teleports: '#619391',
}

const CUSTOM_EDITOR_LAYER_COLORS = [
  '#81778f',
  '#718b7c',
  '#927b74',
  '#788397',
  '#8e806d',
  '#70898f',
]

function getEditorLayerPriority(layerId: string) {
  return EDITOR_LAYER_PRIORITY[layerId] ?? EDITOR_LAYER_PRIORITY['object-decoration']
}

function getEditorLayerColor(layerId: string) {
  const fixedColor = EDITOR_LAYER_COLORS[layerId]
  if (fixedColor) {
    return fixedColor
  }

  const hash = Array.from(layerId).reduce(
    (total, character) => ((total * 31) + character.charCodeAt(0)) | 0,
    0,
  )
  return CUSTOM_EDITOR_LAYER_COLORS[Math.abs(hash) % CUSTOM_EDITOR_LAYER_COLORS.length]
    ?? '#81778f'
}

function getEditorLayerColorStyle(layerId: string) {
  return { '--edit-room-layer-color': getEditorLayerColor(layerId) } as CSSProperties
}

function normalizeEditorLayers(savedLayers: EditorLayer[]) {
  const savedLayersById = new Map(savedLayers.map((layer) => [layer.id, layer]))
  const requiredLayerIds = new Set(REQUIRED_EDITOR_LAYERS.map((layer) => layer.id))
  return [
    ...REQUIRED_EDITOR_LAYERS.map((requiredLayer) => ({
      ...requiredLayer,
      ...savedLayersById.get(requiredLayer.id),
      required: true,
    })),
    ...savedLayers
      .filter((layer) => !requiredLayerIds.has(layer.id))
      .map((layer) => ({ ...layer, enabled: layer.enabled !== false })),
  ]
}

type PlacedRoomAsset = RoomEditorPlacementData

function getPlacedAssetKey(placement: PlacedRoomAsset) {
  return `${placement.layerId}:${placement.cellX}:${placement.cellY}:${placement.assetId}`
}

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
  placementKey?: string
  sourceCellX?: number
  sourceCellY?: number
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

function getPlacementFootprintArea(
  placement: PlacedRoomAsset,
  asset: RoomEditorAsset | undefined,
): MapCellArea {
  return {
    startX: placement.cellX,
    startY: placement.cellY,
    endX: placement.cellX + Math.max(1, asset?.occupiedColumns ?? 1) - 1,
    endY: placement.cellY + Math.max(1, asset?.occupiedRows ?? 1) - 1,
  }
}

function getPlacementSelectionArea(
  placement: PlacedRoomAsset,
  asset: RoomEditorAsset | undefined,
): SelectedMapArea {
  return {
    layerId: placement.layerId,
    placementKey: getPlacedAssetKey(placement),
    ...getPlacementFootprintArea(placement, asset),
  }
}

function arePlacementCollidersEqual(
  left: RoomEditorColliderData[] | undefined,
  right: RoomEditorColliderData[] | undefined,
) {
  if (left === right) return true
  if (!left || !right || left.length !== right.length) return false

  return left.every((collider, index) => {
    const nextCollider = right[index]
    return nextCollider
      && collider.width === nextCollider.width
      && collider.height === nextCollider.height
      && collider.offsetX === nextCollider.offsetX
      && collider.offsetY === nextCollider.offsetY
  })
}

function normalizeEditorInteger(
  rawValue: string,
  minimum: number,
  maximum: number,
  fallback: number,
) {
  const numericValue = Number(rawValue)
  if (!Number.isFinite(numericValue)) return fallback
  return Math.min(maximum, Math.max(minimum, Math.floor(numericValue)))
}

function normalizeTeleportTargetPath(rawValue: string) {
  const trimmedValue = rawValue.trim()
  if (!trimmedValue) return ''

  try {
    const targetUrl = new URL(trimmedValue, window.location.origin)
    if (targetUrl.protocol !== 'http:' && targetUrl.protocol !== 'https:') {
      return null
    }

    const pathname = targetUrl.pathname.replace(/\/+$/, '') || '/'
    return `${pathname}${targetUrl.search}${targetUrl.hash}`
  } catch {
    return null
  }
}

function parseSpawnSourcePaths(rawValue: string) {
  const sourceTokens = rawValue
    .trim()
    .replace(/^\/all\s*:/i, '/all;')
    .split(';')
    .map((value) => value.trim())
    .filter(Boolean)
  const normalizedPaths: string[] = []

  for (const sourceToken of sourceTokens) {
    const normalizedPath = normalizeTeleportTargetPath(sourceToken)
    if (normalizedPath === null) return null
    const pathname = normalizedPath.split(/[?#]/, 1)[0] ?? ''
    if (!pathname) continue
    if (pathname.length > 240) return null
    if (!normalizedPaths.some((path) => path.toLowerCase() === pathname.toLowerCase())) {
      normalizedPaths.push(pathname)
    }
    if (normalizedPaths.length > 40) return null
  }

  return normalizedPaths
}

function createSpawnPointId(spawnPoints: RoomEditorSpawnPointData[]) {
  if (!spawnPoints.some((spawnPoint) => spawnPoint.id === DEFAULT_SPAWN_ID)) {
    return DEFAULT_SPAWN_ID
  }

  let spawnIndex = 2
  while (spawnPoints.some((spawnPoint) => spawnPoint.id === `spawn-${spawnIndex}`)) {
    spawnIndex += 1
  }
  return `spawn-${spawnIndex}`
}

function getSpawnSourcePaths(spawnPoint: RoomEditorSpawnPointData) {
  return spawnPoint.sourcePaths
    ?? spawnPoint.entryKey?.split(';').map((path) => path.trim()).filter(Boolean)
    ?? []
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

function createPlacedObjectVariant(
  placement: PlacedRoomAsset,
  asset: RoomEditorAsset,
  collidersEnabled = true,
): RoomObjectInteractionVariantTemplate {
  const usesBottomCenterAnchor = asset.frameWidth > 128 || asset.frameHeight > 128
  const occupiedWidth = asset.occupiedColumns * 128
  const occupiedHeight = asset.occupiedRows * 128
  const placementColliders = placement.colliders ?? asset.colliders
  const colliders = collidersEnabled
    ? placementColliders.map((collider) => ({
        ...collider,
        offsetX: placement.flippedX ? -collider.offsetX : collider.offsetX,
      }))
    : []
  const collider = colliders[0]
  const isInteractablePlacement = placement.layerId === 'doors' || placement.layerId === 'teleports'
  const warningArea = isInteractablePlacement
    ? {
        ...asset.warningArea,
        offsetX: placement.flippedX
          ? -asset.warningArea.offsetX
          : asset.warningArea.offsetX,
      }
    : undefined
  const interactionArea = isInteractablePlacement
    ? {
        ...asset.interactionArea,
        offsetX: placement.flippedX
          ? -asset.interactionArea.offsetX
          : asset.interactionArea.offsetX,
      }
    : undefined
  const interactionIconContainer = isInteractablePlacement
    ? {
        ...asset.interactionIconContainer,
        offsetX: placement.flippedX
          ? -asset.interactionIconContainer.offsetX
          : asset.interactionIconContainer.offsetX,
      }
    : undefined
  return {
    state: asset.interactionState ?? 0,
    x: placement.cellX * 128 + (usesBottomCenterAnchor ? occupiedWidth / 2 : asset.frameWidth / 2),
    y: placement.cellY * 128 + (
      usesBottomCenterAnchor ? occupiedHeight - asset.frameHeight / 2 : asset.frameHeight / 2
    ),
    width: asset.frameWidth,
    height: asset.frameHeight,
    spriteAssetId: asset.id,
    gridFootprint: {
      columns: asset.occupiedColumns,
      rows: asset.occupiedRows,
    },
    collider,
    colliders,
    warningArea,
    interactionArea,
    interactionIconContainer,
    zIndexRef: {
      offsetX: collider?.offsetX ?? 0,
      offsetY: asset.zIndexOffsetY,
      width: Math.max(48, collider ? collider.width * 0.45 : asset.frameWidth * 0.35),
      thickness: 2,
    },
  }
}

function createPlacedObjectTemplate(
  placement: PlacedRoomAsset,
  asset: RoomEditorAsset,
  availableAssets: RoomEditorAsset[],
  collidersEnabled = true,
): RoomObjectTemplate {
  const variant = createPlacedObjectVariant(placement, asset, collidersEnabled)
  const layerKind: Partial<Record<string, RoomObjectKind>> = {
    floor: 'floor',
    walls: 'wall',
    doors: 'door',
    'object-decoration': 'landmark',
    teleports: 'portal',
  }
  const interactionVariants = asset.interactionState === undefined
    ? undefined
    : availableAssets
        .filter((candidate) => (
          candidate.category === asset.category
          && candidate.name === asset.name
          && candidate.interactionState !== undefined
        ))
        .map((candidate) => createPlacedObjectVariant(placement, candidate, collidersEnabled))
  const { state: variantState, ...activeVariant } = variant

  return {
    id: `editor-object-${placement.layerId}-${placement.cellX}-${placement.cellY}`,
    kind: layerKind[placement.layerId] ?? getObjectKindFromAssetType(asset.category),
    opacity: asset.id === TELEPORT_EDITOR_ASSET_ID ? 0 : 1,
    flippedX: placement.flippedX,
    layerOrder: getEditorLayerPriority(placement.layerId),
    ...activeVariant,
    interactionState: asset.interactionState === undefined ? undefined : variantState,
    interactionVariants,
  }
}

function createPlacedTeleportTemplate(
  placement: PlacedRoomAsset,
  asset: RoomEditorAsset,
  collidersEnabled = true,
): RoomTeleportTemplate | null {
  if (placement.layerId !== 'teleports' || !placement.teleportTargetPath) {
    return null
  }

  const variant = createPlacedObjectVariant(placement, asset, collidersEnabled)
  const centerToBottomOffset = variant.height / 2
  const collider = variant.collider
    ? { ...variant.collider, offsetY: variant.collider.offsetY - centerToBottomOffset }
    : undefined
  const zIndexRef = variant.zIndexRef
    ? { ...variant.zIndexRef, offsetY: variant.zIndexRef.offsetY - centerToBottomOffset }
    : undefined
  const iconContainer = variant.interactionIconContainer

  return {
    entityType: 'teleport',
    id: `editor-teleport-${placement.cellX}-${placement.cellY}`,
    label: placement.name,
    x: variant.x,
    y: variant.y + centerToBottomOffset,
    width: variant.width,
    height: variant.height,
    fillColor: 0x496a73,
    strokeColor: 0xa8dcdf,
    opacity: placement.assetId === TELEPORT_EDITOR_ASSET_ID ? 0 : 1,
    spriteAssetId: placement.assetId === TELEPORT_EDITOR_ASSET_ID ? undefined : placement.assetId,
    collider,
    zIndexRef,
    warningArea: variant.warningArea
      ? { ...variant.warningArea, offsetY: variant.warningArea.offsetY - centerToBottomOffset }
      : undefined,
    interactionArea: variant.interactionArea
      ? { ...variant.interactionArea, offsetY: variant.interactionArea.offsetY - centerToBottomOffset }
      : undefined,
    iconWarningAssetIds: [
      'room-editor-pop-alert-0',
      'room-editor-pop-alert-1',
      'room-editor-pop-alert-2',
      'room-editor-pop-alert-3',
    ],
    iconInteractionAssetIds: [
      'room-editor-pop-interaction-0',
      'room-editor-pop-interaction-1',
    ],
    iconFrameDurationMs: 600,
    iconOffsetX: iconContainer?.offsetX ?? 0,
    iconOffsetY: (iconContainer?.offsetY ?? -129) - centerToBottomOffset,
    iconWidth: iconContainer?.width ?? 128,
    iconHeight: iconContainer?.height ?? 129,
    interactionId: `editor-teleport-${placement.cellX}-${placement.cellY}`,
    teleportTarget: { routePath: placement.teleportTargetPath },
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
  const [mapGridWidthInput, setMapGridWidthInput] = useState('10')
  const [mapGridHeightInput, setMapGridHeightInput] = useState('10')
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
  const [expandedLayerIds, setExpandedLayerIds] = useState<Set<string>>(() => new Set())
  const [renamingPlacementKey, setRenamingPlacementKey] = useState<string | null>(null)
  const [placementNameDraft, setPlacementNameDraft] = useState('')
  const [newLayerName, setNewLayerName] = useState('')
  const [assetCategories, setAssetCategories] = useState<RoomEditorAssetCategory[]>([])
  const [selectedAssetId, setSelectedAssetId] = useState<string | null>(null)
  const [placedAssets, setPlacedAssets] = useState<PlacedRoomAsset[]>([])
  const [isPaintToolActive, setIsPaintToolActive] = useState(false)
  const [isEraseToolActive, setIsEraseToolActive] = useState(false)
  const [isSelectToolActive, setIsSelectToolActive] = useState(true)
  const [isSpawnToolActive, setIsSpawnToolActive] = useState(false)
  const [isTestSpawnToolActive, setIsTestSpawnToolActive] = useState(false)
  const [spawnPoints, setSpawnPoints] = useState<RoomEditorSpawnPointData[]>([])
  const [selectedSpawnId, setSelectedSpawnId] = useState<string | null>(null)
  const [testSpawn, setTestSpawn] = useState<Position | null>(null)
  const [hoveredMapCell, setHoveredMapCell] = useState<MapCellPosition | null>(null)
  const [selectedMapArea, setSelectedMapArea] = useState<SelectedMapArea | null>(null)
  const [selectedPlacementKeys, setSelectedPlacementKeys] = useState<Set<string>>(() => new Set())
  const [draggedMapArea, setDraggedMapArea] = useState<MapCellArea | null>(null)
  const [isAssetFlippedX, setIsAssetFlippedX] = useState(false)
  const [isDebugEnabled, setIsDebugEnabled] = useState(false)
  const nextLayerIdRef = useRef(1)
  const columnGuidesRef = useRef<HTMLDivElement | null>(null)
  const rowGuidesRef = useRef<HTMLDivElement | null>(null)
  const canvasViewportRef = useRef<HTMLDivElement | null>(null)
  const mapScaleFrameRef = useRef<HTMLDivElement | null>(null)
  const placedAssetsRef = useRef<PlacedRoomAsset[]>([])
  const assetEditHistoryRef = useRef<PlacedRoomAsset[][]>([])
  const dragStartCellRef = useRef<MapCellPosition | null>(null)
  const cancelPlacementRenameRef = useRef(false)
  const hierarchySelectionAnchorRef = useRef<string | null>(null)
  const clearEditorSelection = useCallback(() => {
    setSelectedMapArea(null)
    setSelectedPlacementKeys(new Set())
    setSelectedSpawnId(null)
    hierarchySelectionAnchorRef.current = null
  }, [])

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
            setMapGridWidthInput(String(loadedMap.document.gridWidth))
            setMapGridHeightInput(String(loadedMap.document.gridHeight))
            const normalizedLayers = normalizeEditorLayers(loadedMap.document.layers)
            setLayers(normalizedLayers)
            setActiveLayerId(normalizedLayers[0]?.id ?? 'floor')
            setExpandedLayerIds(new Set())
            setRenamingPlacementKey(null)
            setPlacementNameDraft('')
            cancelPlacementRenameRef.current = false
            placedAssetsRef.current = loadedMap.document.placements
            setPlacedAssets(loadedMap.document.placements)
            setSpawnPoints(loadedMap.document.spawnPoints)
            assetEditHistoryRef.current = []
            clearEditorSelection()
            setTestSpawn(null)
            const highestCustomLayerId = normalizedLayers.reduce((highest, layer) => {
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
  }, [clearEditorSelection, onSessionChange])

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
    const placementKey = selectedMapArea?.placementKey
    if (!placementKey) {
      return
    }

    const frameId = window.requestAnimationFrame(() => {
      document
        .querySelector<HTMLElement>(`[data-editor-placement-key="${CSS.escape(placementKey)}"]`)
        ?.scrollIntoView({ block: 'nearest' })
    })

    return () => window.cancelAnimationFrame(frameId)
  }, [expandedLayerIds, selectedMapArea?.placementKey])

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
          setIsSpawnToolActive(false)
          clearEditorSelection()
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
          clearEditorSelection()
        }
        return
      }

      if ((key === 'delete' || key === 'backspace') && selectedSpawnId) {
        event.preventDefault()
        setSpawnPoints((currentSpawnPoints) => currentSpawnPoints.filter((spawnPoint) => (
          spawnPoint.id !== selectedSpawnId
        )))
        setMapPersistenceMessage('Spawn eliminado')
        clearEditorSelection()
        return
      }

      if (
        (key === 'delete' || key === 'backspace')
        && (selectedPlacementKeys.size > 0 || selectedMapArea)
      ) {
        event.preventDefault()
        const currentAssets = placedAssetsRef.current
        const nextAssets = selectedPlacementKeys.size > 0
          ? currentAssets.filter((asset) => !selectedPlacementKeys.has(getPlacedAssetKey(asset)))
          : currentAssets.filter((asset) => (
              !selectedMapArea
              || asset.layerId !== selectedMapArea.layerId
              || !isCellInsideArea(asset.cellX, asset.cellY, selectedMapArea)
            ))

        if (selectedPlacementKeys.size === 0 && selectedMapArea && !selectedMapArea.placementKey) {
          setSpawnPoints((currentSpawnPoints) => currentSpawnPoints.filter((spawnPoint) => (
            !isCellInsideArea(spawnPoint.cellX, spawnPoint.cellY, selectedMapArea)
          )))
        }

        if (nextAssets.length !== currentAssets.length) {
          assetEditHistoryRef.current.push(currentAssets)
          if (assetEditHistoryRef.current.length > MAX_EDIT_HISTORY) {
            assetEditHistoryRef.current.shift()
          }
          placedAssetsRef.current = nextAssets
          setPlacedAssets(nextAssets)
        }
        clearEditorSelection()
        return
      }

      if (key === 'escape') {
        setIsPaintToolActive(false)
        setIsEraseToolActive(false)
        setIsSelectToolActive(true)
        setIsSpawnToolActive(false)
        setIsTestSpawnToolActive(false)
        clearEditorSelection()
        setDraggedMapArea(null)
        dragStartCellRef.current = null
        return
      }

      if (key === 'w') {
        event.preventDefault()
        setIsPaintToolActive(true)
        setIsEraseToolActive(false)
        setIsSelectToolActive(false)
        setIsSpawnToolActive(false)
        setIsTestSpawnToolActive(false)
        clearEditorSelection()
        return
      }

      if (key === 'd') {
        event.preventDefault()
        setIsPaintToolActive(false)
        setIsEraseToolActive(true)
        setIsSelectToolActive(false)
        setIsSpawnToolActive(false)
        setIsTestSpawnToolActive(false)
        clearEditorSelection()
        return
      }

      if (key === 's') {
        event.preventDefault()
        setIsPaintToolActive(false)
        setIsEraseToolActive(false)
        setIsSelectToolActive(true)
        setIsSpawnToolActive(false)
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
  }, [clearEditorSelection, selectedAssetId, selectedMapArea, selectedPlacementKeys, selectedSpawnId, testSpawn])

  const placedAssetsByLayer = useMemo(() => {
    const groupedPlacements = new Map<string, PlacedRoomAsset[]>()

    placedAssets.forEach((placement) => {
      const layerPlacements = groupedPlacements.get(placement.layerId) ?? []
      layerPlacements.push(placement)
      groupedPlacements.set(placement.layerId, layerPlacements)
    })

    groupedPlacements.forEach((layerPlacements) => {
      layerPlacements.sort((left, right) => (
        left.cellY - right.cellY || left.cellX - right.cellX
      ))
    })

    return groupedPlacements
  }, [placedAssets])
  const visibleHierarchyPlacementKeys = useMemo(() => layers.flatMap((layer) => (
    layer.enabled && expandedLayerIds.has(layer.id)
      ? (placedAssetsByLayer.get(layer.id) ?? []).map(getPlacedAssetKey)
      : []
  )), [expandedLayerIds, layers, placedAssetsByLayer])
  const availableAssets = useMemo(
    () => [TELEPORT_EDITOR_ASSET, ...assetCategories.flatMap((category) => category.assets)],
    [assetCategories],
  )
  const assetById = useMemo(() => {
    const indexedAssets = new Map(availableAssets.map((asset) => [asset.id, asset]))
    availableAssets.forEach((asset) => {
      if (asset.interactionState === 0) {
        indexedAssets.set(asset.id.replace(/-S0$/i, ''), asset)
      }
    })
    return indexedAssets
  }, [availableAssets])
  const layerById = useMemo(
    () => new Map(layers.map((layer) => [layer.id, layer])),
    [layers],
  )
  const selectedPlacementAreas = useMemo(() => placedAssets.flatMap((placement) => {
    const placementKey = getPlacedAssetKey(placement)
    const layer = layerById.get(placement.layerId)
    if (!selectedPlacementKeys.has(placementKey) || layer?.enabled === false) {
      return []
    }

    return [getPlacementSelectionArea(placement, assetById.get(placement.assetId))]
  }), [assetById, layerById, placedAssets, selectedPlacementKeys])
  const selectedDetailPlacement = useMemo(() => {
    const primaryPlacementKey = selectedMapArea?.placementKey
      ?? Array.from(selectedPlacementKeys).at(-1)

    return primaryPlacementKey
      ? placedAssets.find((placement) => getPlacedAssetKey(placement) === primaryPlacementKey) ?? null
      : null
  }, [placedAssets, selectedMapArea?.placementKey, selectedPlacementKeys])
  const selectedDetailAsset = selectedDetailPlacement
    ? assetById.get(selectedDetailPlacement.assetId) ?? null
    : null
  const selectedDetailName = selectedDetailPlacement
    ? selectedDetailPlacement.name
      ?? formatAssetLabel(selectedDetailAsset?.name ?? selectedDetailPlacement.assetId)
    : null
  const selectedDetailColliders = selectedDetailPlacement
    ? selectedDetailPlacement.colliders ?? selectedDetailAsset?.colliders ?? []
    : []
  const selectedSpawnPoint = selectedSpawnId
    ? spawnPoints.find((spawnPoint) => spawnPoint.id === selectedSpawnId) ?? null
    : null
  const visiblePlacedAssets = useMemo(() => placedAssets
    .filter((placement) => layerById.get(placement.layerId)?.enabled !== false)
    .sort((left, right) => (
      getEditorLayerPriority(left.layerId) - getEditorLayerPriority(right.layerId)
    )), [layerById, placedAssets])
  const testObjects = useMemo(() => placedAssets.flatMap((placement) => {
    if (placement.layerId === 'teleports') return []

    const asset = assetById.get(placement.assetId)
    const layer = layerById.get(placement.layerId)
    return asset && layer?.enabled !== false
      ? [createPlacedObjectTemplate(placement, asset, availableAssets, layer?.collidersEnabled ?? true)]
      : []
  }), [assetById, availableAssets, layerById, placedAssets])
  const testTeleports = useMemo(() => placedAssets.flatMap((placement) => {
    if (placement.layerId !== 'teleports') return []

    const asset = assetById.get(placement.assetId)
    const layer = layerById.get(placement.layerId)
    if (!asset || layer?.enabled === false) return []

    const teleport = createPlacedTeleportTemplate(
      placement,
      asset,
      layer?.collidersEnabled ?? true,
    )
    return teleport ? [teleport] : []
  }), [assetById, layerById, placedAssets])

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
        : isSpawnToolActive
          ? 'ModoSpawn'
          : isTestSpawnToolActive
            ? 'ModoTest'
            : 'ModoSeleccionar'
  const activeLayerStatusLabel = activeLayer.enabled ? activeToolLabel : 'Deshabilitada'
  const selectedAsset = availableAssets.find((asset) => asset.id === selectedAssetId) ?? null
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
      marginX: 300,
      marginY: 300,
    },
    objects: testObjects,
    npcs: [],
    teleports: testTeleports,
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

  const updateGridSizeInput = (
    rawValue: string,
    inputSetter: (nextValue: string) => void,
    setter: (nextValue: number) => void,
  ) => {
    inputSetter(rawValue)

    if (rawValue.trim() === '') {
      return
    }

    const numericValue = Number(rawValue)
    if (!Number.isFinite(numericValue) || numericValue <= 0) {
      return
    }

    setter(Math.min(50, Math.max(1, Math.floor(numericValue))))
  }

  const commitGridSizeInput = (
    rawValue: string,
    inputSetter: (nextValue: string) => void,
    setter: (nextValue: number) => void,
  ) => {
    const numericValue = Number(rawValue)
    const nextValue = Number.isFinite(numericValue) && numericValue > 0
      ? Math.min(50, Math.max(1, Math.floor(numericValue)))
      : 1

    inputSetter(String(nextValue))
    setter(nextValue)
  }

  const updateZoom = (nextZoom: number) => {
    setMapZoom(Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, nextZoom)))
  }

  const keepGridGuidesVisible = (event: ReactUIEvent<HTMLDivElement>) => {
    const viewport = event.currentTarget
    const columnOffsetY = Math.max(0, viewport.scrollTop - 252)
    const rowOffsetX = Math.max(0, viewport.scrollLeft - 244)

    if (columnGuidesRef.current) {
      columnGuidesRef.current.style.transform = `translateY(${columnOffsetY}px)`
      columnGuidesRef.current.classList.toggle('is-anchored', columnOffsetY > 0)
    }
    if (rowGuidesRef.current) {
      rowGuidesRef.current.style.transform = `translateX(${rowOffsetX}px)`
      rowGuidesRef.current.classList.toggle('is-anchored', rowOffsetX > 0)
    }
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
          || asset.name !== nextAsset.name
          || asset.teleportTargetPath !== nextAsset.teleportTargetPath
          || !arePlacementCollidersEqual(asset.colliders, nextAsset.colliders)
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

  const updateSelectedDetailPlacement = (
    nextPlacement: PlacedRoomAsset,
    message: string,
  ) => {
    if (!selectedDetailPlacement) return

    const currentPlacementKey = getPlacedAssetKey(selectedDetailPlacement)
    const nextPlacementKey = getPlacedAssetKey(nextPlacement)
    commitPlacedAssetEdit((currentAssets) => currentAssets.map((placement) => (
      getPlacedAssetKey(placement) === currentPlacementKey ? nextPlacement : placement
    )))

    setSelectedPlacementKeys((currentKeys) => {
      if (!currentKeys.has(currentPlacementKey) || currentPlacementKey === nextPlacementKey) {
        return currentKeys
      }
      const nextKeys = new Set(currentKeys)
      nextKeys.delete(currentPlacementKey)
      nextKeys.add(nextPlacementKey)
      return nextKeys
    })
    setSelectedMapArea(getPlacementSelectionArea(nextPlacement, selectedDetailAsset ?? undefined))
    if (hierarchySelectionAnchorRef.current === currentPlacementKey) {
      hierarchySelectionAnchorRef.current = nextPlacementKey
    }
    setMapPersistenceMessage(message)
  }

  const commitSelectedDetailName = (rawValue: string) => {
    if (!selectedDetailPlacement) return ''

    const defaultName = formatAssetLabel(
      selectedDetailAsset?.name ?? selectedDetailPlacement.assetId,
    )
    const normalizedName = rawValue.trim().slice(0, 80)
    const nextName = normalizedName && normalizedName !== defaultName
      ? normalizedName
      : undefined

    updateSelectedDetailPlacement(
      { ...selectedDetailPlacement, name: nextName },
      nextName ? `Nombre actualizado · ${nextName}` : 'Nombre original restaurado',
    )
    return nextName ?? defaultName
  }

  const commitSelectedTeleportTargetPath = (rawValue: string) => {
    if (!selectedDetailPlacement || selectedDetailPlacement.layerId !== 'teleports') {
      return ''
    }

    const normalizedPath = normalizeTeleportTargetPath(rawValue)
    if (normalizedPath === null) {
      setMapPersistenceMessage('La URL del Teleport no es válida.')
      return selectedDetailPlacement.teleportTargetPath ?? ''
    }

    const nextPath = normalizedPath || undefined
    updateSelectedDetailPlacement(
      { ...selectedDetailPlacement, teleportTargetPath: nextPath },
      nextPath
        ? `Destino del Teleport actualizado · ${nextPath}`
        : 'Teleport sin URL de destino',
    )
    return normalizedPath
  }

  const commitSelectedDetailCoordinate = (axis: 'x' | 'y', rawValue: string) => {
    if (!selectedDetailPlacement) return 1

    const occupiedCells = axis === 'x'
      ? selectedDetailAsset?.occupiedColumns ?? 1
      : selectedDetailAsset?.occupiedRows ?? 1
    const gridCells = axis === 'x' ? mapGridWidth : mapGridHeight
    const currentCell = axis === 'x'
      ? selectedDetailPlacement.cellX
      : selectedDetailPlacement.cellY
    const maximumVisibleCell = Math.max(1, gridCells - occupiedCells + 1)
    const nextVisibleCell = normalizeEditorInteger(
      rawValue,
      1,
      maximumVisibleCell,
      currentCell + 1,
    )
    const nextCell = nextVisibleCell - 1
    const nextCellX = axis === 'x' ? nextCell : selectedDetailPlacement.cellX
    const nextCellY = axis === 'y' ? nextCell : selectedDetailPlacement.cellY
    const currentPlacementKey = getPlacedAssetKey(selectedDetailPlacement)
    const isOccupied = placedAssetsRef.current.some((placement) => (
      getPlacedAssetKey(placement) !== currentPlacementKey
      && placement.layerId === selectedDetailPlacement.layerId
      && placement.cellX === nextCellX
      && placement.cellY === nextCellY
    ))

    if (isOccupied) {
      setMapPersistenceMessage(
        `No se puede mover: la celda X${nextCellX + 1} Y${nextCellY + 1} ya está ocupada en esta capa`,
      )
      return currentCell + 1
    }

    updateSelectedDetailPlacement(
      {
        ...selectedDetailPlacement,
        cellX: nextCellX,
        cellY: nextCellY,
      },
      `Posición actualizada · X${nextCellX + 1} Y${nextCellY + 1}`,
    )
    return nextVisibleCell
  }

  const commitSelectedDetailColliderValue = (
    colliderIndex: number,
    field: keyof RoomEditorColliderData,
    rawValue: string,
  ) => {
    const currentCollider = selectedDetailColliders[colliderIndex]
    if (!selectedDetailPlacement || !currentCollider) return 0

    const isDimension = field === 'width' || field === 'height'
    const displayedCurrentValue = field === 'offsetX' && selectedDetailPlacement.flippedX
      ? -currentCollider.offsetX
      : currentCollider[field]
    const nextDisplayedValue = normalizeEditorInteger(
      rawValue,
      isDimension ? 1 : -4096,
      4096,
      displayedCurrentValue,
    )
    const nextStoredValue = field === 'offsetX' && selectedDetailPlacement.flippedX
      ? -nextDisplayedValue
      : nextDisplayedValue
    const nextColliders = selectedDetailColliders.map((collider, index) => (
      index === colliderIndex ? { ...collider, [field]: nextStoredValue } : { ...collider }
    ))

    updateSelectedDetailPlacement(
      { ...selectedDetailPlacement, colliders: nextColliders },
      `Collider ${colliderIndex + 1} actualizado`,
    )
    return nextDisplayedValue
  }

  const addSelectedDetailCollider = () => {
    if (
      !selectedDetailPlacement
      || !selectedDetailAsset
      || selectedDetailColliders.length >= 4
    ) {
      return
    }

    const nextColliders = [
      ...selectedDetailColliders.map((collider) => ({ ...collider })),
      {
        width: Math.min(128, selectedDetailAsset.frameWidth),
        height: Math.min(128, selectedDetailAsset.frameHeight),
        offsetX: 0,
        offsetY: 0,
      },
    ]
    updateSelectedDetailPlacement(
      { ...selectedDetailPlacement, colliders: nextColliders },
      `Collider ${nextColliders.length} agregado`,
    )
  }

  const removeSelectedDetailCollider = (colliderIndex: number) => {
    if (!selectedDetailPlacement || !selectedDetailColliders[colliderIndex]) return

    updateSelectedDetailPlacement(
      {
        ...selectedDetailPlacement,
        colliders: selectedDetailColliders
          .filter((_, index) => index !== colliderIndex)
          .map((collider) => ({ ...collider })),
      },
      `Collider ${colliderIndex + 1} eliminado`,
    )
  }

  const resetSelectedDetailColliders = () => {
    if (!selectedDetailPlacement || selectedDetailPlacement.colliders === undefined) return

    updateSelectedDetailPlacement(
      { ...selectedDetailPlacement, colliders: undefined },
      'Colliders restaurados desde el asset original',
    )
  }

  const updateSelectedSpawnPoint = (
    update: (spawnPoint: RoomEditorSpawnPointData) => RoomEditorSpawnPointData,
    message: string,
  ) => {
    if (!selectedSpawnPoint) return

    setSpawnPoints((currentSpawnPoints) => currentSpawnPoints.map((spawnPoint) => (
      spawnPoint.id === selectedSpawnPoint.id ? update(spawnPoint) : spawnPoint
    )))
    setMapPersistenceMessage(message)
  }

  const commitSelectedSpawnCoordinate = (axis: 'x' | 'y', rawValue: string) => {
    if (!selectedSpawnPoint) return 1

    const currentCell = axis === 'x' ? selectedSpawnPoint.cellX : selectedSpawnPoint.cellY
    const maximumCell = axis === 'x' ? mapGridWidth : mapGridHeight
    const nextVisibleCell = normalizeEditorInteger(
      rawValue,
      1,
      maximumCell,
      currentCell + 1,
    )
    const nextCell = nextVisibleCell - 1
    const nextCellX = axis === 'x' ? nextCell : selectedSpawnPoint.cellX
    const nextCellY = axis === 'y' ? nextCell : selectedSpawnPoint.cellY
    const overlapsAnotherSpawn = spawnPoints.some((spawnPoint) => (
      spawnPoint.id !== selectedSpawnPoint.id
      && spawnPoint.cellX === nextCellX
      && spawnPoint.cellY === nextCellY
    ))
    if (overlapsAnotherSpawn) {
      setMapPersistenceMessage('Esa celda ya contiene otro Spawn.')
      return currentCell + 1
    }

    updateSelectedSpawnPoint(
      (spawnPoint) => ({
        ...spawnPoint,
        cellX: axis === 'x' ? nextCell : spawnPoint.cellX,
        cellY: axis === 'y' ? nextCell : spawnPoint.cellY,
      }),
      `Spawn actualizado · ${axis.toUpperCase()}${nextVisibleCell}`,
    )
    return nextVisibleCell
  }

  const commitSelectedSpawnSourcePaths = (rawValue: string) => {
    if (!selectedSpawnPoint) return ''

    const normalizedPaths = parseSpawnSourcePaths(rawValue)
    if (normalizedPaths === null) {
      setMapPersistenceMessage('Una o más URLs de origen no son válidas.')
      return getSpawnSourcePaths(selectedSpawnPoint).join(';')
    }

    const duplicatedPath = normalizedPaths.find((path) => spawnPoints.some((spawnPoint) => (
      spawnPoint.id !== selectedSpawnPoint.id
      && getSpawnSourcePaths(spawnPoint).some((candidatePath) => (
        candidatePath.toLowerCase() === path.toLowerCase()
      ))
    )))
    if (duplicatedPath) {
      setMapPersistenceMessage(`La URL ${duplicatedPath} ya pertenece a otro Spawn.`)
      return getSpawnSourcePaths(selectedSpawnPoint).join(';')
    }

    updateSelectedSpawnPoint(
      (spawnPoint) => ({
        ...spawnPoint,
        entryKey: undefined,
        sourcePaths: normalizedPaths,
      }),
      normalizedPaths.length > 0
        ? `Orígenes del Spawn actualizados · ${normalizedPaths.join(';')}`
        : 'Spawn sin URLs de origen',
    )
    return normalizedPaths.join(';')
  }

  const deleteSelectedSpawnPoint = () => {
    if (!selectedSpawnPoint) return

    setSpawnPoints((currentSpawnPoints) => currentSpawnPoints.filter((spawnPoint) => (
      spawnPoint.id !== selectedSpawnPoint.id
    )))
    setMapPersistenceMessage('Spawn eliminado')
    clearEditorSelection()
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
      { id: layerId, name: layerName, enabled: true, collidersEnabled: true },
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
    setExpandedLayerIds((currentLayerIds) => {
      if (!currentLayerIds.has(layerId)) {
        return currentLayerIds
      }
      const nextLayerIds = new Set(currentLayerIds)
      nextLayerIds.delete(layerId)
      return nextLayerIds
    })
    if (
      selectedMapArea?.layerId === layerId
      || selectedPlacementAreas.some((area) => area.layerId === layerId)
    ) {
      clearEditorSelection()
    }
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

  const toggleLayerExpanded = (layerId: string) => {
    setExpandedLayerIds((currentLayerIds) => {
      const nextLayerIds = new Set(currentLayerIds)
      if (nextLayerIds.has(layerId)) {
        nextLayerIds.delete(layerId)
      } else {
        nextLayerIds.add(layerId)
      }
      return nextLayerIds
    })
  }

  const toggleLayerEnabled = (layerId: string) => {
    const layerToToggle = layers.find((layer) => layer.id === layerId)
    if (!layerToToggle) {
      return
    }

    const nextEnabled = !layerToToggle.enabled
    setLayers((currentLayers) => currentLayers.map((layer) => (
      layer.id === layerId
        ? { ...layer, enabled: nextEnabled }
        : layer
    )))
    clearEditorSelection()
    setHoveredMapCell(null)

    if (!nextEnabled && activeLayerId === layerId) {
      const nextActiveLayer = layers.find((layer) => layer.id !== layerId && layer.enabled)
      if (nextActiveLayer) {
        setActiveLayerId(nextActiveLayer.id)
      }
    }

    setMapPersistenceMessage(
      `Capa ${layerToToggle.name} ${nextEnabled ? 'habilitada' : 'deshabilitada'}`,
    )
  }

  const selectLayerPlacement = (
    placement: PlacedRoomAsset,
    modifiers: { toggle?: boolean; range?: boolean } = {},
  ) => {
    const layer = layerById.get(placement.layerId)
    if (layer?.enabled === false) {
      return
    }

    setSelectedSpawnId(null)
    setActiveLayerId(placement.layerId)
    setIsPaintToolActive(false)
    setIsEraseToolActive(false)
    setIsSelectToolActive(true)
    setIsSpawnToolActive(false)
    setIsTestSpawnToolActive(false)
    setExpandedLayerIds((currentLayerIds) => {
      if (currentLayerIds.has(placement.layerId)) {
        return currentLayerIds
      }
      const nextLayerIds = new Set(currentLayerIds)
      nextLayerIds.add(placement.layerId)
      return nextLayerIds
    })
    const asset = assetById.get(placement.assetId)
    const placementKey = getPlacedAssetKey(placement)
    const placementArea = getPlacementSelectionArea(placement, asset)
    const anchorKey = hierarchySelectionAnchorRef.current
    const anchorIndex = anchorKey
      ? visibleHierarchyPlacementKeys.indexOf(anchorKey)
      : -1
    const placementIndex = visibleHierarchyPlacementKeys.indexOf(placementKey)

    if (modifiers.range && anchorIndex >= 0 && placementIndex >= 0) {
      const rangeStart = Math.min(anchorIndex, placementIndex)
      const rangeEnd = Math.max(anchorIndex, placementIndex)
      const rangeKeys = visibleHierarchyPlacementKeys.slice(rangeStart, rangeEnd + 1)

      setSelectedPlacementKeys((currentKeys) => {
        const nextKeys = modifiers.toggle ? new Set(currentKeys) : new Set<string>()
        rangeKeys.forEach((key) => nextKeys.add(key))
        return nextKeys
      })
      setSelectedMapArea(placementArea)
    } else if (modifiers.toggle) {
      const nextKeys = new Set(selectedPlacementKeys)
      if (nextKeys.has(placementKey)) {
        nextKeys.delete(placementKey)
      } else {
        nextKeys.add(placementKey)
      }
      setSelectedPlacementKeys(nextKeys)

      if (nextKeys.has(placementKey)) {
        setSelectedMapArea(placementArea)
        hierarchySelectionAnchorRef.current = placementKey
      } else {
        const nextPrimaryKey = Array.from(nextKeys).at(-1) ?? null
        const nextPrimaryPlacement = nextPrimaryKey
          ? placedAssetsRef.current.find((currentPlacement) => (
              getPlacedAssetKey(currentPlacement) === nextPrimaryKey
            ))
          : undefined

        setSelectedMapArea(nextPrimaryPlacement
          ? getPlacementSelectionArea(
              nextPrimaryPlacement,
              assetById.get(nextPrimaryPlacement.assetId),
            )
          : null)
        hierarchySelectionAnchorRef.current = nextPrimaryKey
      }
    } else {
      setSelectedPlacementKeys(new Set([placementKey]))
      setSelectedMapArea(placementArea)
      hierarchySelectionAnchorRef.current = placementKey
    }
    setHoveredMapCell(null)

    window.requestAnimationFrame(() => {
      const viewport = canvasViewportRef.current
      const mapFrame = mapScaleFrameRef.current
      if (!viewport || !mapFrame) {
        return
      }

      const occupiedColumns = asset?.occupiedColumns ?? 1
      const occupiedRows = asset?.occupiedRows ?? 1
      const placementCenterX = (placement.cellX * 128 + occupiedColumns * 64) * mapZoom
      const placementCenterY = (placement.cellY * 128 + occupiedRows * 64) * mapZoom
      viewport.scrollTo({
        left: Math.max(0, mapFrame.offsetLeft + placementCenterX - viewport.clientWidth / 2),
        top: Math.max(0, mapFrame.offsetTop + placementCenterY - viewport.clientHeight / 2),
        behavior: 'smooth',
      })
    })
  }

  const startRenamingPlacement = (placement: PlacedRoomAsset, defaultName: string) => {
    if (layerById.get(placement.layerId)?.enabled === false) {
      return
    }

    selectLayerPlacement(placement)
    cancelPlacementRenameRef.current = false
    setRenamingPlacementKey(getPlacedAssetKey(placement))
    setPlacementNameDraft(placement.name ?? defaultName)
  }

  const finishRenamingPlacement = (placement: PlacedRoomAsset, defaultName: string) => {
    if (cancelPlacementRenameRef.current) {
      cancelPlacementRenameRef.current = false
      setRenamingPlacementKey(null)
      setPlacementNameDraft('')
      return
    }

    const normalizedName = placementNameDraft.trim()
    const nextName = normalizedName && normalizedName !== defaultName
      ? normalizedName
      : undefined

    commitPlacedAssetEdit((currentAssets) => currentAssets.map((currentPlacement) => (
      getPlacedAssetKey(currentPlacement) === getPlacedAssetKey(placement)
        ? { ...currentPlacement, name: nextName }
        : currentPlacement
    )))
    setRenamingPlacementKey(null)
    setPlacementNameDraft('')
    setMapPersistenceMessage(nextName
      ? `Elemento renombrado como ${nextName}`
      : 'Se restauró el nombre original del elemento')
  }

  const cancelRenamingPlacement = () => {
    cancelPlacementRenameRef.current = true
    setRenamingPlacementKey(null)
    setPlacementNameDraft('')
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

  const selectPlacementAtCell = (cell: MapCellPosition) => {
    setSelectedSpawnId(null)
    const candidates: Array<{
      placement: PlacedRoomAsset
      asset: RoomEditorAsset
      placementIndex: number
    }> = []

    placedAssetsRef.current.forEach((placement, placementIndex) => {
      const layer = layerById.get(placement.layerId)
      const asset = assetById.get(placement.assetId)
      if (
        layer?.enabled === true
        && asset
        && isCellInsideArea(cell.x, cell.y, getPlacementFootprintArea(placement, asset))
      ) {
        candidates.push({ placement, asset, placementIndex })
      }
    })

    candidates.sort((left, right) => (
      getEditorLayerPriority(right.placement.layerId)
      - getEditorLayerPriority(left.placement.layerId)
      || right.placementIndex - left.placementIndex
    ))

    if (candidates.length === 0) {
      setSelectedPlacementKeys(new Set())
      hierarchySelectionAnchorRef.current = null
      setSelectedMapArea({
        layerId: activeLayer.id,
        startX: cell.x,
        startY: cell.y,
        endX: cell.x,
        endY: cell.y,
        sourceCellX: cell.x,
        sourceCellY: cell.y,
      })
      return
    }

    const isSameCell = selectedMapArea?.sourceCellX === cell.x
      && selectedMapArea.sourceCellY === cell.y
    const selectedCandidateIndex = isSameCell && selectedMapArea?.placementKey
      ? candidates.findIndex(({ placement }) => (
          getPlacedAssetKey(placement) === selectedMapArea.placementKey
        ))
      : -1
    const nextCandidate = candidates[(selectedCandidateIndex + 1) % candidates.length]
    const { placement, asset } = nextCandidate

    setActiveLayerId(placement.layerId)
    setExpandedLayerIds((currentLayerIds) => {
      if (currentLayerIds.has(placement.layerId)) {
        return currentLayerIds
      }
      const nextLayerIds = new Set(currentLayerIds)
      nextLayerIds.add(placement.layerId)
      return nextLayerIds
    })
    const placementKey = getPlacedAssetKey(placement)
    setSelectedPlacementKeys(new Set([placementKey]))
    hierarchySelectionAnchorRef.current = placementKey
    setSelectedMapArea({
      layerId: placement.layerId,
      placementKey,
      sourceCellX: cell.x,
      sourceCellY: cell.y,
      ...getPlacementFootprintArea(placement, asset),
    })
  }

  const applyMapAreaEdit = (area: MapCellArea) => {
    if (!activeLayer.enabled && (isEraseToolActive || isPaintToolActive)) {
      setMapPersistenceMessage(`Habilita la capa ${activeLayer.name} para editarla`)
      return
    }

    if (isSelectToolActive) {
      const isSingleCell = area.startX === area.endX && area.startY === area.endY
      if (isSingleCell) {
        selectPlacementAtCell({ x: area.startX, y: area.startY })
      } else {
        setSelectedPlacementKeys(new Set())
        hierarchySelectionAnchorRef.current = null
        setSelectedMapArea({
          layerId: activeLayer.id,
          ...area,
        })
      }
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

    if (isSpawnToolActive) {
      const existingSpawn = spawnPoints.find((spawnPoint) => (
        spawnPoint.cellX === area.endX && spawnPoint.cellY === area.endY
      ))
      if (existingSpawn) {
        setSelectedSpawnId(existingSpawn.id)
        setMapPersistenceMessage('Ese punto ya contiene un Spawn')
        return
      }
      if (spawnPoints.length >= 20) {
        setMapPersistenceMessage('La escena admite un máximo de 20 Spawns')
        return
      }

      const spawnPoint: RoomEditorSpawnPointData = {
        id: createSpawnPointId(spawnPoints),
        cellX: area.endX,
        cellY: area.endY,
        sourcePaths: spawnPoints.length === 0 ? ['/all'] : [],
      }
      setSpawnPoints((currentSpawnPoints) => [...currentSpawnPoints, spawnPoint])
      setSelectedMapArea(null)
      setSelectedPlacementKeys(new Set())
      hierarchySelectionAnchorRef.current = null
      setSelectedSpawnId(spawnPoint.id)
      setMapPersistenceMessage(
        spawnPoints.length === 0
          ? 'Spawn general asignado a /all'
          : 'Spawn agregado · configura sus URLs de origen en Detalles',
      )
      return
    }

    if (isEraseToolActive) {
      if (
        selectedSpawnPoint
        && isCellInsideArea(selectedSpawnPoint.cellX, selectedSpawnPoint.cellY, area)
      ) {
        setSelectedSpawnId(null)
      }
      setSpawnPoints((currentSpawnPoints) => currentSpawnPoints.filter((spawnPoint) => (
        !isCellInsideArea(spawnPoint.cellX, spawnPoint.cellY, area)
      )))
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
      || (!isPaintToolActive && !isEraseToolActive && !isSelectToolActive && !isSpawnToolActive && !isTestSpawnToolActive)
    ) {
      return
    }

    event.preventDefault()
    const startCell = getMapCellFromPointer(event)
    dragStartCellRef.current = startCell
    setDraggedMapArea(getNormalizedCellArea(startCell, startCell))
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
    const asset = assetById.get(placement.assetId)
    if (!asset) {
      return null
    }

    const layer = layerById.get(placement.layerId)
    if (layer?.enabled === false) {
      return null
    }
    const objectTemplate = createPlacedObjectTemplate(
      placement,
      asset,
      availableAssets,
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
          placements: placedAssetsRef.current.map((placement) => ({
            ...placement,
            assetId: assetById.get(placement.assetId)?.id ?? placement.assetId,
          })),
          spawnPoints,
          assets: availableAssets.map((asset) => ({
            id: asset.id,
            category: asset.category,
            frameWidth: asset.frameWidth,
            frameHeight: asset.frameHeight,
            occupiedColumns: asset.occupiedColumns,
            occupiedRows: asset.occupiedRows,
            colliders: asset.colliders,
            zIndexOffsetY: asset.zIndexOffsetY,
            warningArea: asset.warningArea,
            interactionArea: asset.interactionArea,
            interactionIconContainer: asset.interactionIconContainer,
            interactionState: asset.interactionState,
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
              value={mapGridWidthInput}
              onChange={(event) => updateGridSizeInput(
                event.target.value,
                setMapGridWidthInput,
                setMapGridWidth,
              )}
              onBlur={(event) => commitGridSizeInput(
                event.target.value,
                setMapGridWidthInput,
                setMapGridWidth,
              )}
              onKeyDown={(event) => {
                if (event.key === 'Enter') event.currentTarget.blur()
              }}
            />
          </label>
          <label htmlFor="edit-room-grid-y">
            <span>Y</span>
            <input
              id="edit-room-grid-y"
              type="number"
              min="1"
              max="50"
              value={mapGridHeightInput}
              onChange={(event) => updateGridSizeInput(
                event.target.value,
                setMapGridHeightInput,
                setMapGridHeight,
              )}
              onBlur={(event) => commitGridSizeInput(
                event.target.value,
                setMapGridHeightInput,
                setMapGridHeight,
              )}
              onKeyDown={(event) => {
                if (event.key === 'Enter') event.currentTarget.blur()
              }}
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
          <output
            className="edit-room-save-status"
            aria-live="polite"
            title={mapPersistenceMessage}
          >
            {mapPersistenceMessage}
          </output>
        </section>

        <div className="edit-room-toolbar-spacer" />
        <span className="edit-room-role-chip">{resolvedProfile?.role}</span>
        <button type="button" className="edit-room-exit-button" onClick={() => navigateInApp('/Editor')}>
          Salir
        </button>
      </header>

      <section className="edit-room-layout">
        <aside className="edit-room-inspector-sidebar" aria-label="Assets y detalles">
          <section className="edit-room-panel edit-room-details-panel" aria-label="Detalles de la selección">
            <header>
              <span>Detalles</span>
              {selectedPlacementKeys.size > 1 ? (
                <output>{selectedPlacementKeys.size} seleccionados</output>
              ) : selectedSpawnPoint ? (
                <output>Spawn</output>
              ) : null}
            </header>
            <div
              className="edit-room-panel-body edit-room-details-body"
              style={selectedDetailPlacement
                ? getEditorLayerColorStyle(selectedDetailPlacement.layerId)
                : selectedSpawnPoint
                  ? ({ '--edit-room-layer-color': '#68e7de' } as CSSProperties)
                  : undefined}
            >
              {selectedDetailPlacement ? (
                <div
                  key={`${getPlacedAssetKey(selectedDetailPlacement)}-${selectedDetailPlacement.name ?? 'default'}-${selectedDetailPlacement.teleportTargetPath ?? 'no-target'}`}
                  className="edit-room-details-content"
                >
                  <dl className="edit-room-details-fields">
                    <div className="edit-room-details-field is-name">
                      <dt>Nombre</dt>
                      <dd>
                        <input
                          type="text"
                          className="edit-room-details-input"
                          defaultValue={selectedDetailName ?? ''}
                          maxLength={80}
                          aria-label="Nombre del elemento"
                          onBlur={(event) => {
                            event.currentTarget.value = commitSelectedDetailName(event.currentTarget.value)
                          }}
                          onKeyDown={(event) => {
                            if (event.key === 'Enter') {
                              event.preventDefault()
                              event.currentTarget.blur()
                            } else if (event.key === 'Escape') {
                              event.preventDefault()
                              event.currentTarget.value = selectedDetailName ?? ''
                              event.currentTarget.blur()
                            }
                          }}
                        />
                      </dd>
                    </div>
                    {selectedDetailPlacement.layerId === 'teleports' ? (
                      <div className="edit-room-details-field is-name is-teleport-url">
                        <dt>URL de destino</dt>
                        <dd>
                          <input
                            type="text"
                            className="edit-room-details-input"
                            defaultValue={selectedDetailPlacement.teleportTargetPath ?? ''}
                            maxLength={512}
                            placeholder="/Tavern o URL de una sala"
                            aria-label="URL de destino del Teleport"
                            onBlur={(event) => {
                              event.currentTarget.value = commitSelectedTeleportTargetPath(
                                event.currentTarget.value,
                              )
                            }}
                            onKeyDown={(event) => {
                              if (event.key === 'Enter') {
                                event.preventDefault()
                                event.currentTarget.blur()
                              } else if (event.key === 'Escape') {
                                event.preventDefault()
                                event.currentTarget.value = selectedDetailPlacement.teleportTargetPath ?? ''
                                event.currentTarget.blur()
                              }
                            }}
                          />
                        </dd>
                      </div>
                    ) : null}
                    <div className="edit-room-details-field">
                      <dt>Posición X</dt>
                      <dd>
                        <input
                          type="number"
                          className="edit-room-details-input"
                          min="1"
                          max={Math.max(
                            1,
                            mapGridWidth - (selectedDetailAsset?.occupiedColumns ?? 1) + 1,
                          )}
                          defaultValue={selectedDetailPlacement.cellX + 1}
                          aria-label="Posición X del elemento"
                          onBlur={(event) => {
                            event.currentTarget.value = String(
                              commitSelectedDetailCoordinate('x', event.currentTarget.value),
                            )
                          }}
                          onKeyDown={(event) => {
                            if (event.key === 'Enter') {
                              event.preventDefault()
                              event.currentTarget.blur()
                            } else if (event.key === 'Escape') {
                              event.preventDefault()
                              event.currentTarget.value = String(selectedDetailPlacement.cellX + 1)
                              event.currentTarget.blur()
                            }
                          }}
                        />
                      </dd>
                    </div>
                    <div className="edit-room-details-field">
                      <dt>Posición Y</dt>
                      <dd>
                        <input
                          type="number"
                          className="edit-room-details-input"
                          min="1"
                          max={Math.max(
                            1,
                            mapGridHeight - (selectedDetailAsset?.occupiedRows ?? 1) + 1,
                          )}
                          defaultValue={selectedDetailPlacement.cellY + 1}
                          aria-label="Posición Y del elemento"
                          onBlur={(event) => {
                            event.currentTarget.value = String(
                              commitSelectedDetailCoordinate('y', event.currentTarget.value),
                            )
                          }}
                          onKeyDown={(event) => {
                            if (event.key === 'Enter') {
                              event.preventDefault()
                              event.currentTarget.blur()
                            } else if (event.key === 'Escape') {
                              event.preventDefault()
                              event.currentTarget.value = String(selectedDetailPlacement.cellY + 1)
                              event.currentTarget.blur()
                            }
                          }}
                        />
                      </dd>
                    </div>
                  </dl>

                  <section className="edit-room-details-colliders" aria-label="Dimensiones de los colliders">
                    <header>
                      <strong>Colliders</strong>
                      <div className="edit-room-details-collider-actions">
                        <output>{selectedDetailColliders.length} / 4</output>
                        {selectedDetailPlacement.colliders !== undefined ? (
                          <button
                            type="button"
                            aria-label="Restaurar colliders originales"
                            title="Restaurar colliders originales"
                            onClick={resetSelectedDetailColliders}
                          >
                            ↺
                          </button>
                        ) : null}
                        <button
                          type="button"
                          aria-label="Agregar collider"
                          title="Agregar collider"
                          disabled={!selectedDetailAsset || selectedDetailColliders.length >= 4}
                          onClick={addSelectedDetailCollider}
                        >
                          +
                        </button>
                      </div>
                    </header>
                    {selectedDetailColliders.length > 0 ? (
                      <div className="edit-room-details-collider-list">
                        {selectedDetailColliders.map((collider, colliderIndex) => (
                          <article
                            key={`${collider.width}-${collider.height}-${collider.offsetX}-${collider.offsetY}-${colliderIndex}`}
                            className="edit-room-details-collider"
                          >
                            <header>
                              <strong>Collider {colliderIndex + 1}</strong>
                              <button
                                type="button"
                                aria-label={`Eliminar collider ${colliderIndex + 1}`}
                                title={`Eliminar collider ${colliderIndex + 1}`}
                                onClick={() => removeSelectedDetailCollider(colliderIndex)}
                              >
                                ×
                              </button>
                            </header>
                            <div className="edit-room-details-collider-fields">
                              {([
                                ['width', 'Ancho', collider.width],
                                ['height', 'Alto', collider.height],
                                [
                                  'offsetX',
                                  'Offset X',
                                  selectedDetailPlacement.flippedX
                                    ? -collider.offsetX
                                    : collider.offsetX,
                                ],
                                ['offsetY', 'Offset Y', collider.offsetY],
                              ] as const).map(([field, label, displayedValue]) => (
                                <label key={field}>
                                  <span>{label}</span>
                                  <input
                                    type="number"
                                    min={field === 'width' || field === 'height' ? 1 : -4096}
                                    max="4096"
                                    defaultValue={displayedValue}
                                    aria-label={`${label} del collider ${colliderIndex + 1}`}
                                    onBlur={(event) => {
                                      event.currentTarget.value = String(
                                        commitSelectedDetailColliderValue(
                                          colliderIndex,
                                          field,
                                          event.currentTarget.value,
                                        ),
                                      )
                                    }}
                                    onKeyDown={(event) => {
                                      if (event.key === 'Enter') {
                                        event.preventDefault()
                                        event.currentTarget.blur()
                                      } else if (event.key === 'Escape') {
                                        event.preventDefault()
                                        event.currentTarget.value = String(displayedValue)
                                        event.currentTarget.blur()
                                      }
                                    }}
                                  />
                                </label>
                              ))}
                            </div>
                          </article>
                        ))}
                      </div>
                    ) : (
                      <p className="edit-room-details-empty-collider">Sin collider</p>
                    )}
                  </section>
                </div>
              ) : selectedSpawnPoint ? (
                <div
                  key={`${selectedSpawnPoint.id}-${selectedSpawnPoint.cellX}-${selectedSpawnPoint.cellY}-${getSpawnSourcePaths(selectedSpawnPoint).join(';')}`}
                  className="edit-room-details-content edit-room-spawn-details"
                >
                  <dl className="edit-room-details-fields">
                    <div className="edit-room-details-field is-name">
                      <dt>Salas de origen</dt>
                      <dd>
                        <input
                          type="text"
                          className="edit-room-details-input"
                          defaultValue={getSpawnSourcePaths(selectedSpawnPoint).join(';')}
                          maxLength={2048}
                          placeholder="/all;/SmallRoom;/castle"
                          aria-label="URLs de origen del Spawn"
                          onBlur={(event) => {
                            event.currentTarget.value = commitSelectedSpawnSourcePaths(
                              event.currentTarget.value,
                            )
                          }}
                          onKeyDown={(event) => {
                            if (event.key === 'Enter') {
                              event.preventDefault()
                              event.currentTarget.blur()
                            } else if (event.key === 'Escape') {
                              event.preventDefault()
                              event.currentTarget.value = getSpawnSourcePaths(selectedSpawnPoint).join(';')
                              event.currentTarget.blur()
                            }
                          }}
                        />
                      </dd>
                    </div>
                    <div className="edit-room-details-field">
                      <dt>Posición X</dt>
                      <dd>
                        <input
                          type="number"
                          className="edit-room-details-input"
                          min="1"
                          max={mapGridWidth}
                          defaultValue={selectedSpawnPoint.cellX + 1}
                          aria-label="Posición X del Spawn"
                          onBlur={(event) => {
                            event.currentTarget.value = String(
                              commitSelectedSpawnCoordinate('x', event.currentTarget.value),
                            )
                          }}
                          onKeyDown={(event) => {
                            if (event.key === 'Enter') {
                              event.preventDefault()
                              event.currentTarget.blur()
                            } else if (event.key === 'Escape') {
                              event.preventDefault()
                              event.currentTarget.value = String(selectedSpawnPoint.cellX + 1)
                              event.currentTarget.blur()
                            }
                          }}
                        />
                      </dd>
                    </div>
                    <div className="edit-room-details-field">
                      <dt>Posición Y</dt>
                      <dd>
                        <input
                          type="number"
                          className="edit-room-details-input"
                          min="1"
                          max={mapGridHeight}
                          defaultValue={selectedSpawnPoint.cellY + 1}
                          aria-label="Posición Y del Spawn"
                          onBlur={(event) => {
                            event.currentTarget.value = String(
                              commitSelectedSpawnCoordinate('y', event.currentTarget.value),
                            )
                          }}
                          onKeyDown={(event) => {
                            if (event.key === 'Enter') {
                              event.preventDefault()
                              event.currentTarget.blur()
                            } else if (event.key === 'Escape') {
                              event.preventDefault()
                              event.currentTarget.value = String(selectedSpawnPoint.cellY + 1)
                              event.currentTarget.blur()
                            }
                          }}
                        />
                      </dd>
                    </div>
                  </dl>

                  <p className="edit-room-spawn-rule">
                    Separa las rutas con ;. Una coincidencia exacta tiene prioridad sobre /all.
                  </p>
                  <button
                    type="button"
                    className="edit-room-spawn-delete"
                    onClick={deleteSelectedSpawnPoint}
                  >
                    Eliminar Spawn
                  </button>
                </div>
              ) : (
                <p className="edit-room-details-empty">Selecciona un elemento para ver sus detalles.</p>
              )}
            </div>
          </section>

          <section className="edit-room-panel edit-room-assets-panel" aria-label="Assets por categoría">
            <header>
              <span>Assets</span>
              <output>{assetCategories.reduce((total, category) => total + category.assets.length, 2)}</output>
            </header>
            <div className="edit-room-panel-body edit-room-assets-body">
            <details className="edit-room-asset-collection" open>
              <summary>
                <span>Componentes</span>
                <output>2</output>
              </summary>
              <div className="edit-room-asset-grid">
                <button
                  type="button"
                  className={`edit-room-asset-tile edit-room-spawn-asset${isSpawnToolActive ? ' is-selected' : ''}`}
                  aria-label="Asignar punto de aparición de jugadores"
                  aria-pressed={isSpawnToolActive}
                  title="Spawns de jugadores · máximo 20 por escena"
                  onClick={() => {
                    setSelectedAssetId(null)
                    setIsSpawnToolActive(true)
                    setIsPaintToolActive(false)
                    setIsEraseToolActive(false)
                    setIsSelectToolActive(false)
                    setIsTestSpawnToolActive(false)
                    clearEditorSelection()
                  }}
                >
                  <span className="edit-room-asset-preview edit-room-spawn-preview" aria-hidden="true" />
                  <span className="edit-room-asset-name">Spawn</span>
                  <span className="edit-room-asset-size">
                    {spawnPoints.length} ubicados · máximo 20
                  </span>
                </button>
                <button
                  type="button"
                  className={`edit-room-asset-tile edit-room-teleport-asset${selectedAssetId === TELEPORT_EDITOR_ASSET_ID ? ' is-selected' : ''}`}
                  aria-label="Agregar Teleport hacia otra sala"
                  aria-pressed={selectedAssetId === TELEPORT_EDITOR_ASSET_ID && isPaintToolActive}
                  title="Teleport · permite viajar hacia la URL configurada"
                  onClick={() => {
                    setSelectedAssetId(TELEPORT_EDITOR_ASSET_ID)
                    setActiveLayerId('teleports')
                    setExpandedLayerIds((currentLayerIds) => new Set(currentLayerIds).add('teleports'))
                    setIsPaintToolActive(true)
                    setIsEraseToolActive(false)
                    setIsSelectToolActive(false)
                    setIsSpawnToolActive(false)
                    setIsTestSpawnToolActive(false)
                    clearEditorSelection()
                  }}
                >
                  <span className="edit-room-asset-preview edit-room-teleport-preview" aria-hidden="true" />
                  <span className="edit-room-asset-name">Teleport</span>
                  <span className="edit-room-asset-size">1×1 celda · múltiples por sala</span>
                </button>
              </div>
            </details>
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
                          setIsSpawnToolActive(false)
                          setIsTestSpawnToolActive(false)
                          clearEditorSelection()
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
                          {asset.interactionState === undefined
                            ? ''
                            : ` · S${asset.interactionState} ${asset.interactionState === 0 ? 'cerrado' : 'abierto'}`}
                        </span>
                      </button>
                    )
                  })}
                </div>
              </details>
            ))}
            </div>
          </section>
        </aside>

        <section className="edit-room-workspace" aria-label="Área de trabajo">
          <div
            className="edit-room-active-layer-badge"
            style={getEditorLayerColorStyle(activeLayer.id)}
          >
            <strong>{activeLayer.name} : {activeLayerStatusLabel}</strong>
          </div>
          <div
            ref={canvasViewportRef}
            className="edit-room-canvas-viewport"
            onScroll={keepGridGuidesVisible}
          >
            <div className="edit-room-canvas-stage">
              <div
                ref={mapScaleFrameRef}
                className="edit-room-map-scale-frame"
                style={{
                  width: `${scaledMapWidthPx}px`,
                  height: `${scaledMapHeightPx}px`,
                }}
              >
                <div
                  ref={columnGuidesRef}
                  className="edit-room-column-guides"
                  style={{
                    gridTemplateColumns: `repeat(${mapGridWidth}, ${128 * mapZoom}px)`,
                  }}
                  aria-hidden="true"
                >
                  {Array.from({ length: mapGridWidth }, (_, columnIndex) => (
                    <span key={columnIndex}>{columnIndex + 1}</span>
                  ))}
                </div>
                <div
                  ref={rowGuidesRef}
                  className="edit-room-row-guides"
                  style={{
                    gridTemplateRows: `repeat(${mapGridHeight}, ${128 * mapZoom}px)`,
                  }}
                  aria-hidden="true"
                >
                  {Array.from({ length: mapGridHeight }, (_, rowIndex) => (
                    <span key={rowIndex}>{rowIndex + 1}</span>
                  ))}
                </div>
                <div
                  className={`edit-room-map-canvas${isPaintToolActive ? ' is-painting' : ''}${isEraseToolActive ? ' is-erasing' : ''}${isSelectToolActive ? ' is-selecting' : ''}${isSpawnToolActive ? ' is-placing-spawn' : ''}${isTestSpawnToolActive ? ' is-testing-spawn' : ''}`}
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
                    if (isPaintToolActive || isEraseToolActive || isSelectToolActive || isSpawnToolActive || isTestSpawnToolActive) {
                      event.preventDefault()
                      setIsPaintToolActive(false)
                      setIsEraseToolActive(false)
                      setIsSelectToolActive(true)
                      setIsSpawnToolActive(false)
                      setIsTestSpawnToolActive(false)
                      clearEditorSelection()
                      cancelMapDrag()
                    }
                  }}
                >
                  {visiblePlacedAssets.map(renderPlacedAsset)}
                  <span className="edit-room-grid-guide-overlay" aria-hidden="true" />
                  {spawnPoints.map((spawnPoint) => (
                    <button
                      type="button"
                      key={spawnPoint.id}
                      className={`edit-room-spawn-marker${selectedSpawnId === spawnPoint.id ? ' is-selected' : ''}`}
                      style={{
                        left: `${spawnPoint.cellX * 128}px`,
                        top: `${spawnPoint.cellY * 128}px`,
                        pointerEvents: isSelectToolActive ? 'auto' : 'none',
                      }}
                      aria-label={`Seleccionar Spawn en X${spawnPoint.cellX + 1} Y${spawnPoint.cellY + 1}`}
                      aria-pressed={selectedSpawnId === spawnPoint.id}
                      title={`Spawn · ${getSpawnSourcePaths(spawnPoint).join(';') || 'sin URLs de origen'}`}
                      onPointerDown={(event) => event.stopPropagation()}
                      onClick={(event) => {
                        event.stopPropagation()
                        setIsPaintToolActive(false)
                        setIsEraseToolActive(false)
                        setIsSelectToolActive(true)
                        setIsSpawnToolActive(false)
                        setIsTestSpawnToolActive(false)
                        setSelectedMapArea(null)
                        setSelectedPlacementKeys(new Set())
                        hierarchySelectionAnchorRef.current = null
                        setSelectedSpawnId(spawnPoint.id)
                      }}
                    />
                  ))}
                  {isSpawnToolActive && hoveredMapCell ? (
                    <span
                      className="edit-room-cell-tool-preview is-spawn"
                      style={{
                        left: `${hoveredMapCell.x * 128}px`,
                        top: `${hoveredMapCell.y * 128}px`,
                      }}
                      aria-hidden="true"
                    />
                  ) : null}
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
                  {selectedPlacementAreas.map((area) => (
                    <span
                      key={`selected-${area.placementKey}`}
                      className="edit-room-cell-tool-preview is-select"
                      style={{
                        ...getEditorLayerColorStyle(area.layerId),
                        left: `${area.startX * 128}px`,
                        top: `${area.startY * 128}px`,
                        width: `${(area.endX - area.startX + 1) * 128}px`,
                        height: `${(area.endY - area.startY + 1) * 128}px`,
                      }}
                      aria-hidden="true"
                    />
                  ))}
                  {selectedMapArea
                    && !selectedMapArea.placementKey
                    && selectedMapArea.layerId === activeLayer.id ? (
                      <span
                        className="edit-room-cell-tool-preview is-select"
                        style={{
                          ...getEditorLayerColorStyle(selectedMapArea.layerId),
                          left: `${selectedMapArea.startX * 128}px`,
                          top: `${selectedMapArea.startY * 128}px`,
                          width: `${(selectedMapArea.endX - selectedMapArea.startX + 1) * 128}px`,
                          height: `${(selectedMapArea.endY - selectedMapArea.startY + 1) * 128}px`,
                        }}
                        aria-hidden="true"
                      />
                    ) : null}
                  {activeLayer.enabled && isSelectToolActive && draggedMapArea ? (
                    <span
                      className="edit-room-cell-tool-preview is-select"
                      style={{
                        ...getEditorLayerColorStyle(activeLayer.id),
                        left: `${draggedMapArea.startX * 128}px`,
                        top: `${draggedMapArea.startY * 128}px`,
                        width: `${(draggedMapArea.endX - draggedMapArea.startX + 1) * 128}px`,
                        height: `${(draggedMapArea.endY - draggedMapArea.startY + 1) * 128}px`,
                      }}
                      aria-hidden="true"
                    />
                  ) : null}
                  {activeLayer.enabled && isEraseToolActive && (draggedMapArea || hoveredMapCell) ? (
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
                  {activeLayer.enabled && isPaintToolActive && selectedAsset && (draggedMapArea || hoveredMapCell) ? (
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
                      {!draggedMapArea && selectedAsset.id !== TELEPORT_EDITOR_ASSET_ID ? (
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
                        : isSpawnToolActive
                          ? 'Asignar spawn'
                          : isTestSpawnToolActive
                            ? 'Elegir respawn'
                            : 'Seleccionar'}
                </output>
                <div className="edit-room-primary-tool-controls">
                  <button
                    type="button"
                    className={isSelectToolActive ? 'is-active is-select' : ''}
                    aria-label="Seleccionar"
                    aria-pressed={isSelectToolActive}
                    data-tool-tooltip="Seleccionar (S)"
                    onClick={() => {
                      setIsSelectToolActive(true)
                      setIsPaintToolActive(false)
                      setIsEraseToolActive(false)
                      setIsSpawnToolActive(false)
                      setIsTestSpawnToolActive(false)
                    }}
                  >
                    <img
                      className="edit-room-primary-icon is-select-icon"
                      src={selectToolIconSrc}
                      alt=""
                      aria-hidden="true"
                      draggable={false}
                    />
                  </button>
                  <button
                    type="button"
                    className={isPaintToolActive ? 'is-active' : ''}
                    aria-label="Pintar"
                    aria-pressed={isPaintToolActive}
                    data-tool-tooltip="Pintar (W)"
                    onClick={() => {
                      const nextIsActive = !isPaintToolActive
                      setIsPaintToolActive(nextIsActive)
                      setIsEraseToolActive(false)
                      setIsSelectToolActive(!nextIsActive)
                      setIsSpawnToolActive(false)
                      setIsTestSpawnToolActive(false)
                      clearEditorSelection()
                    }}
                  >
                    <img
                      className="edit-room-primary-icon"
                      src={paintToolIconSrc}
                      alt=""
                      aria-hidden="true"
                      draggable={false}
                    />
                  </button>
                  <button
                    type="button"
                    className={isEraseToolActive ? 'is-active is-erase' : ''}
                    aria-label="Borrar"
                    aria-pressed={isEraseToolActive}
                    data-tool-tooltip="Borrar (D)"
                    onClick={() => {
                      const nextIsActive = !isEraseToolActive
                      setIsEraseToolActive(nextIsActive)
                      setIsPaintToolActive(false)
                      setIsSelectToolActive(!nextIsActive)
                      setIsSpawnToolActive(false)
                      setIsTestSpawnToolActive(false)
                      clearEditorSelection()
                    }}
                  >
                    <img
                      className="edit-room-primary-icon"
                      src={eraseToolIconSrc}
                      alt=""
                      aria-hidden="true"
                      draggable={false}
                    />
                  </button>
                  <button
                    type="button"
                    className={isTestSpawnToolActive ? 'is-active is-test' : ''}
                    aria-label="Elegir punto de aparición para la prueba"
                    aria-pressed={isTestSpawnToolActive}
                    data-tool-tooltip="Test (T)"
                    onClick={() => {
                      const nextIsActive = !isTestSpawnToolActive
                      setIsTestSpawnToolActive(nextIsActive)
                      setIsPaintToolActive(false)
                      setIsEraseToolActive(false)
                      setIsSelectToolActive(!nextIsActive)
                      setIsSpawnToolActive(false)
                      clearEditorSelection()
                    }}
                  >
                    <img
                      className="edit-room-primary-icon"
                      src={testToolIconSrc}
                      alt=""
                      aria-hidden="true"
                      draggable={false}
                    />
                  </button>
                </div>
              </section>

              <section className="edit-room-tool-group" aria-label="Herramienta de zoom">
                <strong>Zoom</strong>
                <output>{zoomPercentage}%</output>
                <div className="edit-room-zoom-controls">
                  <button
                    type="button"
                    aria-label="Alejar mapa"
                    data-tool-tooltip="Alejar mapa"
                    disabled={mapZoom <= MIN_ZOOM}
                    onClick={() => updateZoom(mapZoom - ZOOM_STEP)}
                  >
                    <img
                      className="edit-room-zoom-icon"
                      src={zoomOutIconSrc}
                      alt=""
                      aria-hidden="true"
                      draggable={false}
                    />
                  </button>
                  <button
                    type="button"
                    aria-label="Restablecer zoom"
                    data-tool-tooltip="Restablecer zoom (1:1)"
                    onClick={() => updateZoom(1)}
                  >
                    <img
                      className="edit-room-zoom-icon"
                      src={zoomActualSizeIconSrc}
                      alt=""
                      aria-hidden="true"
                      draggable={false}
                    />
                  </button>
                  <button
                    type="button"
                    aria-label="Acercar mapa"
                    data-tool-tooltip="Acercar mapa"
                    disabled={mapZoom >= MAX_ZOOM}
                    onClick={() => updateZoom(mapZoom + ZOOM_STEP)}
                  >
                    <img
                      className="edit-room-zoom-icon"
                      src={zoomInIconSrc}
                      alt=""
                      aria-hidden="true"
                      draggable={false}
                    />
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
                {layers.map((layer) => {
                  const layerPlacements = placedAssetsByLayer.get(layer.id) ?? []
                  const isExpanded = expandedLayerIds.has(layer.id)
                  const childListId = `edit-room-layer-children-${layer.id}`

                  return (
                    <div
                      key={layer.id}
                      className={`edit-room-layer-node${layer.enabled ? '' : ' is-disabled'}`}
                      style={getEditorLayerColorStyle(layer.id)}
                      role="listitem"
                    >
                      <div
                        className={`edit-room-layer-row${layer.id === activeLayer.id ? ' is-active' : ''}${layer.enabled ? '' : ' is-disabled'}`}
                      >
                        <button
                          type="button"
                          className={`edit-room-layer-enabled-toggle${layer.enabled ? ' is-enabled' : ''}`}
                          aria-label={`${layer.enabled ? 'Deshabilitar' : 'Habilitar'} capa ${layer.name}`}
                          aria-pressed={layer.enabled}
                          title={`${layer.enabled ? 'Ocultar' : 'Mostrar'} capa · ${layer.name}`}
                          onClick={() => toggleLayerEnabled(layer.id)}
                        >
                          <span aria-hidden="true">{layer.enabled ? '◉' : '○'}</span>
                        </button>
                        <button
                          type="button"
                          className="edit-room-layer-disclosure"
                          aria-label={`${isExpanded ? 'Contraer' : 'Expandir'} capa ${layer.name}, ${layerPlacements.length} elementos`}
                          aria-expanded={isExpanded}
                          aria-controls={childListId}
                          title={`${isExpanded ? 'Contraer' : 'Mostrar'} elementos de ${layer.name}`}
                          onClick={() => toggleLayerExpanded(layer.id)}
                        >
                          <span aria-hidden="true">{isExpanded ? '▾' : '▸'}</span>
                        </button>
                        <button
                          type="button"
                          className="edit-room-layer-select"
                          aria-pressed={layer.id === activeLayer.id}
                          disabled={!layer.enabled}
                          onClick={() => {
                            setActiveLayerId(layer.id)
                            clearEditorSelection()
                          }}
                        >
                          <span className="edit-room-layer-icon-slot" aria-hidden="true" />
                          <span className="edit-room-layer-name">{layer.name}</span>
                          {layer.id === activeLayer.id ? (
                            <span className="edit-room-layer-mode">: {activeLayerStatusLabel}</span>
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

                      {isExpanded ? (
                        <div
                          id={childListId}
                          className="edit-room-layer-children"
                          role="group"
                          aria-label={`Elementos de ${layer.name}`}
                        >
                          {layerPlacements.length === 0 ? (
                            <p className="edit-room-layer-empty">Sin elementos</p>
                          ) : layerPlacements.map((placement, placementIndex) => {
                            const asset = assetById.get(placement.assetId)
                            const assetLabel = formatAssetLabel(asset?.name ?? placement.assetId)
                            const displayName = placement.name ?? assetLabel
                            const placementKey = getPlacedAssetKey(placement)
                            const isRenaming = renamingPlacementKey === placementKey
                            const isSelected = selectedPlacementKeys.has(placementKey)
                              || (!selectedMapArea?.placementKey
                                && selectedMapArea?.layerId === layer.id
                                && isCellInsideArea(placement.cellX, placement.cellY, selectedMapArea)
                              )

                            return isRenaming ? (
                              <div
                                key={placementKey}
                                className="edit-room-layer-child is-selected is-renaming"
                                data-editor-placement-key={placementKey}
                              >
                                <span className="edit-room-layer-child-icon" aria-hidden="true">
                                  {placement.flippedX ? '◈' : '◆'}
                                </span>
                                <input
                                  className="edit-room-layer-child-name-input"
                                  value={placementNameDraft}
                                  maxLength={80}
                                  autoFocus
                                  aria-label={`Nuevo nombre para ${displayName}`}
                                  onFocus={(event) => event.currentTarget.select()}
                                  onChange={(event) => setPlacementNameDraft(event.target.value)}
                                  onBlur={() => finishRenamingPlacement(placement, assetLabel)}
                                  onKeyDown={(event) => {
                                    event.stopPropagation()
                                    if (event.key === 'Enter') {
                                      event.preventDefault()
                                      finishRenamingPlacement(placement, assetLabel)
                                    } else if (event.key === 'Escape') {
                                      event.preventDefault()
                                      cancelRenamingPlacement()
                                    }
                                  }}
                                />
                                <span className="edit-room-layer-child-position">
                                  X{placement.cellX + 1} Y{placement.cellY + 1}
                                </span>
                              </div>
                            ) : (
                              <button
                                key={`${placementKey}-${placementIndex}`}
                                type="button"
                                className={`edit-room-layer-child${isSelected ? ' is-selected' : ''}`}
                                disabled={!layer.enabled}
                                aria-label={`${displayName}, columna ${placement.cellX + 1}, fila ${placement.cellY + 1}`}
                                aria-pressed={isSelected}
                                data-editor-placement-key={placementKey}
                                title={`${displayName} · X${placement.cellX + 1} Y${placement.cellY + 1}${placement.flippedX ? ' · Invertido X' : ''} · ⌘/Ctrl clic agrega o quita · Shift clic selecciona un rango · Doble clic para renombrar`}
                                onClick={(event) => selectLayerPlacement(placement, {
                                  toggle: event.metaKey || event.ctrlKey,
                                  range: event.shiftKey,
                                })}
                                onDoubleClick={(event) => {
                                  event.preventDefault()
                                  startRenamingPlacement(placement, assetLabel)
                                }}
                              >
                                <span className="edit-room-layer-child-icon" aria-hidden="true">
                                  {placement.flippedX ? '◈' : '◆'}
                                </span>
                                <span className="edit-room-layer-child-name">{displayName}</span>
                                <span className="edit-room-layer-child-position">
                                  X{placement.cellX + 1} Y{placement.cellY + 1}
                                </span>
                              </button>
                            )
                          })}
                        </div>
                      ) : null}
                    </div>
                  )
                })}
              </div>
            </div>
          </section>
        </aside>
      </section>

      <footer className="edit-room-statusbar">
        <span>Cuadrícula: 128 × 128 px</span>
        <span>
          {mapGridWidth} × {mapGridHeight} celdas · Zoom {zoomPercentage}% · {activeLayer.name}: {activeLayerStatusLabel}
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
              disabled={!resolvedProfile || !hasMinimumUserRole(resolvedProfile.role, 'admin')}
              onChange={(event) => setPublicationType(
                event.target.value as 'system' | 'room' | 'event' | 'official',
              )}
            >
              {resolvedProfile && hasMinimumUserRole(resolvedProfile.role, 'user')
                ? <option value="room">Sala</option> : null}
              {resolvedProfile && hasMinimumUserRole(resolvedProfile.role, 'admin')
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
