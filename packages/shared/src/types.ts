import type { RoomEnemyState, RoomObjectTemplate, RoomTemplate } from './rooms/types'

export type Direction = 'up' | 'down' | 'left' | 'right'
export type PlayerFacing = 'front-right' | 'front-left' | 'back-right' | 'back-left'
export type SkinColorSelections = Record<string, string>

export const USER_ROLES = ['visitor', 'user', 'mage', 'admin', 'developer'] as const
export type UserRole = (typeof USER_ROLES)[number]

export const DEFAULT_USER_ROLE: UserRole = 'visitor'

const USER_ROLE_LEVEL: Record<UserRole, number> = {
  visitor: 0,
  user: 1,
  mage: 2,
  admin: 3,
  developer: 4,
}

export function isUserRole(value: unknown): value is UserRole {
  return typeof value === 'string' && USER_ROLES.includes(value as UserRole)
}

export function normalizeUserRole(value: unknown): UserRole {
  return isUserRole(value) ? value : DEFAULT_USER_ROLE
}

export function hasMinimumUserRole(currentRole: UserRole, requiredRole: UserRole) {
  return USER_ROLE_LEVEL[currentRole] >= USER_ROLE_LEVEL[requiredRole]
}

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
  musicVolume: 0.1,
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
  role: UserRole
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

export const PARTY_INVITE_TTL_MS = 60_000
export const PARTY_LEADER_FOLLOW_TTL_MS = 30_000

export interface PartyMemberSummary {
  userId: string
  displayName: string
  skinId: string
  skinColors: SkinColorSelections
  level: number
  isOnline: boolean
}

export interface PartySummary {
  partyId: string
  leaderUserId: string
  members: PartyMemberSummary[]
}

export interface PartyInviteSummary {
  inviteId: string
  partyId: string
  fromUserId: string
  displayName: string
  skinId: string
  skinColors: SkinColorSelections
  level: number
  createdAt: string
  expiresAt: string
}

export interface PartyOutgoingInviteSummary {
  inviteId: string
  toUserId: string
  expiresAt: string
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
  facing?: PlayerFacing
  moving: boolean
  skinId: string
  skinColors: SkinColorSelections
  partyId: string | null
  partyLeaderUserId: string | null
  partyLeaderDisplayName: string | null
  partyLeaderSkinId: string | null
  partyLeaderSkinColors: SkinColorSelections | null
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
  enemies: RoomEnemyState[]
}

export interface RoomEnemiesStatePayload {
  roomId: string
  enemies: RoomEnemyState[]
}

export interface RoomObjectStateChangedPayload {
  roomId: string
  objectId: string
  object: RoomObjectTemplate | null
}

export interface EnemyCombatParticipantSummary {
  userId: string
  displayName: string
  skinId: string
  skinColors: SkinColorSelections
  level: number
}

export type EnemyCombatPhase = 'lobby' | 'battle'

export interface EnemyCombatEncounterStatePayload {
  encounterId: string
  roomId: string
  templateId: string
  enemyId: string
  enemyLabel: string
  enemyLevel: number
  phase: EnemyCombatPhase
  combatLeaderUserId: string
  combatLeaderDisplayName: string
  requestedByUserId: string
  requestedByDisplayName: string
  requestedByPosition: Position
  participants: EnemyCombatParticipantSummary[]
}

export interface RoomEnemyCombatStatePayload {
  roomId: string
  encounters: EnemyCombatEncounterStatePayload[]
}

export interface EnemyCombatSupportInvitePayload {
  encounterId: string
  roomId: string
  templateId: string
  enemyId: string
  enemyLabel: string
  enemyLevel: number
  combatLeaderUserId: string
  combatLeaderDisplayName: string
  requestedByUserId: string
  requestedByDisplayName: string
  requestedByPosition: Position
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
  party: PartySummary | null
  incomingPartyInvites: PartyInviteSummary[]
  outgoingPartyInvites: PartyOutgoingInviteSummary[]
}

export interface CompleteOnboardingPayload {
  skinId: string
  skinColors?: SkinColorSelections
}

export interface JoinRoomPayload {
  roomId?: string
  templateId: string
  spawnPosition?: Position
  transition?: 'direct' | 'teleport' | 'follow-leader'
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

export interface UpdateAccessRolePayload {
  role: UserRole
}

export interface RoomEditorLayerData {
  id: string
  name: string
  enabled: boolean
  collidersEnabled: boolean
  required?: boolean
}

export interface RoomEditorPlacementData {
  layerId: string
  assetId: string
  cellX: number
  cellY: number
  flippedX: boolean
}

export interface RoomEditorColliderData {
  width: number
  height: number
  offsetX: number
  offsetY: number
}

export interface RoomEditorAssetData {
  id: string
  category: string
  frameWidth: number
  frameHeight: number
  occupiedColumns: number
  occupiedRows: number
  colliders: RoomEditorColliderData[]
  zIndexOffsetY: number
  warningArea?: {
    width: number
    height: number
    offsetX: number
    offsetY: number
  }
  interactionArea?: {
    width: number
    height: number
    offsetX: number
    offsetY: number
  }
  interactionIconContainer?: {
    width: number
    height: number
    offsetX: number
    offsetY: number
  }
  interactionState?: 0 | 1
}

export interface RoomEditorSpawnPointData {
  id: string
  cellX: number
  cellY: number
  entryKey?: string
}

export interface RoomEditorDocument {
  version: 1
  gridWidth: number
  gridHeight: number
  layers: RoomEditorLayerData[]
  placements: RoomEditorPlacementData[]
  assets: RoomEditorAssetData[]
  spawnPoints: RoomEditorSpawnPointData[]
}

export type RoomEditorPublicationKind = 'system' | 'classroom' | 'room' | 'event' | 'official'

export interface RoomEditorPublicationInput {
  kind: RoomEditorPublicationKind
  routeSlug?: string
  classCode?: string
  accessCode?: string
}

export interface SavedRoomEditorMap {
  code: string
  name: string
  ownerUserId: string
  publicationKind: RoomEditorPublicationKind | 'draft'
  routePath: string | null
  classCode: string | null
  document: RoomEditorDocument
  createdAt: string
  updatedAt: string
}

export interface RoomEditorMapSummary {
  code: string
  name: string
  ownerUserId: string
  ownerDisplayName: string
  publicationKind: RoomEditorPublicationKind | 'draft'
  routePath: string | null
  updatedAt: string
}

export interface SaveRoomEditorMapPayload {
  code?: string
  name: string
  document: RoomEditorDocument
  publication?: RoomEditorPublicationInput
}

export interface LoadRoomEditorMapPayload {
  code: string
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

export interface InviteToPartyPayload {
  friendUserId: string
}

export interface RespondPartyInvitePayload {
  inviteId: string
  action: 'accept' | 'reject'
}

export interface RequestEnemyCombatPayload {
  roomId: string
  enemyId: string
}

export interface RespondEnemyCombatSupportPayload {
  encounterId: string
  action: 'accept' | 'reject'
}

export interface FleeEnemyCombatPayload {
  encounterId: string
}

export interface PartyLeaderFollowPromptPayload {
  requestId: string
  partyId: string
  leaderUserId: string
  leaderDisplayName: string
  roomId: string
  roomName: string
  templateId: string
  spawnPosition: Position
  expiresAt: string
}

export interface RespondPartyLeaderFollowPayload {
  requestId: string
  action: 'accept' | 'reject'
}

export interface LeavePartyPayload {}

export interface PromotePartyLeaderPayload {
  nextLeaderUserId: string
}

export interface PartyStatePayload {
  party: PartySummary | null
  incomingPartyInvites: PartyInviteSummary[]
  outgoingPartyInvites: PartyOutgoingInviteSummary[]
}

export interface ActivityNoticePayload {
  noticeId: string
  title: string
  message: string
}

export interface RoomTransitionRequestedPayload {
  roomId: string
  templateId: string
  spawnPosition: Position
  transition: 'teleport' | 'follow-leader'
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
