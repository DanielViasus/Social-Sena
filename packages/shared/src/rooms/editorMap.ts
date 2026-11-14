import type { RoomEditorAssetData, RoomEditorPlacementData, SavedRoomEditorMap } from '../types'
import {
  DEFAULT_ENEMY_INTERACTION_AREA,
  DEFAULT_ENEMY_SURVEILLANCE_AREA,
  ROOM_INTERACTION_ICON_SIZE,
  getCoinInventoryItemIdFromAssetId,
} from '../constants'
import {
  ROOM_EDITOR_LAYER_PRIORITY,
  createRoomEditorLayerCategoryLookup,
  type RoomEditorLayerCategory,
} from './layers'
import type {
  RoomEnemyTemplate,
  RoomObjectInteractionVariantTemplate,
  RoomNpcTemplate,
  RoomObjectKind,
  RoomObjectTemplate,
  RoomTeleportTemplate,
  RoomTemplate,
} from './types'

function normalizeEntryPath(path: string) {
  const pathname = path.split(/[?#]/, 1)[0]?.trim() ?? ''
  if (!pathname) return ''
  const withLeadingSlash = pathname.startsWith('/') ? pathname : `/${pathname}`
  return (withLeadingSlash.replace(/\/+$/, '') || '/').toLowerCase()
}

export function resolveRoomEntrySpawn(template: RoomTemplate, sourcePath?: string) {
  const entrySpawns = template.world.entrySpawns ?? []
  const normalizedSourcePath = sourcePath ? normalizeEntryPath(sourcePath) : ''
  const exactSpawn = normalizedSourcePath
    ? entrySpawns.find((entrySpawn) => entrySpawn.sourcePaths.some((path) => (
        normalizeEntryPath(path) === normalizedSourcePath
      )))
    : undefined
  const fallbackSpawn = entrySpawns.find((entrySpawn) => entrySpawn.sourcePaths.some((path) => (
    normalizeEntryPath(path) === '/all'
  )))
  const resolvedPosition = exactSpawn?.position ?? fallbackSpawn?.position ?? template.world.spawn

  return { ...resolvedPosition }
}

function resolveKind(layerCategory: RoomEditorLayerCategory, assetCategory: string): RoomObjectKind {
  if (layerCategory === 'floor') return 'floor'
  if (layerCategory === 'walls') return 'wall'
  if (layerCategory === 'doors') return 'door'
  if (layerCategory === 'rewards') return 'landmark'
  if (layerCategory === 'teleports') return 'portal'
  const normalized = assetCategory.toLowerCase()
  if (normalized.includes('floor')) return 'floor'
  if (normalized.includes('wall')) return 'wall'
  return 'landmark'
}

function createObjectVariant(
  placement: RoomEditorPlacementData,
  asset: RoomEditorAssetData,
  collidersEnabled: boolean,
  layerCategory: RoomEditorLayerCategory,
): RoomObjectInteractionVariantTemplate {
  const usesBottomCenterAnchor = asset.frameWidth > 128 || asset.frameHeight > 128
  const centersWithinGridFootprint = layerCategory === 'rewards'
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
  const isInteractablePlacement = layerCategory === 'doors'
    || layerCategory === 'teleports'
    || layerCategory === 'npcs'
  const placementWarningArea = placement.warningArea ?? asset.warningArea
  const placementInteractionArea = placement.interactionArea ?? asset.interactionArea
  const placementIconContainer = placement.interactionIconContainer ?? asset.interactionIconContainer
  const warningArea = isInteractablePlacement
    ? {
        ...(placementWarningArea ?? {
          width: (asset.occupiedColumns + 4) * 128,
          height: (asset.occupiedRows + 4) * 128,
          offsetX: 0,
          offsetY: 0,
        }),
        offsetX: placement.flippedX
          ? -(placementWarningArea?.offsetX ?? 0)
          : placementWarningArea?.offsetX ?? 0,
      }
    : undefined
  const interactionArea = isInteractablePlacement
    ? {
        ...(placementInteractionArea ?? {
          width: (asset.occupiedColumns + 2) * 128,
          height: (asset.occupiedRows + 2) * 128,
          offsetX: 0,
          offsetY: 0,
        }),
        offsetX: placement.flippedX
          ? -(placementInteractionArea?.offsetX ?? 0)
          : placementInteractionArea?.offsetX ?? 0,
      }
    : undefined
  const interactionIconContainer = isInteractablePlacement
    ? {
        ...(placementIconContainer ?? {
          width: ROOM_INTERACTION_ICON_SIZE,
          height: ROOM_INTERACTION_ICON_SIZE,
          offsetX: 0,
          offsetY: -Math.round((asset.frameHeight + ROOM_INTERACTION_ICON_SIZE) / 2),
        }),
        offsetX: placement.flippedX
          ? -(placementIconContainer?.offsetX ?? 0)
          : placementIconContainer?.offsetX ?? 0,
      }
    : undefined

  return {
    state: asset.interactionState ?? 0,
    x: placement.cellX * 128 + (
      usesBottomCenterAnchor || centersWithinGridFootprint
        ? occupiedWidth / 2
        : asset.frameWidth / 2
    ),
    y: placement.cellY * 128 + (
      centersWithinGridFootprint
        ? occupiedHeight / 2
        : usesBottomCenterAnchor
          ? occupiedHeight - asset.frameHeight / 2
          : asset.frameHeight / 2
    ),
    width: asset.frameWidth,
    height: asset.frameHeight,
    spriteAssetId: asset.id,
    gridFootprint: { columns: asset.occupiedColumns, rows: asset.occupiedRows },
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

// Hoja de sprites del enemigo colocado desde el editor: 4 filas (idle y caminata, frente y espalda).
const ENEMY_SPRITE_SHEET_ASSET_ID = 'enemy-training-dummy-sheet'
const ENEMY_SPRITE_SHEET_SIZE = { width: 512, height: 1280 }
const ENEMY_SPRITE_FRAME_SIZE = { width: 128, height: 128 }
const ENEMY_SPRITE_ROWS = 4
const ENEMY_SPRITE_COLUMNS = 4

function createEnemySpriteFrames(enemyId: string) {
  return Array.from({ length: ENEMY_SPRITE_ROWS * ENEMY_SPRITE_COLUMNS }, (_unused, index) => {
    const row = Math.floor(index / ENEMY_SPRITE_COLUMNS)
    const column = index % ENEMY_SPRITE_COLUMNS
    return { key: `${enemyId}-${row}-${column}`, row, column }
  })
}

// Construye el enemigo de una colocacion del editor. La zona de vigilancia decide
// donde detecta al jugador y, por ahora, tambien el area que patrulla.
export function createEnemyTemplateFromPlacement(
  placement: RoomEditorPlacementData,
  asset: RoomEditorAssetData,
  idPrefix: string,
): RoomEnemyTemplate {
  const variant = createObjectVariant(placement, asset, false, 'enemies')
  const surveillanceArea = placement.surveillanceArea
    ?? asset.surveillanceArea
    ?? { ...DEFAULT_ENEMY_SURVEILLANCE_AREA }
  const interactionArea = placement.interactionArea
    ?? asset.interactionArea
    ?? { ...DEFAULT_ENEMY_INTERACTION_AREA }
  const id = `${idPrefix}-${placement.cellX}-${placement.cellY}`

  return {
    entityType: 'enemy',
    id,
    label: placement.name,
    posicion_relativa_X: variant.x,
    posicion_relativa_Y: variant.y,
    ancho_de_patrullaje_: surveillanceArea.width,
    alto_de_patrullaje_: surveillanceArea.height,
    velocidad_de_patrullaje_: 72,
    nivel_enemigo_: 0,
    ancho_area_interaccion_directa_: interactionArea.width,
    alto_area_interaccion_directa_: interactionArea.height,
    spriteSheetAssetId: ENEMY_SPRITE_SHEET_ASSET_ID,
    spriteSheetWidth: ENEMY_SPRITE_SHEET_SIZE.width,
    spriteSheetHeight: ENEMY_SPRITE_SHEET_SIZE.height,
    spriteFrameWidth: ENEMY_SPRITE_FRAME_SIZE.width,
    spriteFrameHeight: ENEMY_SPRITE_FRAME_SIZE.height,
    spriteFrames: createEnemySpriteFrames(id),
    spriteFrameDurationMs: 240,
    iconWarningAssetIds: ['enemy-warning-0', 'enemy-warning-1', 'enemy-warning-2', 'enemy-warning-3'],
    iconFrameDurationMs: 180,
    // Misma escala que el icono de las puertas y teleports (128 px).
    iconWidth: 128,
    iconHeight: 128,
    iconOffsetX: 0,
    iconOffsetY: -128,
    surveillanceArea: { ...surveillanceArea },
    interactionArea: { ...interactionArea },
    // Por defecto, a un octavo de la figura desde abajo.
    zIndexOffsetY: placement.zIndexOffsetY
      ?? asset.zIndexOffsetY
      ?? Math.round(asset.frameHeight * 0.375),
  }
}

export function interactWithRoomObject(
  template: RoomTemplate,
  objectId: string,
): { template: RoomTemplate; outcome: 'toggled' | 'removed'; state?: 0 | 1 } | null {
  const objectIndex = template.objects.findIndex((roomObject) => roomObject.id === objectId)
  const roomObject = template.objects[objectIndex]
  if (!roomObject || roomObject.interactionState === undefined) {
    return null
  }

  const nextState: 0 | 1 = roomObject.interactionState === 0 ? 1 : 0
  const nextVariant = roomObject.interactionVariants?.find((variant) => variant.state === nextState)
  if (!nextVariant) {
    return {
      template: {
        ...template,
        objects: template.objects.filter((candidate) => candidate.id !== objectId),
      },
      outcome: 'removed',
    }
  }

  const { state, ...nextObjectProperties } = nextVariant
  const nextObjects = [...template.objects]
  nextObjects[objectIndex] = {
    ...roomObject,
    ...nextObjectProperties,
    interactionState: state,
  }

  return {
    template: { ...template, objects: nextObjects },
    outcome: 'toggled',
    state,
  }
}

export function createRoomTemplateFromEditorMap(map: SavedRoomEditorMap): RoomTemplate {
  const assets = new Map(map.document.assets.map((asset) => [asset.id, asset]))
  const layers = new Map(map.document.layers.map((layer) => [layer.id, layer]))
  // El comportamiento depende de la categoria de la capa, no de su id: asi una capa nueva
  // puede comportarse como suelo, muro, puerta, recompensa, NPC o teleport.
  const layerCategoryOf = createRoomEditorLayerCategoryLookup(map.document.layers)
  const objects = map.document.placements.flatMap((placement): RoomObjectTemplate[] => {
    const layerCategory = layerCategoryOf(placement.layerId)
    // Los teleports, NPCs y enemigos se construyen en sus propias listas, no como objetos.
    if (layerCategory === 'teleports' || layerCategory === 'npcs' || layerCategory === 'enemies') return []

    const asset = assets.get(placement.assetId)
    if (!asset) return []
    const layer = layers.get(placement.layerId)
    if (layer?.enabled === false) return []
    const collidersEnabled = layer?.collidersEnabled !== false
    const activeVariant = createObjectVariant(placement, asset, collidersEnabled, layerCategory)
    const { state: variantState, ...activeObjectProperties } = activeVariant
    const interactionVariants = asset.interactionState === undefined
      ? undefined
      : map.document.assets
          .filter((candidate) => (
            candidate.category === asset.category
            && candidate.interactionState !== undefined
            && candidate.id.replace(/-S[01]$/i, '') === asset.id.replace(/-S[01]$/i, '')
          ))
          .map((candidate) => createObjectVariant(placement, candidate, collidersEnabled, layerCategory))
    const coinInventoryItemId = layerCategory === 'rewards'
      ? getCoinInventoryItemIdFromAssetId(asset.id)
      : null
    return [{
      id: `published-${placement.layerId}-${placement.cellX}-${placement.cellY}`,
      kind: resolveKind(layerCategory, asset.category),
      collectible: layerCategory === 'rewards',
      collectibleReward: coinInventoryItemId
        ? { inventoryItemId: coinInventoryItemId, quantity: 1 }
        : undefined,
      opacity: placement.assetId === 'component-teleport' ? 0 : 1,
      flippedX: placement.flippedX,
      layerOrder: ROOM_EDITOR_LAYER_PRIORITY[layerCategory],
      ...activeObjectProperties,
      interactionState: asset.interactionState === undefined ? undefined : variantState,
      interactionVariants,
    }]
  })

  const teleports = map.document.placements.flatMap((placement): RoomTeleportTemplate[] => {
    if (layerCategoryOf(placement.layerId) !== 'teleports' || !placement.teleportTargetPath) return []

    const asset = assets.get(placement.assetId)
    if (!asset) return []
    const layer = layers.get(placement.layerId)
    if (layer?.enabled === false) return []

    const variant = createObjectVariant(
      placement,
      asset,
      layer?.collidersEnabled !== false,
      'teleports',
    )
    const iconContainer = variant.interactionIconContainer
    const centerToBottomOffset = variant.height / 2
    const collider = variant.collider
      ? { ...variant.collider, offsetY: variant.collider.offsetY - centerToBottomOffset }
      : undefined
    const zIndexRef = variant.zIndexRef
      ? { ...variant.zIndexRef, offsetY: variant.zIndexRef.offsetY - centerToBottomOffset }
      : undefined

    return [{
      entityType: 'teleport',
      id: `published-teleport-${placement.cellX}-${placement.cellY}`,
      label: placement.name,
      x: variant.x,
      y: variant.y + centerToBottomOffset,
      width: variant.width,
      height: variant.height,
      fillColor: 0x496a73,
      strokeColor: 0xa8dcdf,
      opacity: placement.assetId === 'component-teleport' ? 0 : 1,
      spriteAssetId: placement.assetId === 'component-teleport' ? undefined : placement.assetId,
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
      iconOffsetY: (iconContainer?.offsetY ?? -ROOM_INTERACTION_ICON_SIZE) - centerToBottomOffset,
      iconWidth: iconContainer?.width ?? ROOM_INTERACTION_ICON_SIZE,
      iconHeight: iconContainer?.height ?? ROOM_INTERACTION_ICON_SIZE,
      interactionId: `editor-teleport-${placement.cellX}-${placement.cellY}`,
      teleportTarget: { routePath: placement.teleportTargetPath },
    }]
  })

  const npcs = map.document.placements.flatMap((placement): RoomNpcTemplate[] => {
    if (layerCategoryOf(placement.layerId) !== 'npcs' || placement.assetId !== 'component-npc-mage') return []

    const asset = assets.get(placement.assetId)
    if (!asset) return []
    const layer = layers.get(placement.layerId)
    if (layer?.enabled === false) return []

    const variant = createObjectVariant(
      placement,
      asset,
      layer?.collidersEnabled !== false,
      'npcs',
    )
    const centerToBottomOffset = variant.height / 2
    const collider = variant.collider
      ? { ...variant.collider, offsetY: variant.collider.offsetY - centerToBottomOffset }
      : undefined
    const zIndexRef = variant.zIndexRef
      ? { ...variant.zIndexRef, offsetY: variant.zIndexRef.offsetY - centerToBottomOffset }
      : undefined
    const iconContainer = variant.interactionIconContainer
    const npcId = `published-npc-${placement.cellX}-${placement.cellY}-${placement.assetId}`

    return [{
      entityType: 'npc',
      id: npcId,
      label: placement.name,
      x: variant.x,
      y: variant.y + centerToBottomOffset,
      width: variant.width,
      height: variant.height,
      opacity: 1,
      flippedX: placement.flippedX,
      spriteSheetAssetId: 'npc-mage-sheet',
      spriteSheetWidth: 512,
      spriteSheetHeight: 1280,
      spriteFrameWidth: 128,
      spriteFrameHeight: 128,
      spriteFrames: [
        { key: `${npcId}-idle-0`, row: 0, column: 0 },
        { key: `${npcId}-idle-1`, row: 0, column: 1 },
        { key: `${npcId}-idle-2`, row: 0, column: 2 },
        { key: `${npcId}-idle-3`, row: 0, column: 3 },
      ],
      spriteFrameDurationMs: 250,
      iconFrameDurationMs: 400,
      iconWarningAssetIds: ['npc-alert-0', 'npc-alert-1', 'npc-alert-2', 'npc-alert-3'],
      iconInteractionAssetIds: ['npc-interaction-e-0', 'npc-interaction-e-1'],
      iconOffsetX: iconContainer?.offsetX ?? 0,
      iconOffsetY: (iconContainer?.offsetY ?? -136) - centerToBottomOffset,
      iconWidth: iconContainer?.width ?? 128,
      iconHeight: iconContainer?.height ?? 128,
      collider,
      zIndexRef,
      warningArea: variant.warningArea
        ? { ...variant.warningArea, offsetY: variant.warningArea.offsetY - centerToBottomOffset }
        : undefined,
      interactionArea: variant.interactionArea
        ? { ...variant.interactionArea, offsetY: variant.interactionArea.offsetY - centerToBottomOffset }
        : undefined,
      interactionId: npcId,
      dialogueId: 'lobby-guide-intro',
    }]
  })

  const enemies = map.document.placements.flatMap((placement): RoomEnemyTemplate[] => {
    if (layerCategoryOf(placement.layerId) !== 'enemies') return []

    const asset = assets.get(placement.assetId)
    if (!asset) return []
    const layer = layers.get(placement.layerId)
    if (layer?.enabled === false) return []

    return [createEnemyTemplateFromPlacement(placement, asset, 'published-enemy')]
  })

  const entrySpawns = map.document.spawnPoints.map((spawnPoint) => ({
    id: spawnPoint.id,
    position: {
      x: Math.min(map.document.gridWidth - 1, spawnPoint.cellX) * 128 + 64,
      y: Math.min(map.document.gridHeight - 1, spawnPoint.cellY) * 128 + 96,
    },
    sourcePaths: spawnPoint.sourcePaths
      ?? spawnPoint.entryKey?.split(';').map((path) => path.trim()).filter(Boolean)
      ?? [],
  }))
  const defaultEntrySpawn = entrySpawns.find((entrySpawn) => (
    entrySpawn.sourcePaths.some((path) => normalizeEntryPath(path) === '/all')
  ))
    ?? entrySpawns.find((entrySpawn) => entrySpawn.id === 'default')
    ?? entrySpawns[0]
  const spawn = defaultEntrySpawn
    ? { ...defaultEntrySpawn.position }
    : { x: 64, y: 64 }

  return {
    id: `editor-map-${map.code}`,
    routeSegment: map.routePath?.replace(/^\//, '') ?? `Room=${map.code}`,
    name: map.name,
    chatMode: 'scene',
    world: {
      width: map.document.gridWidth * 128,
      height: map.document.gridHeight * 128,
      spawn,
      entrySpawns,
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
    objects,
    npcs,
    teleports,
    enemies,
  }
}
