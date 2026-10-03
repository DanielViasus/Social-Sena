export interface RoomEditorAsset {
  id: string
  fileName: string
  category: string
  name: string
  frameWidth: number
  frameHeight: number
  occupiedColumns: number
  occupiedRows: number
  colliderWidth: number
  colliderHeight: number
  colliderOffsetX: number
  colliderOffsetY: number
  zIndexOffsetY: number
  sourceWidth: number
  sourceHeight: number
  url: string
}

export interface RoomEditorAssetCategory {
  id: string
  name: string
  assets: RoomEditorAsset[]
}

type RoomEditorAssetDefinition = Omit<RoomEditorAsset, 'sourceWidth' | 'sourceHeight'>

const spriteModules = import.meta.glob<string>(
  '../assets/room-editor/sprites/Asset_*',
  {
    eager: true,
    import: 'default',
    query: '?url',
  },
)

const ASSET_FILE_PATTERN = /^Asset_([^_]+)_([^_]+)_(\d+)x(\d+)_([1-9]\d*)x([1-9]\d*)_(\d+)x(\d+)_(-?\d+)x(-?\d+)_(-?\d+)\.[^.]+$/i

export const formatAssetLabel = (value: string) => value
  .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
  .replace(/[-_]+/g, ' ')
  .trim()

const assetDefinitions = Object.entries(spriteModules).flatMap(([path, url]) => {
  const fileName = path.split('/').pop() ?? ''
  const match = fileName.match(ASSET_FILE_PATTERN)

  if (!match) {
    console.warn(
      `[room-editor] Se ignoró ${fileName}. Formato esperado: Asset_Categoria_Nombre_FrameWxH_CeldasWxH_ColliderWxH_OffsetXxY_ZIndexY.ext`,
    )
    return []
  }

  const [
    ,
    category,
    name,
    rawFrameWidth,
    rawFrameHeight,
    rawOccupiedColumns,
    rawOccupiedRows,
    rawColliderWidth,
    rawColliderHeight,
    rawColliderOffsetX,
    rawColliderOffsetY,
    rawZIndexOffsetY,
  ] = match

  return [{
    id: `${category}-${name}`,
    fileName,
    category,
    name,
    frameWidth: Number(rawFrameWidth),
    frameHeight: Number(rawFrameHeight),
    occupiedColumns: Number(rawOccupiedColumns),
    occupiedRows: Number(rawOccupiedRows),
    colliderWidth: Number(rawColliderWidth),
    colliderHeight: Number(rawColliderHeight),
    colliderOffsetX: Number(rawColliderOffsetX),
    colliderOffsetY: Number(rawColliderOffsetY),
    zIndexOffsetY: Number(rawZIndexOffsetY),
    url,
  } satisfies RoomEditorAssetDefinition]
})

const readImageSize = (asset: RoomEditorAssetDefinition) => new Promise<{
  width: number
  height: number
}>((resolve, reject) => {
  const image = new Image()
  image.onload = () => resolve({ width: image.naturalWidth, height: image.naturalHeight })
  image.onerror = () => reject(new Error(`No fue posible cargar ${asset.fileName}`))
  image.src = asset.url
})

export async function loadRoomEditorAssetCategories(): Promise<RoomEditorAssetCategory[]> {
  const loadedAssets = await Promise.all(assetDefinitions.map(async (definition) => {
    const { width, height } = await readImageSize(definition)

    if (width !== definition.frameWidth || height !== definition.frameHeight) {
      console.warn(
        `[room-editor] ${definition.fileName} mide ${width}x${height}, pero declara ${definition.frameWidth}x${definition.frameHeight}.`,
      )
    }

    return {
      ...definition,
      sourceWidth: width,
      sourceHeight: height,
    } satisfies RoomEditorAsset
  }))

  const categories = new Map<string, RoomEditorAsset[]>()
  loadedAssets.forEach((asset) => {
    const categoryAssets = categories.get(asset.category) ?? []
    categoryAssets.push(asset)
    categories.set(asset.category, categoryAssets)
  })

  return Array.from(categories, ([id, assets]) => ({
    id,
    name: formatAssetLabel(id),
    assets,
  }))
}
