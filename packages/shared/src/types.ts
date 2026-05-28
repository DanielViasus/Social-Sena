import type { RoomTemplate } from './rooms/types'

export type Direction = 'up' | 'down' | 'left' | 'right'
export type SkinColorSelections = Record<string, string>

export interface UserProfile {
  userId: string
  username: string
  displayName: string
  skinId: string
  skinColors: SkinColorSelections
}

export interface PlayerProgress {
  level: number
  experience: number
}

export type InventoryMetadataValue = string | number | boolean | null
export type InventoryItemMetadata = Record<string, InventoryMetadataValue>

export interface InventoryItemState {
  quantity: number
  metadata?: InventoryItemMetadata
}

export type PlayerInventory = Record<string, InventoryItemState>

export interface Position {
  x: number
  y: number
}

export interface RouteState {
  start: Position
  target: Position
  waypoints: Position[]
}

export interface Presence {
  userId: string
  displayName: string
  sessionId: string
  roomId: string
  position: Position
  direction: Direction
  moving: boolean
  skinId: string
  skinColors: SkinColorSelections
  animation: string
  destination: Position | null
  route: RouteState | null
}

export interface RoomState {
  roomId: string
  templateId: string
  name: string
  maxUsers: number
  template: RoomTemplate
  players: Presence[]
}

export interface ChatMessage {
  messageId: string
  roomId: string
  userId: string
  displayName: string
  content: string
  timestamp: string
}

export interface ConnectToGamePayload {
  token?: string
  profile: UserProfile
}

export interface ConnectionAcceptedPayload {
  sessionId: string
  profile: UserProfile
  needsOnboarding: boolean
  progress: PlayerProgress
  inventory: PlayerInventory
}

export interface CompleteOnboardingPayload {
  skinId: string
  skinColors?: SkinColorSelections
}

export interface JoinRoomPayload {
  roomId: string
  templateId: string
}

export interface NavigateToPayload {
  roomId: string
  target: Position
}

export interface MovementInputPayload {
  roomId: string
  up: boolean
  down: boolean
  left: boolean
  right: boolean
}

export interface UpdateSkinPayload {
  roomId: string
  skinId: string
  skinColors?: SkinColorSelections
}

export interface UpdateInventoryPayload {
  inventory: PlayerInventory
}

export interface SendChatMessagePayload {
  roomId: string
  content: string
}

export interface SetTypingStatePayload {
  roomId: string
  isTyping: boolean
}

export interface TypingStateChangedPayload {
  roomId: string
  userId: string
  isTyping: boolean
}

export interface ServerErrorPayload {
  code: string
  message: string
}
