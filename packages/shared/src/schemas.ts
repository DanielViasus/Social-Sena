import { z } from 'zod'
import { WORLD_HEIGHT, WORLD_WIDTH } from './constants'
import { DEFAULT_AUDIO_SETTINGS } from './types'

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
