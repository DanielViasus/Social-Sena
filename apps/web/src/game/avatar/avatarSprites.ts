import crockSheet from '../../assets/characters/crock/Crocky.svg'
import crockSheetRaw from '../../assets/characters/crock/Crocky.svg?raw'
import foxySheet from '../../assets/characters/foxy/Foxy.svg'
import foxySheetRaw from '../../assets/characters/foxy/Foxy.svg?raw'

export interface AvatarTextureDefinition {
  key: string
  row: number
  column: number
}

export type AvatarColorSelections = Record<string, string>
export type AvatarSourceColorMap = Record<string, string>

export interface AvatarColorOption {
  id: string
  label: string
  swatch: string
  replacements: Record<string, string>
}

export interface AvatarColorSlot {
  id: string
  label: string
  defaultOptionId: string
  options: AvatarColorOption[]
}

export interface AvatarPreset {
  id: string
  label: string
  sheetUrl: string
  rawSvgSource: string
  sheetWidth: number
  sheetHeight: number
  frameWidth: number
  frameHeight: number
  totalColumns: number
  totalRows: number
  idleFrames: AvatarTextureDefinition[]
  idleBackFrames?: AvatarTextureDefinition[]
  walkFrames: AvatarTextureDefinition[]
  walkBackFrames?: AvatarTextureDefinition[]
  sourceColors: AvatarSourceColorMap
  colorSlots: AvatarColorSlot[]
}

function createAnimationRow(prefix: string, row: number): AvatarTextureDefinition[] {
  return Array.from({ length: 4 }, (_, column) => ({
    key: `${prefix}-${column}`,
    row,
    column,
  }))
}

function createPaletteOption(
  id: string,
  label: string,
  swatch: string,
  replacements: Record<string, string>,
): AvatarColorOption {
  return {
    id,
    label,
    swatch,
    replacements,
  }
}

function normalizeHex(color: string) {
  return color.trim().toUpperCase()
}

const crockSourceColors: AvatarSourceColorMap = {
  furPrimary: '#80A879',
  furShadow: '#637F5F',
  detailSecondary: '#F7FFCC',
  face: '#DFB292',
  shadowOverlay: '#3D3D3D',
  eyeColor: '#2A2A2A',
  accentRed: '#FF383C',
}

const foxySourceColors: AvatarSourceColorMap = {
  furPrimary: '#F5995B',
  furShadow: '#DD8D57',
  furSecondary: '#B47B54',
  furWhitePrimary: '#F6F6F6',
  furWhiteShadow: '#A8A8A8',
  face: '#B47B54',
  shadowOverlay: '#3D3D3D',
  outerEar: '#563E1A',
  innerEar: '#7C4444',
  muzzleBright: '#DFB292',
  eyeColor: '#333333',
  eyeShine: '#FFFFFF',
  blush: '#FBCBCE',
}

const crockPreset: AvatarPreset = {
  id: 'crock',
  label: 'Crock',
  sheetUrl: crockSheet,
  rawSvgSource: crockSheetRaw,
  sheetWidth: 512,
  sheetHeight: 1280,
  frameWidth: 128,
  frameHeight: 128,
  totalColumns: 4,
  totalRows: 10,
  idleFrames: createAnimationRow('avatar-crock-idle', 0),
  walkFrames: createAnimationRow('avatar-crock-walk', 1),
  idleBackFrames: createAnimationRow('avatar-crock-back-idle', 2),
  walkBackFrames: createAnimationRow('avatar-crock-back-walk', 3),
  sourceColors: crockSourceColors,
  colorSlots: [
    {
      id: 'fur',
      label: 'Pelaje',
      defaultOptionId: 'verde-base',
      options: [
        createPaletteOption('verde-base', 'Verde base', '#80A879', {
          furPrimary: '#80A879',
          furShadow: '#637F5F',
        }),
        createPaletteOption('azul-niebla', 'Azul niebla', '#6BB7C9', {
          furPrimary: '#6BB7C9',
          furShadow: '#487E9C',
        }),
        createPaletteOption('rosa-fruta', 'Rosa fruta', '#D87F8B', {
          furPrimary: '#D87F8B',
          furShadow: '#8D4E6F',
        }),
        createPaletteOption('oro-suave', 'Oro suave', '#DDB05C', {
          furPrimary: '#DDB05C',
          furShadow: '#9A7137',
        }),
        createPaletteOption('violeta', 'Violeta', '#A98BEB', {
          furPrimary: '#A98BEB',
          furShadow: '#6D57A9',
        }),
        createPaletteOption('jade', 'Jade', '#61C18A', {
          furPrimary: '#61C18A',
          furShadow: '#3B8C62',
        }),
        createPaletteOption('coral', 'Coral', '#F28F74', {
          furPrimary: '#F28F74',
          furShadow: '#B45E4A',
        }),
      ],
    },
    {
      id: 'detail',
      label: 'Detalle',
      defaultOptionId: 'crema',
      options: [
        createPaletteOption('crema', 'Crema', '#F7FFCC', {
          detailSecondary: '#F7FFCC',
        }),
        createPaletteOption('menta', 'Menta', '#D6FFD8', {
          detailSecondary: '#D6FFD8',
        }),
        createPaletteOption('cielo', 'Cielo', '#D4ECFF', {
          detailSecondary: '#D4ECFF',
        }),
        createPaletteOption('rosa', 'Rosa', '#FFD9E8', {
          detailSecondary: '#FFD9E8',
        }),
        createPaletteOption('lavanda', 'Lavanda', '#E8DEFF', {
          detailSecondary: '#E8DEFF',
        }),
        createPaletteOption('melocoton', 'Melocoton', '#FFE2C2', {
          detailSecondary: '#FFE2C2',
        }),
      ],
    },
    {
      id: 'face',
      label: 'Rostro',
      defaultOptionId: 'piel-suave',
      options: [
        createPaletteOption('piel-suave', 'Piel suave', '#DFB292', {
          face: '#DFB292',
        }),
        createPaletteOption('piel-calida', 'Piel calida', '#C98A61', {
          face: '#C98A61',
        }),
        createPaletteOption('piel-canela', 'Piel canela', '#A86A45', {
          face: '#A86A45',
        }),
        createPaletteOption('piel-clara', 'Piel clara', '#F1CBB2', {
          face: '#F1CBB2',
        }),
        createPaletteOption('piel-oliva', 'Piel oliva', '#C4A07A', {
          face: '#C4A07A',
        }),
      ],
    },
  ],
}

const foxyPreset: AvatarPreset = {
  id: 'foxy',
  label: 'Foxy',
  sheetUrl: foxySheet,
  rawSvgSource: foxySheetRaw,
  sheetWidth: 512,
  sheetHeight: 1280,
  frameWidth: 128,
  frameHeight: 128,
  totalColumns: 4,
  totalRows: 10,
  idleFrames: createAnimationRow('avatar-foxy-idle', 0),
  walkFrames: createAnimationRow('avatar-foxy-walk', 1),
  idleBackFrames: createAnimationRow('avatar-foxy-back-idle', 2),
  walkBackFrames: createAnimationRow('avatar-foxy-back-walk', 3),
  sourceColors: foxySourceColors,
  colorSlots: [
    {
      id: 'fur',
      label: 'Pelaje',
      defaultOptionId: 'naranja-base',
      options: [
        createPaletteOption('naranja-base', 'Naranja base', '#F5995B', {
          furPrimary: '#F5995B',
          furShadow: '#DD8D57',
          furSecondary: '#D99A74',
          outerEar: '#563E1A',
          innerEar: '#7C4444',
        }),
        createPaletteOption('ambar', 'Ambar', '#E3B45F', {
          furPrimary: '#E3B45F',
          furShadow: '#C79A4B',
          furSecondary: '#DAB483',
          outerEar: '#6B5122',
          innerEar: '#92714A',
        }),
        createPaletteOption('rubi', 'Rubi', '#E07C6D', {
          furPrimary: '#E07C6D',
          furShadow: '#C96E69',
          furSecondary: '#E2A29C',
          outerEar: '#6E2D2D',
          innerEar: '#9E5757',
        }),
        createPaletteOption('ciruela', 'Ciruela', '#BF95E0', {
          furPrimary: '#BF95E0',
          furShadow: '#A27BC4',
          furSecondary: '#C2AFDA',
          outerEar: '#4C355F',
          innerEar: '#7A5D92',
        }),
        createPaletteOption('menta', 'Menta', '#7FD4B4', {
          furPrimary: '#7FD4B4',
          furShadow: '#65B596',
          furSecondary: '#A6D4C2',
          outerEar: '#2E5D50',
          innerEar: '#4C7F74',
        }),
        createPaletteOption('cobre', 'Cobre', '#D78654', {
          furPrimary: '#D78654',
          furShadow: '#BA7149',
          furSecondary: '#D8AD93',
          outerEar: '#5C311D',
          innerEar: '#8D5740',
        }),
        createPaletteOption('noche', 'Noche', '#6D7FB8', {
          furPrimary: '#6D7FB8',
          furShadow: '#5A6B9D',
          furSecondary: '#9AA8D2',
          outerEar: '#2A3458',
          innerEar: '#4A5F89',
        }),
      ],
    },
    {
      id: 'fur-white',
      label: 'Pelaje blanco',
      defaultOptionId: 'blanco-base',
      options: [
        createPaletteOption('blanco-base', 'Blanco base', '#F6F6F6', {
          furWhitePrimary: '#F6F6F6',
          furWhiteShadow: '#A8A8A8',
        }),
        createPaletteOption('crema', 'Crema', '#FFF0D0', {
          furWhitePrimary: '#FFF0D0',
          furWhiteShadow: '#D8C7A3',
        }),
        createPaletteOption('cielo', 'Cielo', '#D8EEFF', {
          furWhitePrimary: '#D8EEFF',
          furWhiteShadow: '#97B9D8',
        }),
        createPaletteOption('rosa', 'Rosa', '#FFE1F1', {
          furWhitePrimary: '#FFE1F1',
          furWhiteShadow: '#D7AFC2',
        }),
        createPaletteOption('vainilla', 'Vainilla', '#FFF7D9', {
          furWhitePrimary: '#FFF7D9',
          furWhiteShadow: '#D4CBA4',
        }),
        createPaletteOption('perla', 'Perla', '#ECECF6', {
          furWhitePrimary: '#ECECF6',
          furWhiteShadow: '#B9B9C8',
        }),
      ],
    },
    {
      id: 'face',
      label: 'Rostro',
      defaultOptionId: 'piel-suave',
      options: [
        createPaletteOption('piel-suave', 'Piel suave', '#B47B54', {
          muzzleBright: '#DFB292',
        }),
        createPaletteOption('piel-calida', 'Piel calida', '#C58A62', {
          muzzleBright: '#F0C09E',
        }),
        createPaletteOption('piel-canela', 'Piel canela', '#9A653D', {
          muzzleBright: '#C88B61',
        }),
        createPaletteOption('piel-clara', 'Piel clara', '#C9A083', {
          muzzleBright: '#F4D6C4',
        }),
        createPaletteOption('piel-miel', 'Piel miel', '#AD7B59', {
          muzzleBright: '#E6B896',
        }),
      ],
    },
  ],
}

const avatarPresetBySkinId: Record<string, AvatarPreset> = {
  'default-student': crockPreset,
  crock: crockPreset,
  'crock-default': crockPreset,
  foxy: foxyPreset,
  'foxy-default': foxyPreset,
}

const avatarPresets = [crockPreset, foxyPreset]
const recoloredSheetUrlCache = new Map<string, string>()

function findColorOption(slot: AvatarColorSlot, optionId: string | undefined) {
  return (
    slot.options.find((option) => option.id === optionId) ??
    slot.options.find((option) => option.id === slot.defaultOptionId) ??
    slot.options[0]
  )
}

export function getDefaultAvatarColorSelections(preset: AvatarPreset): AvatarColorSelections {
  return Object.fromEntries(preset.colorSlots.map((slot) => [slot.id, slot.defaultOptionId]))
}

export function normalizeAvatarColorSelections(
  preset: AvatarPreset,
  selections: AvatarColorSelections | null | undefined,
): AvatarColorSelections {
  return Object.fromEntries(
    preset.colorSlots.map((slot) => {
      const option = findColorOption(slot, selections?.[slot.id])
      return [slot.id, option.id]
    }),
  )
}

function hasDefaultAvatarColors(preset: AvatarPreset, selections: AvatarColorSelections) {
  return preset.colorSlots.every((slot) => selections[slot.id] === slot.defaultOptionId)
}

function buildAvatarReplacementMap(preset: AvatarPreset, selections: AvatarColorSelections) {
  const replacements = new Map<string, string>()

  preset.colorSlots.forEach((slot) => {
    const option = findColorOption(slot, selections[slot.id])
    Object.entries(option.replacements).forEach(([sourceColorId, targetColor]) => {
      const sourceColor = preset.sourceColors[sourceColorId]
      if (!sourceColor) {
        return
      }

      replacements.set(normalizeHex(sourceColor), targetColor)
    })
  })

  return replacements
}

export function resolveAvatarSheetUrl(
  preset: AvatarPreset,
  selections: AvatarColorSelections | null | undefined,
) {
  const normalizedSelections = normalizeAvatarColorSelections(preset, selections)
  if (hasDefaultAvatarColors(preset, normalizedSelections)) {
    return preset.sheetUrl
  }

  const cacheKey = `${preset.id}:${JSON.stringify(normalizedSelections)}`
  const cachedUrl = recoloredSheetUrlCache.get(cacheKey)
  if (cachedUrl) {
    return cachedUrl
  }

  const replacements = buildAvatarReplacementMap(preset, normalizedSelections)
  let nextSvgSource = preset.rawSvgSource

  replacements.forEach((targetColor, sourceColor) => {
    const escapedSourceColor = sourceColor.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    nextSvgSource = nextSvgSource.replace(new RegExp(escapedSourceColor, 'gi'), targetColor)
  })

  const blob = new Blob([nextSvgSource], { type: 'image/svg+xml;charset=utf-8' })
  const objectUrl = URL.createObjectURL(blob)
  recoloredSheetUrlCache.set(cacheKey, objectUrl)
  return objectUrl
}

export function getAvailableAvatarPresets(): AvatarPreset[] {
  return avatarPresets
}

export function resolveAvatarPreset(skinId: string | null | undefined): AvatarPreset {
  const normalizedSkinId = skinId?.trim().toLowerCase() ?? ''
  return avatarPresetBySkinId[normalizedSkinId] ?? crockPreset
}
