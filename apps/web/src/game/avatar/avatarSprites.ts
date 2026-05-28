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
  subtitle: string
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
  subtitle = label,
): AvatarColorOption {
  return {
    id,
    label,
    subtitle,
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
        }, 'Verde de pradera'),
        createPaletteOption('azul-niebla', 'Azul niebla', '#6BB7C9', {
          furPrimary: '#6BB7C9',
          furShadow: '#487E9C',
        }, 'Brisa de laguna'),
        createPaletteOption('rosa-fruta', 'Rosa fruta', '#D87F8B', {
          furPrimary: '#D87F8B',
          furShadow: '#8D4E6F',
        }, 'Fruta del bosque'),
        createPaletteOption('oro-suave', 'Oro suave', '#DDB05C', {
          furPrimary: '#DDB05C',
          furShadow: '#9A7137',
        }, 'Arena del sol'),
        createPaletteOption('violeta', 'Violeta', '#A98BEB', {
          furPrimary: '#A98BEB',
          furShadow: '#6D57A9',
        }, 'Crepusculo violeta'),
        createPaletteOption('jade', 'Jade', '#61C18A', {
          furPrimary: '#61C18A',
          furShadow: '#3B8C62',
        }, 'Jade silvestre'),
        createPaletteOption('coral', 'Coral', '#F28F74', {
          furPrimary: '#F28F74',
          furShadow: '#B45E4A',
        }, 'Coral de verano'),
        createPaletteOption('lima-suave', 'Lima suave', '#A7C96B', {
          furPrimary: '#A7C96B',
          furShadow: '#748F4F',
        }, 'Lima del jardin'),
        createPaletteOption('oceano', 'Oceano', '#5E97C1', {
          furPrimary: '#5E97C1',
          furShadow: '#436A8D',
        }, 'Oceano profundo'),
        createPaletteOption('frambuesa', 'Frambuesa', '#D77DA8', {
          furPrimary: '#D77DA8',
          furShadow: '#935B7B',
        }, 'Frambuesa suave'),
        createPaletteOption('menta-clara', 'Menta clara', '#87D4A2', {
          furPrimary: '#87D4A2',
          furShadow: '#5C9A72',
        }, 'Menta luminosa'),
        createPaletteOption('gris-lunar', 'Gris lunar', '#98A1B0', {
          furPrimary: '#98A1B0',
          furShadow: '#68707E',
        }, 'Gris lunar'),
        createPaletteOption('melon', 'Melon', '#E7A07C', {
          furPrimary: '#E7A07C',
          furShadow: '#A86D58',
        }, 'Melon suave'),
        createPaletteOption('uva-bruma', 'Uva bruma', '#B89FD8', {
          furPrimary: '#B89FD8',
          furShadow: '#7F6E9A',
        }, 'Uva en bruma'),
      ],
    },
    {
      id: 'detail',
      label: 'Detalle',
      defaultOptionId: 'crema',
      options: [
        createPaletteOption('crema', 'Crema', '#F7FFCC', {
          detailSecondary: '#F7FFCC',
        }, 'Crema suave'),
        createPaletteOption('menta', 'Menta', '#D6FFD8', {
          detailSecondary: '#D6FFD8',
        }, 'Menta fresca'),
        createPaletteOption('cielo', 'Cielo', '#D4ECFF', {
          detailSecondary: '#D4ECFF',
        }, 'Cielo liviano'),
        createPaletteOption('rosa', 'Rosa', '#FFD9E8', {
          detailSecondary: '#FFD9E8',
        }, 'Rosa ligera'),
        createPaletteOption('lavanda', 'Lavanda', '#E8DEFF', {
          detailSecondary: '#E8DEFF',
        }, 'Lavanda suave'),
        createPaletteOption('melocoton', 'Melocoton', '#FFE2C2', {
          detailSecondary: '#FFE2C2',
        }, 'Melocoton claro'),
        createPaletteOption('oro-palido', 'Oro palido', '#FBE7A6', {
          detailSecondary: '#FBE7A6',
        }, 'Oro palido'),
        createPaletteOption('hielo', 'Hielo', '#E8F8FF', {
          detailSecondary: '#E8F8FF',
        }, 'Hielo brillante'),
        createPaletteOption('mantequilla', 'Mantequilla', '#FFF3AE', {
          detailSecondary: '#FFF3AE',
        }, 'Mantequilla clara'),
        createPaletteOption('uva-hielo', 'Uva hielo', '#ECE4FF', {
          detailSecondary: '#ECE4FF',
        }, 'Uva de nieve'),
        createPaletteOption('aguamarina', 'Aguamarina', '#D7FFF5', {
          detailSecondary: '#D7FFF5',
        }, 'Aguamarina fresca'),
        createPaletteOption('limon', 'Limon', '#F7FFAE', {
          detailSecondary: '#F7FFAE',
        }, 'Limon claro'),
        createPaletteOption('algodon', 'Algodon', '#FFF4FB', {
          detailSecondary: '#FFF4FB',
        }, 'Algodon rosado'),
      ],
    },
    {
      id: 'face',
      label: 'Rostro',
      defaultOptionId: 'piel-suave',
      options: [
        createPaletteOption('piel-suave', 'Piel suave', '#DFB292', {
          face: '#DFB292',
        }, 'Piel suave'),
        createPaletteOption('piel-calida', 'Piel calida', '#C98A61', {
          face: '#C98A61',
        }, 'Tono calido'),
        createPaletteOption('piel-canela', 'Piel canela', '#A86A45', {
          face: '#A86A45',
        }, 'Canela tostada'),
        createPaletteOption('piel-clara', 'Piel clara', '#F1CBB2', {
          face: '#F1CBB2',
        }, 'Piel clara'),
        createPaletteOption('piel-oliva', 'Piel oliva', '#C4A07A', {
          face: '#C4A07A',
        }, 'Oliva suave'),
        createPaletteOption('piel-miel', 'Piel miel', '#D2A178', {
          face: '#D2A178',
        }, 'Miel dorada'),
        createPaletteOption('piel-arena', 'Piel arena', '#E6BC96', {
          face: '#E6BC96',
        }, 'Arena tibia'),
        createPaletteOption('piel-bronce', 'Piel bronce', '#B7845E', {
          face: '#B7845E',
        }, 'Bronce suave'),
        createPaletteOption('piel-porcelana', 'Piel porcelana', '#F0D8C8', {
          face: '#F0D8C8',
        }, 'Porcelana clara'),
        createPaletteOption('piel-caoba', 'Piel caoba', '#8E5F45', {
          face: '#8E5F45',
        }, 'Caoba profunda'),
        createPaletteOption('piel-caramelo', 'Piel caramelo', '#C18E67', {
          face: '#C18E67',
        }, 'Caramelo suave'),
        createPaletteOption('piel-lino', 'Piel lino', '#EBC9B0', {
          face: '#EBC9B0',
        }, 'Lino claro'),
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
        }, 'Atardecer clasico'),
        createPaletteOption('ambar', 'Ambar', '#E3B45F', {
          furPrimary: '#E3B45F',
          furShadow: '#C79A4B',
          furSecondary: '#DAB483',
          outerEar: '#6B5122',
          innerEar: '#92714A',
        }, 'Ambar dorado'),
        createPaletteOption('rubi', 'Rubi', '#E07C6D', {
          furPrimary: '#E07C6D',
          furShadow: '#C96E69',
          furSecondary: '#E2A29C',
          outerEar: '#6E2D2D',
          innerEar: '#9E5757',
        }, 'Rubi encendido'),
        createPaletteOption('ciruela', 'Ciruela', '#BF95E0', {
          furPrimary: '#BF95E0',
          furShadow: '#A27BC4',
          furSecondary: '#C2AFDA',
          outerEar: '#4C355F',
          innerEar: '#7A5D92',
        }, 'Ciruela de medianoche'),
        createPaletteOption('menta', 'Menta', '#7FD4B4', {
          furPrimary: '#7FD4B4',
          furShadow: '#65B596',
          furSecondary: '#A6D4C2',
          outerEar: '#2E5D50',
          innerEar: '#4C7F74',
        }, 'Menta de bosque'),
        createPaletteOption('cobre', 'Cobre', '#D78654', {
          furPrimary: '#D78654',
          furShadow: '#BA7149',
          furSecondary: '#D8AD93',
          outerEar: '#5C311D',
          innerEar: '#8D5740',
        }, 'Cobre sereno'),
        createPaletteOption('noche', 'Noche', '#6D7FB8', {
          furPrimary: '#6D7FB8',
          furShadow: '#5A6B9D',
          furSecondary: '#9AA8D2',
          outerEar: '#2A3458',
          innerEar: '#4A5F89',
        }, 'Noche serena'),
        createPaletteOption('aurora', 'Aurora', '#F3A3A3', {
          furPrimary: '#F3A3A3',
          furShadow: '#D88B8B',
          furSecondary: '#E9B8B8',
          outerEar: '#704444',
          innerEar: '#A36464',
        }, 'Aurora rosada'),
        createPaletteOption('bruma', 'Bruma', '#9AA7C8', {
          furPrimary: '#9AA7C8',
          furShadow: '#7F8DAE',
          furSecondary: '#B9C2D9',
          outerEar: '#414B68',
          innerEar: '#657294',
        }, 'Bruma del alba'),
        createPaletteOption('musgo', 'Musgo', '#8DAE7A', {
          furPrimary: '#8DAE7A',
          furShadow: '#759260',
          furSecondary: '#ACC09E',
          outerEar: '#415032',
          innerEar: '#65784D',
        }, 'Musgo templado'),
        createPaletteOption('mandarina', 'Mandarina', '#F2A067', {
          furPrimary: '#F2A067',
          furShadow: '#D28656',
          furSecondary: '#E4B08D',
          outerEar: '#694022',
          innerEar: '#925E43',
        }, 'Mandarina suave'),
        createPaletteOption('petalo', 'Petalo', '#E7A1BE', {
          furPrimary: '#E7A1BE',
          furShadow: '#C889A1',
          furSecondary: '#E6BDD0',
          outerEar: '#6B3D52',
          innerEar: '#9B6078',
        }, 'Petalo rosado'),
        createPaletteOption('tormenta', 'Tormenta', '#7E8CA9', {
          furPrimary: '#7E8CA9',
          furShadow: '#66718B',
          furSecondary: '#ADB8CD',
          outerEar: '#364053',
          innerEar: '#56637E',
        }, 'Tormenta gris'),
        createPaletteOption('miel', 'Miel', '#E7A95E', {
          furPrimary: '#E7A95E',
          furShadow: '#C68B50',
          furSecondary: '#E2B688',
          outerEar: '#6A4325',
          innerEar: '#986348',
        }, 'Miel suave'),
        createPaletteOption('lavanda-fox', 'Lavanda fox', '#C29BDD', {
          furPrimary: '#C29BDD',
          furShadow: '#A07FBC',
          furSecondary: '#CFB8E2',
          outerEar: '#533867',
          innerEar: '#7E5A96',
        }, 'Lavanda serena'),
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
        }, 'Blanco luminoso'),
        createPaletteOption('crema', 'Crema', '#FFF0D0', {
          furWhitePrimary: '#FFF0D0',
          furWhiteShadow: '#D8C7A3',
        }, 'Crema suave'),
        createPaletteOption('cielo', 'Cielo', '#D8EEFF', {
          furWhitePrimary: '#D8EEFF',
          furWhiteShadow: '#97B9D8',
        }, 'Cielo polar'),
        createPaletteOption('rosa', 'Rosa', '#FFE1F1', {
          furWhitePrimary: '#FFE1F1',
          furWhiteShadow: '#D7AFC2',
        }, 'Rosa nacar'),
        createPaletteOption('vainilla', 'Vainilla', '#FFF7D9', {
          furWhitePrimary: '#FFF7D9',
          furWhiteShadow: '#D4CBA4',
        }, 'Vainilla ligera'),
        createPaletteOption('perla', 'Perla', '#ECECF6', {
          furWhitePrimary: '#ECECF6',
          furWhiteShadow: '#B9B9C8',
        }, 'Perla suave'),
        createPaletteOption('marfil', 'Marfil', '#FFF4DD', {
          furWhitePrimary: '#FFF4DD',
          furWhiteShadow: '#D9C7A5',
        }, 'Marfil tibio'),
        createPaletteOption('neblina', 'Neblina', '#E6EAF5', {
          furWhitePrimary: '#E6EAF5',
          furWhiteShadow: '#B0B7CB',
        }, 'Neblina tenue'),
        createPaletteOption('espuma', 'Espuma', '#F2FBFF', {
          furWhitePrimary: '#F2FBFF',
          furWhiteShadow: '#B9CFD8',
        }, 'Espuma marina'),
        createPaletteOption('durazno-nieve', 'Durazno nieve', '#FFF0E6', {
          furWhitePrimary: '#FFF0E6',
          furWhiteShadow: '#D6BBAA',
        }, 'Durazno nevado'),
        createPaletteOption('lila-hielo', 'Lila hielo', '#F1EEFF', {
          furWhitePrimary: '#F1EEFF',
          furWhiteShadow: '#BAB4D1',
        }, 'Lila helado'),
        createPaletteOption('arena-nieve', 'Arena nieve', '#FFF4E9', {
          furWhitePrimary: '#FFF4E9',
          furWhiteShadow: '#D8C0B0',
        }, 'Arena nevada'),
        createPaletteOption('menta-nieve', 'Menta nieve', '#EEFFF9', {
          furWhitePrimary: '#EEFFF9',
          furWhiteShadow: '#B4D6CD',
        }, 'Menta de nieve'),
      ],
    },
    {
      id: 'face',
      label: 'Rostro',
      defaultOptionId: 'piel-suave',
      options: [
        createPaletteOption('piel-suave', 'Piel suave', '#B47B54', {
          muzzleBright: '#DFB292',
        }, 'Rostro suave'),
        createPaletteOption('piel-calida', 'Piel calida', '#C58A62', {
          muzzleBright: '#F0C09E',
        }, 'Calido durazno'),
        createPaletteOption('piel-canela', 'Piel canela', '#9A653D', {
          muzzleBright: '#C88B61',
        }, 'Canela tostada'),
        createPaletteOption('piel-clara', 'Piel clara', '#C9A083', {
          muzzleBright: '#F4D6C4',
        }, 'Clara de alba'),
        createPaletteOption('piel-miel', 'Piel miel', '#AD7B59', {
          muzzleBright: '#E6B896',
        }, 'Miel dorada'),
        createPaletteOption('durazno', 'Durazno', '#C59273', {
          muzzleBright: '#F2C9AF',
        }, 'Durazno claro'),
        createPaletteOption('avellana', 'Avellana', '#9B735B', {
          muzzleBright: '#D9B093',
        }, 'Avellana suave'),
        createPaletteOption('almendra', 'Almendra', '#B68A70', {
          muzzleBright: '#EBC3AB',
        }, 'Almendra tibia'),
        createPaletteOption('toffee', 'Toffee', '#8D654F', {
          muzzleBright: '#CFA283',
        }, 'Toffee suave'),
        createPaletteOption('avena', 'Avena', '#C7A48C', {
          muzzleBright: '#F1D6C7',
        }, 'Avena clara'),
        createPaletteOption('crema-fox', 'Crema fox', '#D3A78A', {
          muzzleBright: '#F4D4BE',
        }, 'Crema tostada'),
        createPaletteOption('cacao-claro', 'Cacao claro', '#A77B61', {
          muzzleBright: '#DAB496',
        }, 'Cacao claro'),
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
