import { z } from 'zod'
import { WORLD_HEIGHT, WORLD_WIDTH } from './constants'
import { DEFAULT_AUDIO_SETTINGS, DEFAULT_USER_ROLE, USER_ROLES } from './types'

export const directionSchema = z.enum(['up', 'down', 'left', 'right'])
export const skinColorSelectionsSchema = z.record(z.string().trim().min(1), z.string().trim().min(1))
export const audioSettingsSchema = z.object({
  musicEnabled: z.boolean(),
  musicVolume: z.number().min(0).max(1),
  sfxEnabled: z.boolean(),
  sfxVolume: z.number().min(0).max(1),
})
export const inventoryMetadataValueSchema = z.union([z.string(), z.number(), z.boolean(), z.null()])
export const inventoryItemMetadataSchema = z.record(z.string().trim().min(1), inventoryMetadataValueSchema)
export const inventoryItemStateSchema = z.object({
  quantity: z.number().int().min(0),
  metadata: inventoryItemMetadataSchema.optional(),
})
export const playerInventorySchema = z.record(z.string().trim().min(1), inventoryItemStateSchema)
export const positionSchema = z.object({
  x: z.number().min(0).max(WORLD_WIDTH),
  y: z.number().min(0).max(WORLD_HEIGHT),
})

export const userProfileSchema = z.object({
  userId: z.string().min(1),
  username: z.string().min(1),
  displayName: z.string().min(1),
  role: z.enum(USER_ROLES).default(DEFAULT_USER_ROLE),
  skinId: z.string().min(1),
  skinColors: skinColorSelectionsSchema.default({}),
  audioSettings: audioSettingsSchema.default(DEFAULT_AUDIO_SETTINGS),
})

export const connectToGameSchema = z.object({
  token: z.string().optional(),
  profile: userProfileSchema,
})

export const completeOnboardingSchema = z.object({
  skinId: z.string().trim().min(1),
  skinColors: skinColorSelectionsSchema.optional(),
})

export const joinRoomSchema = z.object({
  roomId: z.string().min(1).optional(),
  templateId: z.string().min(1),
  spawnPosition: positionSchema.optional(),
  transition: z.enum(['direct', 'teleport', 'follow-leader']).optional(),
})

export const navigateToSchema = z.object({
  roomId: z.string().min(1),
  target: positionSchema,
})

export const stopNavigationSchema = z.object({
  roomId: z.string().min(1),
})

export const movementInputSchema = z.object({
  roomId: z.string().min(1),
  up: z.boolean(),
  down: z.boolean(),
  left: z.boolean(),
  right: z.boolean(),
})

export const updateSkinSchema = z.object({
  roomId: z.string().min(1),
  skinId: z.string().trim().min(1),
  skinColors: skinColorSelectionsSchema.optional(),
})

export const updateAccessRoleSchema = z.object({
  role: z.enum(USER_ROLES),
})

export const roomEditorLayerSchema = z.object({
  id: z.string().trim().min(1).max(80),
  name: z.string().trim().min(1).max(80),
  collidersEnabled: z.boolean(),
  required: z.boolean().optional(),
})

export const roomEditorPlacementSchema = z.object({
  layerId: z.string().trim().min(1).max(80),
  assetId: z.string().trim().min(1).max(240),
  cellX: z.number().int().min(0).max(49),
  cellY: z.number().int().min(0).max(49),
  flippedX: z.boolean(),
})

export const roomEditorAssetSchema = z.object({
  id: z.string().trim().min(1).max(240),
  category: z.string().trim().min(1).max(80),
  frameWidth: z.number().int().min(1).max(4096),
  frameHeight: z.number().int().min(1).max(4096),
  occupiedColumns: z.number().int().min(1).max(32),
  occupiedRows: z.number().int().min(1).max(32),
  colliderWidth: z.number().int().min(0).max(4096),
  colliderHeight: z.number().int().min(0).max(4096),
  colliderOffsetX: z.number().int().min(-4096).max(4096),
  colliderOffsetY: z.number().int().min(-4096).max(4096),
  zIndexOffsetY: z.number().int().min(-4096).max(4096),
})

export const roomEditorSpawnPointSchema = z.object({
  id: z.string().trim().min(1).max(80),
  cellX: z.number().int().min(0).max(49),
  cellY: z.number().int().min(0).max(49),
  entryKey: z.string().trim().min(1).max(80).optional(),
})

export const roomEditorDocumentSchema = z.object({
  version: z.literal(1),
  gridWidth: z.number().int().min(1).max(50),
  gridHeight: z.number().int().min(1).max(50),
  layers: z.array(roomEditorLayerSchema).min(1).max(40),
  placements: z.array(roomEditorPlacementSchema).max(10000),
  assets: z.array(roomEditorAssetSchema).max(1000).default([]),
  // Se conserva como colección para admitir varias entradas en el futuro.
  // El editor actual limita la creación a un único punto predeterminado.
  spawnPoints: z.array(roomEditorSpawnPointSchema).max(20).default([]),
})

export const saveRoomEditorMapSchema = z.object({
  code: z.string().trim().regex(/^[A-Z0-9]{12,24}$/).optional(),
  name: z.string().trim().min(1).max(80),
  document: roomEditorDocumentSchema,
  publication: z.discriminatedUnion('kind', [
    z.object({
      kind: z.literal('system'),
      routeSlug: z.string().trim().regex(/^[A-Za-z][A-Za-z0-9_-]{1,47}$/),
      classCode: z.string().trim().min(2).max(40),
    }),
    z.object({
      kind: z.literal('classroom'),
      classCode: z.string().trim().min(2).max(40),
    }),
    z.object({
      kind: z.enum(['room', 'event', 'official']),
      accessCode: z.string().trim().min(2).max(40),
    }),
  ]).optional(),
})

export const loadRoomEditorMapSchema = z.object({
  code: z.string().trim().toUpperCase().regex(/^[A-Z0-9]{12,24}$/),
})

export const updateAudioSettingsSchema = z.object({
  audioSettings: audioSettingsSchema,
})

export const updateInventorySchema = z.object({
  inventory: playerInventorySchema,
})

export const addFriendSchema = z.object({
  friendUserId: z.string().trim().min(1),
})

export const respondFriendRequestSchema = z.object({
  requestId: z.string().trim().min(1),
  action: z.enum(['accept', 'reject']),
})

export const removeFriendSchema = z.object({
  friendUserId: z.string().trim().min(1),
})

export const inviteToPartySchema = z.object({
  friendUserId: z.string().trim().min(1),
})

export const respondPartyInviteSchema = z.object({
  inviteId: z.string().trim().min(1),
  action: z.enum(['accept', 'reject']),
})

export const requestEnemyCombatSchema = z.object({
  roomId: z.string().min(1),
  enemyId: z.string().trim().min(1),
})

export const startEnemyCombatSchema = z.object({
  encounterId: z.string().trim().min(1),
})

export const respondEnemyCombatSupportSchema = z.object({
  encounterId: z.string().trim().min(1),
  action: z.enum(['accept', 'reject']),
})

export const fleeEnemyCombatSchema = z.object({
  encounterId: z.string().trim().min(1),
})

export const respondPartyLeaderFollowSchema = z.object({
  requestId: z.string().trim().min(1),
  action: z.enum(['accept', 'reject']),
})

export const leavePartySchema = z.object({})

export const promotePartyLeaderSchema = z.object({
  nextLeaderUserId: z.string().trim().min(1),
})

export const setTypingStateSchema = z.object({
  roomId: z.string().min(1),
  isTyping: z.boolean(),
})

export const sendChatMessageSchema = z.object({
  roomId: z.string().min(1),
  content: z.string().trim().min(1).max(280),
})
