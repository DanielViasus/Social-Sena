import { ROOM_COIN_ASSET_ID } from '@social-sena/shared'
import { formatAssetLabel, type RoomEditorAsset } from './roomEditorAssetCatalog'

export interface CoinSpriteDefinition {
  assetId: string
  fileName: string
  currencyType: string
  name: string
  sheetWidth: number
  sheetHeight: number
  frameWidth: number
  frameHeight: number
  frameCount: number
  columns: number
  rows: number
  frameDurationMs: number
  url: string
}

const coinSpriteModules = import.meta.glob<string>(
  '../assets/room-editor/sprites/Gif_Coin_*__A*',
  {
    eager: true,
    import: 'default',
    query: '?url',
  },
)

// B is the canonical frame marker. D remains accepted for the textual draft of
// the convention, so existing files do not have to be renamed immediately.
const COIN_FILE_PATTERN = /^Gif_Coin_([^_]+)__A([1-9]\d*)x([1-9]\d*)[BD]([1-9]\d*)x([1-9]\d*)(?:F([1-9]\d*))?N_(.+)\.[^.]+$/i
const DEFAULT_FRAME_COUNT = 8
const DEFAULT_FRAME_DURATION_MS = 120

function toAssetIdSegment(value: string) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/gi, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase()
}

function createCoinAssetId(currencyType: string) {
  const normalizedType = toAssetIdSegment(currencyType) || 'coin'
  return normalizedType === 'coin'
    ? ROOM_COIN_ASSET_ID
    : `${ROOM_COIN_ASSET_ID}-${normalizedType}`
}

export const coinSpriteDefinitions: CoinSpriteDefinition[] = Object.entries(coinSpriteModules)
  .flatMap(([path, url]) => {
    const fileName = path.split('/').pop() ?? ''
    const match = fileName.match(COIN_FILE_PATTERN)
    if (!match) {
      console.warn(
        `[room-editor] Se ignoró ${fileName}. Formato esperado: Gif_Coin_Tipo__ASheetWxHBFrameWxH(FFrames)N_Nombre.svg`,
      )
      return []
    }

    const [
      ,
      currencyType,
      rawSheetWidth,
      rawSheetHeight,
      rawFrameWidth,
      rawFrameHeight,
      rawFrameCount,
      rawName,
    ] = match
    const sheetWidth = Number(rawSheetWidth)
    const sheetHeight = Number(rawSheetHeight)
    const frameWidth = Number(rawFrameWidth)
    const frameHeight = Number(rawFrameHeight)
    if (sheetWidth % frameWidth !== 0 || sheetHeight % frameHeight !== 0) {
      console.warn(
        `[room-editor] Se ignoró ${fileName}. La hoja ${sheetWidth}x${sheetHeight} no se puede dividir exactamente en frames de ${frameWidth}x${frameHeight}.`,
      )
      return []
    }

    const columns = Math.max(1, Math.floor(sheetWidth / frameWidth))
    const availableRows = Math.max(1, Math.floor(sheetHeight / frameHeight))
    const availableFrames = columns * availableRows
    const frameCount = Math.min(
      Number(rawFrameCount ?? DEFAULT_FRAME_COUNT),
      availableFrames,
    )

    return [{
      assetId: createCoinAssetId(currencyType),
      fileName,
      currencyType,
      name: formatAssetLabel(rawName),
      sheetWidth,
      sheetHeight,
      frameWidth,
      frameHeight,
      frameCount,
      columns,
      rows: Math.max(1, Math.ceil(frameCount / columns)),
      frameDurationMs: DEFAULT_FRAME_DURATION_MS,
      url,
    } satisfies CoinSpriteDefinition]
  })
  .sort((left, right) => left.currencyType.localeCompare(right.currencyType))

const coinSpriteByAssetId = new Map(
  coinSpriteDefinitions.map((definition) => [definition.assetId, definition]),
)

export function getCoinSpriteDefinition(assetId?: string) {
  return assetId ? coinSpriteByAssetId.get(assetId) : undefined
}

export function isCoinAssetId(assetId?: string) {
  return Boolean(getCoinSpriteDefinition(assetId))
}

export const coinEditorAssets: RoomEditorAsset[] = coinSpriteDefinitions.map((definition) => ({
  id: definition.assetId,
  fileName: definition.fileName,
  category: 'Coins',
  name: definition.name,
  frameWidth: definition.frameWidth,
  frameHeight: definition.frameHeight,
  occupiedColumns: 1,
  occupiedRows: 1,
  colliders: [],
  zIndexOffsetY: Math.round(definition.frameHeight / 2),
  warningArea: {
    width: 128,
    height: 128,
    offsetX: 0,
    offsetY: 0,
  },
  interactionArea: {
    width: 128,
    height: 128,
    offsetX: 0,
    offsetY: 0,
  },
  interactionIconContainer: {
    width: 32,
    height: 32,
    offsetX: 0,
    offsetY: -32,
  },
  sourceWidth: definition.sheetWidth,
  sourceHeight: definition.sheetHeight,
  url: definition.url,
}))
