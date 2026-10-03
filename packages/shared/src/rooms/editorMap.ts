import type { SavedRoomEditorMap } from '../types'
import type { RoomObjectKind, RoomObjectTemplate, RoomTemplate } from './types'

const LAYER_PRIORITY: Record<string, number> = {
  floor: 0,
  walls: 1,
  'object-decoration': 2,
  teleports: 3,
}

function resolveKind(layerId: string, category: string): RoomObjectKind {
  if (layerId === 'floor') return 'floor'
  if (layerId === 'walls') return 'wall'
  if (layerId === 'teleports') return 'portal'
  const normalized = category.toLowerCase()
  if (normalized.includes('floor')) return 'floor'
  if (normalized.includes('wall')) return 'wall'
  return 'landmark'
}

export function createRoomTemplateFromEditorMap(map: SavedRoomEditorMap): RoomTemplate {
  const assets = new Map(map.document.assets.map((asset) => [asset.id, asset]))
  const layers = new Map(map.document.layers.map((layer) => [layer.id, layer]))
  const objects = map.document.placements.flatMap((placement): RoomObjectTemplate[] => {
    const asset = assets.get(placement.assetId)
    if (!asset) return []
    const layer = layers.get(placement.layerId)
    const hasCollider = layer?.collidersEnabled !== false
      && asset.colliderWidth > 0
      && asset.colliderHeight > 0
    const collider = hasCollider ? {
      offsetX: asset.colliderOffsetX,
      offsetY: asset.colliderOffsetY,
      width: asset.colliderWidth,
      height: asset.colliderHeight,
    } : undefined
    return [{
      id: `published-${placement.layerId}-${placement.cellX}-${placement.cellY}`,
      kind: resolveKind(placement.layerId, asset.category),
      x: placement.cellX * 128 + asset.frameWidth / 2,
      y: placement.cellY * 128 + asset.frameHeight / 2,
      width: asset.frameWidth,
      height: asset.frameHeight,
      opacity: 1,
      spriteAssetId: asset.id,
      flippedX: placement.flippedX,
      layerOrder: LAYER_PRIORITY[placement.layerId] ?? 2,
      gridFootprint: { columns: asset.occupiedColumns, rows: asset.occupiedRows },
      collider,
      zIndexRef: {
        offsetX: collider?.offsetX ?? 0,
        offsetY: asset.zIndexOffsetY,
        width: Math.max(48, collider ? collider.width * 0.45 : asset.frameWidth * 0.35),
        thickness: 2,
      },
    }]
  })

  return {
    id: `editor-map-${map.code}`,
    routeSegment: map.routePath?.replace(/^\//, '') ?? `Room=${map.code}`,
    name: map.name,
    chatMode: 'scene',
    world: {
      width: map.document.gridWidth * 128,
      height: map.document.gridHeight * 128,
      spawn: { x: 64, y: 64 },
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
