import crockIdle0 from '../../assets/characters/crock/crock_idle_0.svg'
import crockIdle1 from '../../assets/characters/crock/crock_idle_1.svg'
import crockIdle2 from '../../assets/characters/crock/crock_idle_2.svg'
import crockIdle3 from '../../assets/characters/crock/crock_idle_3.svg'
import crockWalk0 from '../../assets/characters/crock/crock_walk_0.svg'
import crockWalk1 from '../../assets/characters/crock/crock_walk_1.svg'
import crockWalk2 from '../../assets/characters/crock/crock_walk_2.svg'
import crockWalk3 from '../../assets/characters/crock/crock_walk_3.svg'

export interface AvatarTextureDefinition {
  key: string
  url: string
}

export interface AvatarPreset {
  id: string
  label: string
  scale: number
  idleFrames: AvatarTextureDefinition[]
  walkFrames: AvatarTextureDefinition[]
}

const crockPreset: AvatarPreset = {
  id: 'crock',
  label: 'Crock',
  scale: 4,
  idleFrames: [
    { key: 'avatar-crock-idle-0', url: crockIdle0 },
    { key: 'avatar-crock-idle-1', url: crockIdle1 },
    { key: 'avatar-crock-idle-2', url: crockIdle2 },
    { key: 'avatar-crock-idle-3', url: crockIdle3 },
  ],
  walkFrames: [
    { key: 'avatar-crock-walk-0', url: crockWalk0 },
    { key: 'avatar-crock-walk-1', url: crockWalk1 },
    { key: 'avatar-crock-walk-2', url: crockWalk2 },
    { key: 'avatar-crock-walk-3', url: crockWalk3 },
  ],
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

export const avatarTextureEntries: AvatarTextureDefinition[] = Array.from(
  new Map(
    [crockPreset]
      .flatMap((preset) => [...preset.idleFrames, ...preset.walkFrames])
      .map((texture) => [texture.key, texture]),
  ).values(),
)
