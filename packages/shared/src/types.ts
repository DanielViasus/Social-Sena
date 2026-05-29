import type { RoomTemplate } from './rooms/types'

export type Direction = 'up' | 'down' | 'left' | 'right'
export type SkinColorSelections = Record<string, string>

export interface AudioSettings {
  musicEnabled: boolean
  musicVolume: number
  sfxEnabled: boolean
  sfxVolume: number
}

const LEGACY_AUDIO_SETTINGS_DEFAULTS: AudioSettings = {
  musicEnabled: true,
  musicVolume: 0.42,
  sfxEnabled: true,
  sfxVolume: 0.8,
}

export const DEFAULT_AUDIO_SETTINGS: AudioSettings = {
  musicEnabled: true,
  musicVolume: 0.15,
  sfxEnabled: true,
  sfxVolume: 1,
}

function clampAudioVolume(value: unknown, fallback: number) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return fallback
  }

  return Math.min(1, Math.max(0, Number(value.toFixed(2))))
}

export function normalizeAudioSettings(value: unknown): AudioSettings {
  if (!value || typeof value !== 'object') {
    return { ...DEFAULT_AUDIO_SETTINGS }
  }

  const candidate = value as Partial<AudioSettings>

  const normalizedSettings = {
    musicEnabled:
      typeof candidate.musicEnabled === 'boolean'
        ? candidate.musicEnabled
        : DEFAULT_AUDIO_SETTINGS.musicEnabled,
    musicVolume: clampAudioVolume(candidate.musicVolume, DEFAULT_AUDIO_SETTINGS.musicVolume),
    sfxEnabled:
      typeof candidate.sfxEnabled === 'boolean'
        ? candidate.sfxEnabled
        : DEFAULT_AUDIO_SETTINGS.sfxEnabled,
    sfxVolume: clampAudioVolume(candidate.sfxVolume, DEFAULT_AUDIO_SETTINGS.sfxVolume),
  }

  const usesLegacyDefaults =
    normalizedSettings.musicEnabled === LEGACY_AUDIO_SETTINGS_DEFAULTS.musicEnabled &&
    normalizedSettings.musicVolume === LEGACY_AUDIO_SETTINGS_DEFAULTS.musicVolume &&
    normalizedSettings.sfxEnabled === LEGACY_AUDIO_SETTINGS_DEFAULTS.sfxEnabled &&
    normalizedSettings.sfxVolume === LEGACY_AUDIO_SETTINGS_DEFAULTS.sfxVolume

  return usesLegacyDefaults ? { ...DEFAULT_AUDIO_SETTINGS } : normalizedSettings
}

export interface UserProfile {
  userId: string
  username: string
  displayName: string
  skinId: string
  skinColors: SkinColorSelections
  audioSettings: AudioSettings
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

export interface FriendSummary {
  userId: string
  displayName: string
  skinId: string
  skinColors: SkinColorSelections
  level: number
  isOnline: boolean
}

export interface FriendRequestSummary {
  requestId: string
  fromUserId: string
  displayName: string
  skinId: string
  skinColors: SkinColorSelections
  level: number
  createdAt: string
}

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
  level: number
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
  friends: FriendSummary[]
  incomingFriendRequests: FriendRequestSummary[]
  outgoingFriendRequestUserIds: string[]
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

export interface UpdateAudioSettingsPayload {
  audioSettings: AudioSettings
}

export interface UpdateInventoryPayload {
  inventory: PlayerInventory
}

export interface AddFriendPayload {
  friendUserId: string
}

export interface RespondFriendRequestPayload {
  requestId: string
  action: 'accept' | 'reject'
}

export interface RemoveFriendPayload {
  friendUserId: string
}

export interface SocialStatePayload {
  friends: FriendSummary[]
  incomingFriendRequests: FriendRequestSummary[]
  outgoingFriendRequestUserIds: string[]
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
