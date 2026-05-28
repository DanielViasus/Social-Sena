import crockSheet from '../../assets/characters/crock/Crocky.svg'

export interface AvatarTextureDefinition {
  key: string
  row: number
  column: number
}

export interface AvatarPreset {
  id: string
  label: string
  sheetUrl: string
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
}

function createAnimationRow(prefix: string, row: number): AvatarTextureDefinition[] {
  return Array.from({ length: 4 }, (_, column) => ({
    key: `${prefix}-${column}`,
    row,
    column,
  }))
}

const crockPreset: AvatarPreset = {
  id: 'crock',
  label: 'Crock',
  sheetUrl: crockSheet,
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
}

const avatarPresetBySkinId: Record<string, AvatarPreset> = {
  'default-student': crockPreset,
  crock: crockPreset,
  'crock-default': crockPreset,
}

export function resolveAvatarPreset(skinId: string | null | undefined): AvatarPreset {
  const normalizedSkinId = skinId?.trim().toLowerCase() ?? ''
  return avatarPresetBySkinId[normalizedSkinId] ?? crockPreset
}
