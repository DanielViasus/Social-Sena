export interface RoomEditorAsset {
  id: string
  fileName: string
  category: string
  name: string
  frameWidth: number
  frameHeight: number
  occupiedColumns: number
  occupiedRows: number
  colliders: Array<{
    width: number
    height: number
    offsetX: number
    offsetY: number
  }>
  zIndexOffsetY: number
  warningArea: {
    width: number
    height: number
    offsetX: number
    offsetY: number
  }
  interactionArea: {
    width: number
    height: number
    offsetX: number
    offsetY: number
  }
  interactionIconContainer: {
    width: number
    height: number
    offsetX: number
    offsetY: number
  }
  interactionState?: 0 | 1
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

const ASSET_FILE_PATTERN = /^Asset_([^_]+)_(.+)__A(\d+)x(\d+)B([1-9]\d*)x([1-9]\d*)((?:C\d+x\d+D-?\d+x-?\d+){0,4})E(-?\d+)(?:F([1-9]\d*)x([1-9]\d*))?(?:G(-?\d+)x(-?\d+))?(?:H([1-9]\d*)x([1-9]\d*))?(?:I(-?\d+)x(-?\d+))?(?:J([1-9]\d*)x([1-9]\d*))?(?:K(-?\d+)x(-?\d+))?(?:S([01]))?\.[^.]+$/i
const ASSET_COLLIDER_PATTERN = /C(\d+)x(\d+)D(-?\d+)x(-?\d+)/gi
const LEGACY_ASSET_FILE_PATTERN = /^Asset_([^_]+)_([^_]+)_(\d+)x(\d+)_([1-9]\d*)x([1-9]\d*)_(\d+)x(\d+)_(-?\d+)x(-?\d+)_(-?\d+)\.[^.]+$/i

export const formatAssetLabel = (value: string) => value
  .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
  .replace(/[-_]+/g, ' ')
  .trim()

const assetDefinitions = Object.entries(spriteModules).flatMap(([path, url]) => {
  const fileName = path.split('/').pop() ?? ''
  const match = fileName.match(ASSET_FILE_PATTERN)

  if (match) {
    const [
      ,
      category,
      name,
      rawFrameWidth,
      rawFrameHeight,
      rawOccupiedColumns,
      rawOccupiedRows,
      rawColliderParameters,
      rawZIndexOffsetY,
      rawWarningColumns,
      rawWarningRows,
      rawWarningOffsetX,
      rawWarningOffsetY,
      rawInteractionColumns,
      rawInteractionRows,
      rawInteractionOffsetX,
      rawInteractionOffsetY,
      rawIconWidth,
      rawIconHeight,
      rawIconOffsetX,
      rawIconOffsetY,
      rawInteractionState,
    ] = match
    const frameHeight = Number(rawFrameHeight)
    const occupiedColumns = Number(rawOccupiedColumns)
    const occupiedRows = Number(rawOccupiedRows)
    const iconWidth = Number(rawIconWidth ?? 128)
    const iconHeight = Number(rawIconHeight ?? 129)
    const colliders = Array.from(rawColliderParameters.matchAll(ASSET_COLLIDER_PATTERN), (colliderMatch) => ({
      width: Number(colliderMatch[1]),
      height: Number(colliderMatch[2]),
      offsetX: Number(colliderMatch[3]),
      offsetY: Number(colliderMatch[4]),
    })).filter((collider) => collider.width > 0 && collider.height > 0)

    return [{
      id: `${category}-${name}${rawInteractionState === undefined ? '' : `-S${rawInteractionState}`}`,
      fileName,
      category,
      name,
      frameWidth: Number(rawFrameWidth),
      frameHeight,
      occupiedColumns,
      occupiedRows,
      colliders,
      zIndexOffsetY: Number(rawZIndexOffsetY),
      warningArea: {
        width: Number(rawWarningColumns ?? occupiedColumns + 4) * 128,
        height: Number(rawWarningRows ?? occupiedRows + 4) * 128,
        offsetX: Number(rawWarningOffsetX ?? 0),
        offsetY: Number(rawWarningOffsetY ?? 0),
      },
      interactionArea: {
        width: Number(rawInteractionColumns ?? occupiedColumns + 2) * 128,
        height: Number(rawInteractionRows ?? occupiedRows + 2) * 128,
        offsetX: Number(rawInteractionOffsetX ?? 0),
        offsetY: Number(rawInteractionOffsetY ?? 0),
      },
      interactionIconContainer: {
        width: iconWidth,
        height: iconHeight,
        offsetX: Number(rawIconOffsetX ?? 0),
        offsetY: Number(rawIconOffsetY ?? -Math.round((frameHeight + iconHeight) / 2)),
      },
      interactionState: rawInteractionState === undefined
        ? undefined
        : Number(rawInteractionState) as 0 | 1,
      url,
    } satisfies RoomEditorAssetDefinition]
  }

  const legacyMatch = fileName.match(LEGACY_ASSET_FILE_PATTERN)
  if (!legacyMatch) {
    console.warn(
      `[room-editor] Se ignoró ${fileName}. Formato esperado: Asset_Categoria_Nombre__AFrameWxHBCellWxH(CWxHDXxY)EIndexY(FWarningWxH)(GWarningXxY)(HInteractionWxH)(IInteractionXxY)(JIconWxH)(KIconXxY)(S0|S1).ext`,
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
  ] = legacyMatch
  const legacyColliderWidth = Number(rawColliderWidth)
  const legacyColliderHeight = Number(rawColliderHeight)
  const frameHeight = Number(rawFrameHeight)
  const occupiedColumns = Number(rawOccupiedColumns)
  const occupiedRows = Number(rawOccupiedRows)

  return [{
    id: `${category}-${name}`,
    fileName,
    category,
    name,
    frameWidth: Number(rawFrameWidth),
    frameHeight,
    occupiedColumns,
    occupiedRows,
    colliders: legacyColliderWidth > 0 && legacyColliderHeight > 0
      ? [{
          width: legacyColliderWidth,
          height: legacyColliderHeight,
          offsetX: Number(rawColliderOffsetX),
          offsetY: Number(rawColliderOffsetY),
        }]
      : [],
    zIndexOffsetY: Number(rawZIndexOffsetY),
    warningArea: {
      width: (occupiedColumns + 4) * 128,
      height: (occupiedRows + 4) * 128,
      offsetX: 0,
      offsetY: 0,
    },
    interactionArea: {
      width: (occupiedColumns + 2) * 128,
      height: (occupiedRows + 2) * 128,
      offsetX: 0,
      offsetY: 0,
    },
    interactionIconContainer: {
      width: 128,
      height: 129,
      offsetX: 0,
      offsetY: -Math.round((frameHeight + 129) / 2),
    },
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
