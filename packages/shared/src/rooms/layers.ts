import type { RoomEditorLayerData } from '../types'

// Cada capa del editor tiene una categoria que define su comportamiento en el juego
// (orden de dibujo, colisiones, si es interactuable, si es recompensa, NPC o teleport).
// Las capas obligatorias usan su propio id como categoria; las capas nuevas eligen una.
export const ROOM_EDITOR_LAYER_CATEGORY_IDS = [
  'floor',
  'walls',
  'doors',
  'object-decoration',
  'rewards',
  'npcs',
  'teleports',
  'enemies',
] as const

export type RoomEditorLayerCategory = (typeof ROOM_EDITOR_LAYER_CATEGORY_IDS)[number]

export const ROOM_EDITOR_LAYER_CATEGORIES: readonly {
  id: RoomEditorLayerCategory
  name: string
  description: string
}[] = [
  { id: 'floor', name: 'Floor', description: 'Suelo: se dibuja al fondo y no interactua.' },
  { id: 'walls', name: 'Walls', description: 'Muros: bloquean el paso.' },
  { id: 'doors', name: 'Door', description: 'Puertas: se pueden interactuar.' },
  { id: 'object-decoration', name: 'ObjectDecoration', description: 'Objetos y decoracion.' },
  { id: 'rewards', name: 'Rewards', description: 'Recompensas recolectables (monedas).' },
  { id: 'npcs', name: 'NPCs', description: 'Personajes con dialogo.' },
  { id: 'teleports', name: 'Teleports', description: 'Teleports hacia otra escena.' },
  { id: 'enemies', name: 'Enemies', description: 'Enemigos con zona de vigilancia.' },
]

export const DEFAULT_ROOM_EDITOR_LAYER_CATEGORY: RoomEditorLayerCategory = 'object-decoration'

const CATEGORY_IDS = new Set<string>(ROOM_EDITOR_LAYER_CATEGORY_IDS)

export const ROOM_EDITOR_LAYER_PRIORITY: Record<RoomEditorLayerCategory, number> = {
  floor: 0,
  walls: 1,
  doors: 2,
  'object-decoration': 3,
  rewards: 4,
  npcs: 5,
  teleports: 6,
  enemies: 7,
}

export function isRoomEditorLayerCategory(value: string | undefined): value is RoomEditorLayerCategory {
  return typeof value === 'string' && CATEGORY_IDS.has(value)
}

export function roomEditorLayerCategoryName(category: RoomEditorLayerCategory) {
  return ROOM_EDITOR_LAYER_CATEGORIES.find((item) => item.id === category)?.name ?? category
}

// Documentos guardados antes de las categorias: las capas obligatorias se reconocen por su id
// y cualquier otra capa mantiene el comportamiento que ya tenia (objeto/decoracion).
export function resolveRoomEditorLayerCategory(
  layer: Pick<RoomEditorLayerData, 'category'> | undefined,
  layerId: string,
): RoomEditorLayerCategory {
  if (isRoomEditorLayerCategory(layer?.category)) return layer.category
  if (isRoomEditorLayerCategory(layerId)) return layerId
  return DEFAULT_ROOM_EDITOR_LAYER_CATEGORY
}

// Resolutor por id de capa para recorrer muchas colocaciones sin repetir busquedas.
export function createRoomEditorLayerCategoryLookup(
  layers: readonly RoomEditorLayerData[],
): (layerId: string) => RoomEditorLayerCategory {
  const byId = new Map(layers.map((layer) => [layer.id, layer]))
  return (layerId: string) => resolveRoomEditorLayerCategory(byId.get(layerId), layerId)
}
