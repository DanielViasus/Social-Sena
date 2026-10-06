import type { RoomEditorAssetData, RoomEditorPlacementData, SavedRoomEditorMap } from '../types'
import type {
  RoomObjectInteractionVariantTemplate,
  RoomObjectKind,
  RoomObjectTemplate,
  RoomTeleportTemplate,
  RoomTemplate,
} from './types'

const LAYER_PRIORITY: Record<string, number> = {
  floor: 0,
  walls: 1,
  doors: 2,
  'object-decoration': 3,
  teleports: 4,
}

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

function resolveKind(layerId: string, category: string): RoomObjectKind {
  if (layerId === 'floor') return 'floor'
  if (layerId === 'walls') return 'wall'
  if (layerId === 'doors') return 'door'
  if (layerId === 'teleports') return 'portal'
  const normalized = category.toLowerCase()
  if (normalized.includes('floor')) return 'floor'
  if (normalized.includes('wall')) return 'wall'
  return 'landmark'
}

function createObjectVariant(
  placement: RoomEditorPlacementData,
  asset: RoomEditorAssetData,
  collidersEnabled: boolean,
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
        ...(asset.warningArea ?? {
          width: (asset.occupiedColumns + 4) * 128,
          height: (asset.occupiedRows + 4) * 128,
          offsetX: 0,
          offsetY: 0,
        }),
        offsetX: placement.flippedX
          ? -(asset.warningArea?.offsetX ?? 0)
          : asset.warningArea?.offsetX ?? 0,
      }
    : undefined
  const interactionArea = isInteractablePlacement
    ? {
        ...(asset.interactionArea ?? {
          width: (asset.occupiedColumns + 2) * 128,
          height: (asset.occupiedRows + 2) * 128,
          offsetX: 0,
          offsetY: 0,
        }),
        offsetX: placement.flippedX
          ? -(asset.interactionArea?.offsetX ?? 0)
          : asset.interactionArea?.offsetX ?? 0,
      }
    : undefined
  const interactionIconContainer = isInteractablePlacement
    ? {
        ...(asset.interactionIconContainer ?? {
          width: 128,
          height: 129,
          offsetX: 0,
          offsetY: -Math.round((asset.frameHeight + 129) / 2),
        }),
        offsetX: placement.flippedX
          ? -(asset.interactionIconContainer?.offsetX ?? 0)
          : asset.interactionIconContainer?.offsetX ?? 0,
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
  const objects = map.document.placements.flatMap((placement): RoomObjectTemplate[] => {
    if (placement.layerId === 'teleports') return []

    const asset = assets.get(placement.assetId)
    if (!asset) return []
    const layer = layers.get(placement.layerId)
    if (layer?.enabled === false) return []
    const collidersEnabled = layer?.collidersEnabled !== false
    const activeVariant = createObjectVariant(placement, asset, collidersEnabled)
    const { state: variantState, ...activeObjectProperties } = activeVariant
    const interactionVariants = asset.interactionState === undefined
      ? undefined
      : map.document.assets
          .filter((candidate) => (
            candidate.category === asset.category
            && candidate.interactionState !== undefined
            && candidate.id.replace(/-S[01]$/i, '') === asset.id.replace(/-S[01]$/i, '')
          ))
          .map((candidate) => createObjectVariant(placement, candidate, collidersEnabled))
    return [{
      id: `published-${placement.layerId}-${placement.cellX}-${placement.cellY}`,
      kind: resolveKind(placement.layerId, asset.category),
      opacity: placement.assetId === 'component-teleport' ? 0 : 1,
      flippedX: placement.flippedX,
      layerOrder: LAYER_PRIORITY[placement.layerId] ?? 2,
      ...activeObjectProperties,
      interactionState: asset.interactionState === undefined ? undefined : variantState,
      interactionVariants,
    }]
  })

  const teleports = map.document.placements.flatMap((placement): RoomTeleportTemplate[] => {
    if (placement.layerId !== 'teleports' || !placement.teleportTargetPath) return []

    const asset = assets.get(placement.assetId)
    if (!asset) return []
    const layer = layers.get(placement.layerId)
    if (layer?.enabled === false) return []

    const variant = createObjectVariant(
      placement,
      asset,
      layer?.collidersEnabled !== false,
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
      opacity: 1,
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
      iconOffsetY: (iconContainer?.offsetY ?? -129) - centerToBottomOffset,
      iconWidth: iconContainer?.width ?? 128,
      iconHeight: iconContainer?.height ?? 129,
      interactionId: `editor-teleport-${placement.cellX}-${placement.cellY}`,
      teleportTarget: { routePath: placement.teleportTargetPath },
    }]
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
    npcs: [],
    teleports,
    enemies: [],
  }
}
