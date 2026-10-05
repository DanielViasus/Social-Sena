import type { RoomEditorAssetData, RoomEditorPlacementData, SavedRoomEditorMap } from '../types'
import type {
  RoomObjectInteractionVariantTemplate,
  RoomObjectKind,
  RoomObjectTemplate,
  RoomTemplate,
} from './types'

const LAYER_PRIORITY: Record<string, number> = {
  floor: 0,
  walls: 1,
  doors: 2,
  'object-decoration': 3,
  teleports: 4,
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
  const colliders = collidersEnabled
    ? asset.colliders.map((collider) => ({
        ...collider,
        offsetX: placement.flippedX ? -collider.offsetX : collider.offsetX,
      }))
    : []
  const collider = colliders[0]
  const warningArea = placement.layerId === 'doors'
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
  const interactionArea = placement.layerId === 'doors'
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
  const interactionIconContainer = placement.layerId === 'doors'
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
      opacity: 1,
      flippedX: placement.flippedX,
      layerOrder: LAYER_PRIORITY[placement.layerId] ?? 2,
      ...activeObjectProperties,
      interactionState: asset.interactionState === undefined ? undefined : variantState,
      interactionVariants,
    }]
  })

  const defaultSpawn = map.document.spawnPoints.find((spawnPoint) => spawnPoint.id === 'default')
    ?? map.document.spawnPoints[0]
  const spawn = defaultSpawn
    ? {
        x: Math.min(map.document.gridWidth - 1, defaultSpawn.cellX) * 128 + 64,
        y: Math.min(map.document.gridHeight - 1, defaultSpawn.cellY) * 128 + 96,
      }
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
    teleports: [],
    enemies: [],
  }
}
