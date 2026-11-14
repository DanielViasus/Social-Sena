export const WORLD_WIDTH = 5000
export const WORLD_HEIGHT = 5000
export const DEFAULT_ROOM_ID = 'lobby'
export const DEFAULT_ROOM_NAME = 'Lobby Principal'
export const DEFAULT_ROOM_CAPACITY = 20
export const ROOM_COIN_ASSET_ID = 'component-coins'
export const ROOM_REWARDS_LAYER_ID = 'rewards'

// Espacio estandar de los iconos de interaccion (alerta, tecla E, aviso del enemigo).
export const ROOM_INTERACTION_ICON_SIZE = 128

// Tras huir, el enemigo deja en paz al grupo durante este tiempo.
export const COMBAT_FLEE_GRACE_MS = 5000

// Zona de interaccion por defecto de un enemigo: 2x2 celdas que lo acompañan.
export const DEFAULT_ENEMY_INTERACTION_AREA = {
  width: 2 * 128,
  height: 2 * 128,
  offsetX: 0,
  offsetY: 0,
} as const

// Zona de vigilancia por defecto de un enemigo: 3x3 celdas centradas en el.
export const DEFAULT_ENEMY_SURVEILLANCE_AREA = {
  width: 3 * 128,
  height: 3 * 128,
  offsetX: 0,
  offsetY: 0,
} as const
export const PLAYER_CURRENCY_INVENTORY_PREFIX = 'currency:'
export const PLAYER_COIN_INVENTORY_ITEM_ID = `${PLAYER_CURRENCY_INVENTORY_PREFIX}coin`
export const MAX_INVENTORY_ITEM_QUANTITY = 2_000_000_000
export const DEFAULT_SPAWN_POSITION = { x: WORLD_WIDTH / 2, y: WORLD_HEIGHT / 2 }
export const PLAYER_SPEED = 204
export const PLAYER_REACH_THRESHOLD = 6

export function getCurrencyInventoryItemId(currencyType: string) {
  const normalizedType = currencyType
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'coin'

  return `${PLAYER_CURRENCY_INVENTORY_PREFIX}${normalizedType}`
}

export function getCoinInventoryItemIdFromAssetId(assetId?: string) {
  if (assetId === ROOM_COIN_ASSET_ID) {
    return PLAYER_COIN_INVENTORY_ITEM_ID
  }

  const currencyType = assetId?.startsWith(`${ROOM_COIN_ASSET_ID}-`)
    ? assetId.slice(ROOM_COIN_ASSET_ID.length + 1)
    : ''

  return currencyType ? getCurrencyInventoryItemId(currencyType) : null
}

export function isCurrencyInventoryItemId(itemId: string) {
  return itemId.startsWith(PLAYER_CURRENCY_INVENTORY_PREFIX)
}
