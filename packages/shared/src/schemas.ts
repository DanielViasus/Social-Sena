import { z } from 'zod'
import { WORLD_HEIGHT, WORLD_WIDTH } from './constants'

export const directionSchema = z.enum(['up', 'down', 'left', 'right'])
export const skinColorSelectionsSchema = z.record(z.string().trim().min(1), z.string().trim().min(1))
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
})

export const connectToGameSchema = z.object({
  token: z.string().optional(),
  profile: userProfileSchema,
})

export const joinRoomSchema = z.object({
  roomId: z.string().min(1),
  templateId: z.string().min(1),
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

export const setTypingStateSchema = z.object({
  roomId: z.string().min(1),
  isTyping: z.boolean(),
})

export const sendChatMessageSchema = z.object({
  roomId: z.string().min(1),
  content: z.string().trim().min(1).max(280),
})
