import crockIdle0 from '../../assets/characters/crock/crock_idle_0.svg'
import crockIdle1 from '../../assets/characters/crock/crock_idle_1.svg'
import crockIdle2 from '../../assets/characters/crock/crock_idle_2.svg'
import crockIdle3 from '../../assets/characters/crock/crock_idle_3.svg'
import crockBackIdle0 from '../../assets/characters/crock/crockBack_Idle_0.svg'
import crockBackIdle1 from '../../assets/characters/crock/crockBack_Idle_1.svg'
import crockBackIdle2 from '../../assets/characters/crock/crockBack_Idle_2.svg'
import crockBackIdle3 from '../../assets/characters/crock/crockBack_Idle_3.svg'
import crockWalk0 from '../../assets/characters/crock/crock_walk_0.svg'
import crockWalk1 from '../../assets/characters/crock/crock_walk_1.svg'
import crockWalk2 from '../../assets/characters/crock/crock_walk_2.svg'
import crockWalk3 from '../../assets/characters/crock/crock_walk_3.svg'
import crockBackWalk0 from '../../assets/characters/crock/crockBack_walk_0.svg'
import crockBackWalk1 from '../../assets/characters/crock/crockBack_walk_1.svg'
import crockBackWalk2 from '../../assets/characters/crock/crockBack_walk_2.svg'
import crockBackWalk3 from '../../assets/characters/crock/crockBack_walk_3.svg'

export interface AvatarTextureDefinition {
  key: string
  url: string
}

export interface AvatarPreset {
  id: string
  label: string
  scale: number
  idleFrames: AvatarTextureDefinition[]
  idleBackFrames?: AvatarTextureDefinition[]
  walkFrames: AvatarTextureDefinition[]
  walkBackFrames?: AvatarTextureDefinition[]
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
  idleBackFrames: [
    { key: 'avatar-crock-back-idle-0', url: crockBackIdle0 },
    { key: 'avatar-crock-back-idle-1', url: crockBackIdle1 },
    { key: 'avatar-crock-back-idle-2', url: crockBackIdle2 },
    { key: 'avatar-crock-back-idle-3', url: crockBackIdle3 },
  ],
  walkFrames: [
    { key: 'avatar-crock-walk-0', url: crockWalk0 },
    { key: 'avatar-crock-walk-1', url: crockWalk1 },
    { key: 'avatar-crock-walk-2', url: crockWalk2 },
    { key: 'avatar-crock-walk-3', url: crockWalk3 },
  ],
  walkBackFrames: [
    { key: 'avatar-crock-back-walk-0', url: crockBackWalk0 },
    { key: 'avatar-crock-back-walk-1', url: crockBackWalk1 },
    { key: 'avatar-crock-back-walk-2', url: crockBackWalk2 },
    { key: 'avatar-crock-back-walk-3', url: crockBackWalk3 },
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

