import { FormEvent, useCallback, useEffect, useEffectEvent, useRef, useState, type CSSProperties } from 'react'
import { io, type Socket } from 'socket.io-client'
import {
  clientEvents,
  serverEvents,
  DEFAULT_AUDIO_SETTINGS,
  getRoomTemplateById,
  normalizeAudioSettings,
  type ActivityNoticePayload,
  type AudioSettings,
  type ChatMessage,
  type ConnectionAcceptedPayload,
  type EnemyCombatEncounterStatePayload,
  type EnemyCombatParticipantSummary,
  type EnemyCombatSupportInvitePayload,
  type FriendRequestSummary,
  type FriendSummary,
  type PartyInviteSummary,
  type PartyLeaderFollowPromptPayload,
  type PartyOutgoingInviteSummary,
  type PartyStatePayload,
  type PartySummary,
  type Position,
  type Presence,
  type RoomEnemyTemplate,
  type RoomEnemyCombatStatePayload,
  type RoomEnemiesStatePayload,
  type RoomState,
  type SkinColorSelections,
  type SocialStatePayload,
  type RoomTransitionRequestedPayload,
  type ServerErrorPayload,
  type TypingStateChangedPayload,
} from '@social-sena/shared'
import { saveAuthSession, savePreferredSkin, savePreferredSkinColors, type AuthSession } from '../auth/localSession'
import type { DialogueDefinition } from '../dialogue/registry'
import { getDialogueById } from '../dialogue/registry'
import {
  getAvailableAvatarPresets,
  getDefaultAvatarColorSelections,
  normalizeAvatarColorSelections,
  resolveAvatarPreset,
  resolveAvatarPrimaryColor,
  resolveAvatarSheetUrl,
  type AvatarColorSelections,
} from '../game/avatar/avatarSprites'
import { createAvatarBubblePalette, mixHexColor, withAlpha } from '../game/avatar/avatarUiColors'
import ReactWorld, { type WorldInteractableTarget } from './ReactWorld'
import SceneLoadingOverlay, { SCENE_LOADING_LAYER_ASSETS } from './SceneLoadingOverlay'
import DialogueOverlay from './dialogue/DialogueOverlay'
import MobileNpcInteractButton from './MobileNpcInteractButton'
import InitialSkinSetupOverlay from './skins/InitialSkinSetupOverlay'
import SkinEditorOverlay from './skins/SkinEditorOverlay'
import { availableRoomRoutes, resolveRoomTemplateFromPath } from '../rooms/registry'
import { createUiSoundController, type UiSoundName } from '../audio/chiptuneSounds'
import { createAmbientMusicController } from '../audio/chiptuneMusic'
import {
  getEnemyOverlayAsset,
  getEnemySpriteAsset,
  preloadImageAsset,
  preloadRoomTemplateAssets,
} from './world/worldAssetCatalog'

const SERVER_URL = import.meta.env.VITE_GAME_SERVER_URL ?? 'http://localhost:3001'
const PLAYER_NAMES_VISIBILITY_STORAGE_KEY = 'social-sena-player-names-visible'
const SCENE_LOADING_EXTRA_HOLD_MS = 1000
const SCENE_LOADING_FAILSAFE_MS = 5500
const ENEMY_ESCAPE_INTERACTION_COOLDOWN_MS = 4000
type PlayerIdentityMode = 'icons' | 'names'
type MovementInputState = {
  up: boolean
  down: boolean
  left: boolean
  right: boolean
}

const EMPTY_MOVEMENT_INPUT: MovementInputState = {
  up: false,
  down: false,
  left: false,
  right: false,
}

const MOVEMENT_KEY_CODES = new Set([
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
  'ArrowUp',
  'KeyA',
  'KeyD',
  'KeyS',
  'KeyW',
])
const USER_AVATAR_SHAPE_PATH =
  'M0 32V20H4V12H8V8H12V4H20V0H32V4H40V8H44V12H48V20H52V32H48V40H44V44H40V48H32V52H20V48H12V44H8V40H4V32H0Z'

function parsePlayerIdentityMode(value: string | null): PlayerIdentityMode {
  if (value === 'names' || value === 'icons') {
    return value
  }

  if (value === 'true') {
    return 'names'
  }

  return 'icons'
}

function getNextPlayerIdentityMode(currentMode: PlayerIdentityMode): PlayerIdentityMode {
  return currentMode === 'icons' ? 'names' : 'icons'
}

function buildMovementInputFromKeyCodes(pressedKeyCodes: Set<string>): MovementInputState {
  return {
    up: pressedKeyCodes.has('KeyW') || pressedKeyCodes.has('ArrowUp'),
    down: pressedKeyCodes.has('KeyS') || pressedKeyCodes.has('ArrowDown'),
    left: pressedKeyCodes.has('KeyA') || pressedKeyCodes.has('ArrowLeft'),
    right: pressedKeyCodes.has('KeyD') || pressedKeyCodes.has('ArrowRight'),
  }
}

function areMovementInputsEqual(left: MovementInputState, right: MovementInputState) {
  return left.up === right.up && left.down === right.down && left.left === right.left && left.right === right.right
}

function hasMovementInput(input: MovementInputState) {
  return input.up || input.down || input.left || input.right
}

interface GameClientProps {
  onLogout: () => void
  session: AuthSession
  onSessionChange?: (nextSession: AuthSession) => void
}

interface ActiveDialogueState {
  npcId: string
  dialogue: DialogueDefinition
  lineIndex: number
}

type ActiveTouchPromptState =
  | {
      kind: 'npc'
      npcId: string
      title: string
    }
  | {
      kind: 'enemy'
      encounterId: string
      enemyId: string
      title: string
      enemyLevel: number
      phase: 'lobby' | 'battle'
      fleeChance: number
      combatLeaderUserId: string
      combatLeaderDisplayName: string
      requestedByUserId: string
      requestedByDisplayName: string
      participants: EnemyCombatParticipantSummary[]
    }

interface FriendRequestPopupState extends FriendRequestSummary {
  expiresAt: number
}

type PartyInvitePopupState = PartyInviteSummary
type PartyLeaderFollowPromptState = PartyLeaderFollowPromptPayload
type EnemyCombatSupportInviteState = EnemyCombatSupportInvitePayload

interface ActivityNoticeState {
  id: string
  title: string
  message: string
}

interface FloatingChatMessage extends ChatMessage {
  primaryColor: string
  isOwnMessage: boolean
}

function areAudioSettingsEqual(left: AudioSettings, right: AudioSettings) {
  return (
    left.musicEnabled === right.musicEnabled &&
    left.musicVolume === right.musicVolume &&
    left.sfxEnabled === right.sfxEnabled &&
    left.sfxVolume === right.sfxVolume
  )
}

function resolveLevelSubtitle(level: number | null | undefined) {
  return `Nivel ${Math.max(1, Math.floor(level ?? 1))}`
}

function resolveEnemyFleeChance(enemyLevel: number) {
  return Math.max(0.1, Math.min(1, 1 - enemyLevel * 0.1))
}

function buildEnemyCombatPromptState(encounter: EnemyCombatEncounterStatePayload): ActiveTouchPromptState {
  const enemyLevel = Math.max(0, Math.floor(encounter.enemyLevel))
  return {
    kind: 'enemy',
    encounterId: encounter.encounterId,
    enemyId: encounter.enemyId,
    title: encounter.enemyLabel || 'Rival',
    enemyLevel,
    phase: encounter.phase,
    fleeChance: resolveEnemyFleeChance(enemyLevel),
    combatLeaderUserId: encounter.combatLeaderUserId,
    combatLeaderDisplayName: encounter.combatLeaderDisplayName,
    requestedByUserId: encounter.requestedByUserId,
    requestedByDisplayName: encounter.requestedByDisplayName,
    participants: encounter.participants,
  }
}

function useLoopingPreviewFrame(frameCount: number, durationMs: number) {
  const [frameIndex, setFrameIndex] = useState(0)

  useEffect(() => {
    setFrameIndex(0)

    if (frameCount <= 1) {
      return
    }

    const intervalId = window.setInterval(() => {
      setFrameIndex((currentValue) => (currentValue + 1) % frameCount)
    }, Math.max(80, durationMs))

    return () => window.clearInterval(intervalId)
  }, [durationMs, frameCount])

  return frameIndex
}

function MenuAvatarPreview({
  skinId,
  skinColors,
  displayName,
}: {
  skinId: string
  skinColors: SkinColorSelections
  displayName: string
}) {
  const preset = resolveAvatarPreset(skinId)
  const frame = preset.idleFrames[0]
  const sheetUrl = resolveAvatarSheetUrl(preset, skinColors)
  const size = 56
  const scale = size / preset.frameWidth

  return (
    <div
      className="menu-avatar-preview"
      aria-hidden="true"
      title={`${displayName} · ${preset.label}`}
      style={{
        width: `${size}px`,
        height: `${size}px`,
      }}
    >
      <img
        src={sheetUrl}
        alt=""
        draggable={false}
        className="menu-avatar-preview-sheet"
        style={{
          width: `${preset.sheetWidth * scale}px`,
          height: `${preset.sheetHeight * scale}px`,
          left: `${-frame.column * preset.frameWidth * scale}px`,
          top: `${-frame.row * preset.frameHeight * scale}px`,
        }}
      />
    </div>
  )
}

function CombatParticipantPreview({
  participant,
  isRequester,
}: {
  participant: EnemyCombatParticipantSummary
  isRequester: boolean
}) {
  const preset = resolveAvatarPreset(participant.skinId)
  const idleFrameIndex = useLoopingPreviewFrame(preset.idleFrames.length, 240)
  const frame = preset.idleFrames[idleFrameIndex] ?? preset.idleFrames[0]
  const sheetUrl = resolveAvatarSheetUrl(preset, participant.skinColors)
  const size = 88
  const scale = size / preset.frameWidth

  return (
    <article className="combat-banner-character-card">
      <div className="combat-banner-character-stage">
        <div
          className="combat-banner-character-sprite-frame"
          style={{
            width: `${size}px`,
            height: `${size}px`,
          }}
        >
          <img
            src={sheetUrl}
            alt={participant.displayName}
            draggable={false}
            className="combat-banner-character-sheet"
            style={{
              width: `${preset.sheetWidth * scale}px`,
              height: `${preset.sheetHeight * scale}px`,
              left: `${-frame.column * preset.frameWidth * scale}px`,
              top: `${-frame.row * preset.frameHeight * scale}px`,
            }}
          />
        </div>
      </div>
      <div className="combat-banner-character-meta">
        <strong>{participant.displayName}</strong>
        <span>{resolveLevelSubtitle(participant.level)}</span>
        {isRequester ? <em>Inicio el combate</em> : null}
      </div>
    </article>
  )
}

function CombatEnemyPreview({
  enemyTemplate,
  label,
  enemyLevel,
}: {
  enemyTemplate: RoomEnemyTemplate | null
  label: string
  enemyLevel: number
}) {
  const spriteSheetUrl = getEnemySpriteAsset(enemyTemplate?.spriteSheetAssetId)
  const spriteUrl = getEnemyOverlayAsset(enemyTemplate?.spriteAssetId)
  const frameWidth = enemyTemplate?.spriteFrameWidth ?? 128
  const frameHeight = enemyTemplate?.spriteFrameHeight ?? 128
  const sheetWidth = enemyTemplate?.spriteSheetWidth ?? frameWidth
  const sheetHeight = enemyTemplate?.spriteSheetHeight ?? frameHeight
  const idleFrames = (enemyTemplate?.spriteFrames ?? [])
    .filter((frame) => frame.row === 0)
    .sort((leftFrame, rightFrame) => leftFrame.column - rightFrame.column)
  const idleFrameIndex = useLoopingPreviewFrame(
    idleFrames.length,
    Math.max(80, enemyTemplate?.spriteFrameDurationMs ?? 240),
  )
  const activeIdleFrame = idleFrames[idleFrameIndex] ?? idleFrames[0] ?? null
  const size = 88
  const scale = size / frameWidth

  return (
    <article className="combat-banner-character-card is-enemy">
      <div className="combat-banner-character-stage is-enemy">
        {spriteSheetUrl ? (
          <div
            className="combat-banner-character-sprite-frame is-enemy"
            style={{
              width: `${size}px`,
              height: `${size}px`,
              transform: 'scaleX(-1)',
            }}
          >
            <img
              src={spriteSheetUrl}
              alt={label}
              draggable={false}
              className="combat-banner-character-sheet"
              style={{
                width: `${sheetWidth * scale}px`,
                height: `${sheetHeight * scale}px`,
                left: `${-((activeIdleFrame?.column ?? 0) * frameWidth * scale)}px`,
                top: `${-((activeIdleFrame?.row ?? 0) * frameHeight * scale)}px`,
              }}
            />
          </div>
        ) : spriteUrl ? (
          <img
            src={spriteUrl}
            alt={label}
            draggable={false}
            className="combat-banner-character-static is-enemy"
            style={{
              width: `${size}px`,
              height: `${size}px`,
              transform: 'scaleX(-1)',
            }}
          />
        ) : (
          <div
            className="combat-banner-character-fallback is-enemy"
            aria-hidden="true"
            style={{
              width: `${size}px`,
              height: `${size}px`,
            }}
          />
        )}
      </div>
      <div className="combat-banner-character-meta is-enemy">
        <strong>{label}</strong>
        <span>{`Nivel ${enemyLevel}`}</span>
      </div>
    </article>
  )
}

function PokemonCombatParticipantSprite({
  participant,
  size,
}: {
  participant: EnemyCombatParticipantSummary
  size: number
}) {
  const preset = resolveAvatarPreset(participant.skinId)
  const previewFrames = preset.idleBackFrames?.length ? preset.idleBackFrames : preset.idleFrames
  const frameIndex = useLoopingPreviewFrame(previewFrames.length, 260)
  const frame = previewFrames[frameIndex] ?? previewFrames[0]
  const sheetUrl = resolveAvatarSheetUrl(preset, participant.skinColors)
  const scale = size / preset.frameWidth

  return (
    <div
      className="pokemon-combat-sprite-frame"
      style={{
        width: `${size}px`,
        height: `${size}px`,
      }}
    >
      <img
        src={sheetUrl}
        alt={participant.displayName}
        draggable={false}
        className="pokemon-combat-sprite-sheet"
        style={{
          width: `${preset.sheetWidth * scale}px`,
          height: `${preset.sheetHeight * scale}px`,
          left: `${-frame.column * preset.frameWidth * scale}px`,
          top: `${-frame.row * preset.frameHeight * scale}px`,
        }}
      />
    </div>
  )
}

function PokemonCombatEnemySprite({
  enemyTemplate,
  label,
  size,
}: {
  enemyTemplate: RoomEnemyTemplate | null
  label: string
  size: number
}) {
  const spriteSheetUrl = getEnemySpriteAsset(enemyTemplate?.spriteSheetAssetId)
  const spriteUrl = getEnemyOverlayAsset(enemyTemplate?.spriteAssetId)
  const frameWidth = enemyTemplate?.spriteFrameWidth ?? 128
  const frameHeight = enemyTemplate?.spriteFrameHeight ?? 128
  const sheetWidth = enemyTemplate?.spriteSheetWidth ?? frameWidth
  const sheetHeight = enemyTemplate?.spriteSheetHeight ?? frameHeight
  const idleFrames = (enemyTemplate?.spriteFrames ?? [])
    .filter((frame) => frame.row === 0)
    .sort((leftFrame, rightFrame) => leftFrame.column - rightFrame.column)
  const idleFrameIndex = useLoopingPreviewFrame(
    idleFrames.length,
    Math.max(120, enemyTemplate?.spriteFrameDurationMs ?? 280),
  )
  const activeIdleFrame = idleFrames[idleFrameIndex] ?? idleFrames[0] ?? null
  const scale = size / frameWidth

  if (spriteSheetUrl) {
    return (
      <div
        className="pokemon-combat-sprite-frame is-enemy"
        style={{
          width: `${size}px`,
          height: `${size}px`,
        }}
      >
        <img
          src={spriteSheetUrl}
          alt={label}
          draggable={false}
          className="pokemon-combat-sprite-sheet"
          style={{
            width: `${sheetWidth * scale}px`,
            height: `${sheetHeight * scale}px`,
            left: `${-((activeIdleFrame?.column ?? 0) * frameWidth * scale)}px`,
            top: `${-((activeIdleFrame?.row ?? 0) * frameHeight * scale)}px`,
          }}
        />
      </div>
    )
  }

  if (spriteUrl) {
    return (
      <img
        src={spriteUrl}
        alt={label}
        draggable={false}
        className="pokemon-combat-static-sprite"
        style={{
          width: `${size}px`,
          height: `${size}px`,
        }}
      />
    )
  }

  return (
    <div
      className="pokemon-combat-static-sprite is-fallback"
      aria-hidden="true"
      style={{
        width: `${size}px`,
        height: `${size}px`,
      }}
    />
  )
}

function GameClient({ session, onLogout, onSessionChange }: GameClientProps) {
  const MAX_HEADLINE_SPEECH_CHARS = 30
  const FRIEND_REQUEST_POPUP_DURATION_MS = 8000
  const MAX_FLOATING_MESSAGES_MOBILE = 3
  const MAX_FLOATING_MESSAGES_DESKTOP = 6
  const [pathname, setPathname] = useState(() => window.location.pathname)
  const [room, setRoom] = useState<RoomState | null>(null)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [floatingMessages, setFloatingMessages] = useState<FloatingChatMessage[]>([])
  const [chatInput, setChatInput] = useState('')
  const [activeSpeechByUserId, setActiveSpeechByUserId] = useState<Record<string, string>>({})
  const [typingByUserId, setTypingByUserId] = useState<Record<string, boolean>>({})
  const [typingIndicatorFrame, setTypingIndicatorFrame] = useState(0)
  const [connected, setConnected] = useState(false)
  const [optionsOpen, setOptionsOpen] = useState(false)
  const [chatOpen, setChatOpen] = useState(false)
  const [quickChatOpen, setQuickChatOpen] = useState(false)
  const [playerIdentityMode, setPlayerIdentityMode] = useState<PlayerIdentityMode>(() => {
    if (typeof window === 'undefined') {
      return 'icons'
    }

    try {
      return parsePlayerIdentityMode(window.localStorage.getItem(PLAYER_NAMES_VISIBILITY_STORAGE_KEY))
    } catch {
      return 'icons'
    }
  })
  const [debugEnabled, setDebugEnabled] = useState(false)
  const [friends, setFriends] = useState<FriendSummary[]>([])
  const [incomingFriendRequests, setIncomingFriendRequests] = useState<FriendRequestSummary[]>([])
  const [outgoingFriendRequestUserIds, setOutgoingFriendRequestUserIds] = useState<string[]>([])
  const [party, setParty] = useState<PartySummary | null>(null)
  const [incomingPartyInvites, setIncomingPartyInvites] = useState<PartyInviteSummary[]>([])
  const [outgoingPartyInvites, setOutgoingPartyInvites] = useState<PartyOutgoingInviteSummary[]>([])
  const [friendRequestPopups, setFriendRequestPopups] = useState<FriendRequestPopupState[]>([])
  const [partyInvitePopups, setPartyInvitePopups] = useState<PartyInvitePopupState[]>([])
  const [partyLeaderFollowPrompt, setPartyLeaderFollowPrompt] = useState<PartyLeaderFollowPromptState | null>(null)
  const [enemyCombatSupportInvites, setEnemyCombatSupportInvites] = useState<EnemyCombatSupportInviteState[]>([])
  const [roomEnemyCombatEncounters, setRoomEnemyCombatEncounters] = useState<EnemyCombatEncounterStatePayload[]>([])
  const [activityNotices, setActivityNotices] = useState<ActivityNoticeState[]>([])
  const [addingFriendUserId, setAddingFriendUserId] = useState<string | null>(null)
  const [respondingFriendRequestId, setRespondingFriendRequestId] = useState<string | null>(null)
  const [removingFriendUserId, setRemovingFriendUserId] = useState<string | null>(null)
  const [invitingPartyUserId, setInvitingPartyUserId] = useState<string | null>(null)
  const [respondingPartyInviteId, setRespondingPartyInviteId] = useState<string | null>(null)
  const [respondingEnemyCombatInviteId, setRespondingEnemyCombatInviteId] = useState<string | null>(null)
  const [respondingPartyLeaderFollow, setRespondingPartyLeaderFollow] = useState(false)
  const [startingEnemyCombatEncounterId, setStartingEnemyCombatEncounterId] = useState<string | null>(null)
  const [fleeingEnemyCombatEncounterId, setFleeingEnemyCombatEncounterId] = useState<string | null>(null)
  const [promotingPartyLeaderUserId, setPromotingPartyLeaderUserId] = useState<string | null>(null)
  const [leavingParty, setLeavingParty] = useState(false)
  const [activeDialogue, setActiveDialogue] = useState<ActiveDialogueState | null>(null)
  const [activeTouchPrompt, setActiveTouchPrompt] = useState<ActiveTouchPromptState | null>(null)
  const [blockedEnemyInteractionIds, setBlockedEnemyInteractionIds] = useState<string[]>([])
  const [dialogueVisibleChars, setDialogueVisibleChars] = useState(0)
  const [npcInteractionLocked, setNpcInteractionLocked] = useState(false)
  const [mobileInteractionEnabled, setMobileInteractionEnabled] = useState(false)
  const [activeInteractable, setActiveInteractable] = useState<WorldInteractableTarget | null>(null)
  const [sceneLoadingVisible, setSceneLoadingVisible] = useState(true)
  const [skinEditorOpen, setSkinEditorOpen] = useState(false)
  const [initialSkinSetupOpen, setInitialSkinSetupOpen] = useState(false)
  const [initialSkinSetupSubmitting, setInitialSkinSetupSubmitting] = useState(false)
  const [audioSettings, setAudioSettings] = useState<AudioSettings>(() =>
    normalizeAudioSettings(session.profile.audioSettings ?? DEFAULT_AUDIO_SETTINGS),
  )
  const [selectedSkinId, setSelectedSkinId] = useState(() => resolveAvatarPreset(session.profile.skinId).id)
  const [selectedSkinColorsBySkinId, setSelectedSkinColorsBySkinId] = useState<Record<string, AvatarColorSelections>>(
    () => {
      const initialPreset = resolveAvatarPreset(session.profile.skinId)
      return {
        [initialPreset.id]: normalizeAvatarColorSelections(initialPreset, session.profile.skinColors),
      }
    },
  )
  const socketRef = useRef<Socket | null>(null)
  const roomRef = useRef<RoomState | null>(null)
  const roomEnemyCombatEncountersRef = useRef<EnemyCombatEncounterStatePayload[]>([])
  const sessionRef = useRef(session)
  const sessionProfileRef = useRef(session.profile)
  const optionsMenuRef = useRef<HTMLDivElement | null>(null)
  const quickChatInputRef = useRef<HTMLInputElement | null>(null)
  const pressedMovementKeyCodesRef = useRef<Set<string>>(new Set())
  const movementInputRef = useRef<MovementInputState>(EMPTY_MOVEMENT_INPUT)
  const chatOpenRef = useRef(false)
  const floatingTimeoutsRef = useRef<Map<string, number>>(new Map())
  const friendRequestPopupTimeoutsRef = useRef<Map<string, number>>(new Map())
  const friendRequestPopupsRef = useRef<FriendRequestPopupState[]>([])
  const partyInvitePopupTimeoutsRef = useRef<Map<string, number>>(new Map())
  const partyInvitePopupsRef = useRef<PartyInvitePopupState[]>([])
  const activityNoticeTimeoutsRef = useRef<Map<string, number>>(new Map())
  const enemyInteractionCooldownTimeoutsRef = useRef<Map<string, number>>(new Map())
  const partyLeaderFollowPromptTimeoutRef = useRef<number | null>(null)
  const sceneLoadingHideTimeoutRef = useRef<number | null>(null)
  const sceneLoadingFailsafeTimeoutRef = useRef<number | null>(null)
  const friendsRef = useRef<FriendSummary[]>([])
  const partyRef = useRef<PartySummary | null>(null)
  const speechTimeoutsRef = useRef<Map<string, number>>(new Map())
  const typingIdleTimeoutRef = useRef<number | null>(null)
  const localTypingStateRef = useRef(false)
  const dismissedFriendRequestIdsRef = useRef<Set<string>>(new Set())
  const dismissedPartyInviteIdsRef = useRef<Set<string>>(new Set())
  const socialStateInitializedRef = useRef(false)
  const partyStateInitializedRef = useRef(false)
  const dialogueCooldownTimeoutRef = useRef<number | null>(null)
  const uiSoundControllerRef = useRef<ReturnType<typeof createUiSoundController> | null>(null)
  const ambientMusicControllerRef = useRef<ReturnType<typeof createAmbientMusicController> | null>(null)
  const persistAudioSettingsTimeoutRef = useRef<number | null>(null)
  const pendingAudioSettingsSyncRef = useRef<AudioSettings | null>(null)
  const partyInviteStateRefreshTimeoutRef = useRef<number | null>(null)
  const chatTypingToneStepRef = useRef(0)
  const pendingSceneLoadRef = useRef<{
    sequence: number
    templateId: string
    roomId: string | null
    assetsReady: boolean
    roomReady: boolean
  } | null>(null)
  const sceneLoadSequenceRef = useRef(0)
  const lastDialogueAudioProgressRef = useRef<{ lineKey: string; visibleChars: number }>({
    lineKey: '',
    visibleChars: 0,
  })
  const clearSceneLoadingHideTimeout = useEffectEvent(() => {
    const timeoutId = sceneLoadingHideTimeoutRef.current
    if (timeoutId === null) {
      return
    }

    window.clearTimeout(timeoutId)
    sceneLoadingHideTimeoutRef.current = null
  })
  const clearSceneLoadingFailsafeTimeout = useEffectEvent(() => {
    const timeoutId = sceneLoadingFailsafeTimeoutRef.current
    if (timeoutId === null) {
      return
    }

    window.clearTimeout(timeoutId)
    sceneLoadingFailsafeTimeoutRef.current = null
  })
  if (!uiSoundControllerRef.current) {
    uiSoundControllerRef.current = createUiSoundController()
  }
  if (!ambientMusicControllerRef.current) {
    ambientMusicControllerRef.current = createAmbientMusicController()
  }
  const activeTemplate = resolveRoomTemplateFromPath(pathname)
  const isCombatLeaderParticipantPresent =
    activeTouchPrompt?.kind === 'enemy'
      ? activeTouchPrompt.participants.some((participant) => participant.userId === activeTouchPrompt.combatLeaderUserId)
      : false
  const canStartActiveEnemyCombat =
    activeTouchPrompt?.kind === 'enemy' &&
    (isCombatLeaderParticipantPresent
      ? activeTouchPrompt.combatLeaderUserId === session.profile.userId
      : activeTouchPrompt.participants.some((participant) => participant.userId === session.profile.userId))
  const isSubmittingEnemyCombatStart =
    activeTouchPrompt?.kind === 'enemy' && startingEnemyCombatEncounterId === activeTouchPrompt.encounterId
  const canRetreatFromActiveEnemyCombat =
    activeTouchPrompt?.kind === 'enemy' &&
    (isCombatLeaderParticipantPresent
      ? activeTouchPrompt.combatLeaderUserId === session.profile.userId
      : activeTouchPrompt.participants.some((participant) => participant.userId === session.profile.userId))
  const isSubmittingEnemyCombatFlee =
    activeTouchPrompt?.kind === 'enemy' && fleeingEnemyCombatEncounterId === activeTouchPrompt.encounterId
  const activeCombatEnemyTemplate =
    activeTouchPrompt?.kind === 'enemy'
      ? (activeTemplate.enemies ?? []).find((enemyTemplate) => enemyTemplate.id === activeTouchPrompt.enemyId) ?? null
      : null
  const activeCombatCurrentParticipant =
    activeTouchPrompt?.kind === 'enemy'
      ? activeTouchPrompt.participants.find((participant) => participant.userId === session.profile.userId) ??
        activeTouchPrompt.participants[0] ??
        null
      : null
  const activeCombatSupportParticipants =
    activeTouchPrompt?.kind === 'enemy' && activeCombatCurrentParticipant
      ? activeTouchPrompt.participants.filter((participant) => participant.userId !== activeCombatCurrentParticipant.userId)
      : []
  const activeCombatParticipantSpriteSize = 136
  const activeCombatBattlefieldParticipants =
    activeTouchPrompt?.kind === 'enemy' && activeCombatCurrentParticipant
      ? [...activeCombatSupportParticipants, activeCombatCurrentParticipant]
      : []
  const activeCombatHealthParticipants =
    activeTouchPrompt?.kind === 'enemy' && activeCombatCurrentParticipant
      ? [activeCombatCurrentParticipant, ...activeCombatSupportParticipants]
      : []
  const playerInitial = session.profile.displayName.slice(0, 1).toUpperCase()
  const typingIndicatorText = ['.', '..', '...'][typingIndicatorFrame] ?? '...'
  const availableSkins = getAvailableAvatarPresets()

  const clearFloatingMessage = useEffectEvent((messageId: string) => {
    const timeoutId = floatingTimeoutsRef.current.get(messageId)
    if (timeoutId) {
      window.clearTimeout(timeoutId)
      floatingTimeoutsRef.current.delete(messageId)
    }

    setFloatingMessages((currentMessages) =>
      currentMessages.filter((message) => message.messageId !== messageId),
    )
  })

  const clearPlayerSpeech = useEffectEvent((userId: string) => {
    const timeoutId = speechTimeoutsRef.current.get(userId)
    if (timeoutId) {
      window.clearTimeout(timeoutId)
      speechTimeoutsRef.current.delete(userId)
    }

    setActiveSpeechByUserId((currentValue) => {
      if (!(userId in currentValue)) {
        return currentValue
      }

      const nextValue = { ...currentValue }
      delete nextValue[userId]
      return nextValue
    })
  })

  const showPlayerSpeech = useEffectEvent((message: ChatMessage) => {
    const normalizedText = message.content.trim()
    const speechText =
      normalizedText.length <= MAX_HEADLINE_SPEECH_CHARS
        ? normalizedText
        : `${normalizedText.slice(0, MAX_HEADLINE_SPEECH_CHARS).trimEnd()}...`

    setActiveSpeechByUserId((currentValue) => ({
      ...currentValue,
      [message.userId]: speechText,
    }))

    const previousTimeout = speechTimeoutsRef.current.get(message.userId)
    if (previousTimeout) {
      window.clearTimeout(previousTimeout)
    }

    const timeoutId = window.setTimeout(() => {
      clearPlayerSpeech(message.userId)
    }, 4000)

    speechTimeoutsRef.current.set(message.userId, timeoutId)
  })

  const clearPlayerTyping = useEffectEvent((userId: string) => {
    setTypingByUserId((currentValue) => {
      if (!(userId in currentValue)) {
        return currentValue
      }

      const nextValue = { ...currentValue }
      delete nextValue[userId]
      return nextValue
    })
  })

  const setPlayerTyping = useEffectEvent((userId: string, isTyping: boolean) => {
    if (isTyping) {
      clearPlayerSpeech(userId)
      setTypingByUserId((currentValue) => {
        if (currentValue[userId]) {
          return currentValue
        }

        return {
          ...currentValue,
          [userId]: true,
        }
      })
      return
    }

    clearPlayerTyping(userId)
  })

  const emitLocalTypingState = useEffectEvent((isTyping: boolean) => {
    if (localTypingStateRef.current === isTyping) {
      return
    }

    localTypingStateRef.current = isTyping
    setPlayerTyping(session.profile.userId, isTyping)

    const socket = socketRef.current
    if (!socket || !connected || !room) {
      return
    }

    socket.emit(clientEvents.setTypingState, {
      roomId: room.roomId,
      isTyping,
    })
  })

  const stopLocalTyping = useEffectEvent(() => {
    if (typingIdleTimeoutRef.current) {
      window.clearTimeout(typingIdleTimeoutRef.current)
      typingIdleTimeoutRef.current = null
    }

    emitLocalTypingState(false)
  })

  const enqueueFloatingMessage = useEffectEvent((message: ChatMessage) => {
    const sessionProfile = sessionProfileRef.current
    const senderPresence = roomRef.current?.players.find((player) => player.userId === message.userId)
    const primaryColorSource =
      senderPresence ?? (message.userId === sessionProfile.userId ? sessionProfile : null)
    const primaryColor = primaryColorSource
      ? resolveAvatarPrimaryColor(
          resolveAvatarPreset(primaryColorSource.skinId),
          primaryColorSource.skinColors,
        )
      : '#8A50C0'
    const floatingMessage: FloatingChatMessage = {
      ...message,
      primaryColor,
      isOwnMessage: message.userId === sessionProfile.userId,
    }

    setFloatingMessages((currentMessages) => {
      const maxFloatingMessages = mobileInteractionEnabled
        ? MAX_FLOATING_MESSAGES_MOBILE
        : MAX_FLOATING_MESSAGES_DESKTOP
      const nextMessages = [floatingMessage, ...currentMessages].slice(0, maxFloatingMessages)
      const keptMessageIds = new Set(nextMessages.map((currentMessage) => currentMessage.messageId))

      currentMessages.forEach((currentMessage) => {
        if (!keptMessageIds.has(currentMessage.messageId)) {
          const timeoutId = floatingTimeoutsRef.current.get(currentMessage.messageId)
          if (timeoutId) {
            window.clearTimeout(timeoutId)
            floatingTimeoutsRef.current.delete(currentMessage.messageId)
          }
        }
      })

      return nextMessages
    })

    const timeoutId = window.setTimeout(() => {
      clearFloatingMessage(message.messageId)
    }, 4000)

    const previousTimeout = floatingTimeoutsRef.current.get(message.messageId)
    if (previousTimeout) {
      window.clearTimeout(previousTimeout)
    }
    floatingTimeoutsRef.current.set(message.messageId, timeoutId)
  })

  useEffect(() => {
    roomRef.current = room
  }, [room])

  useEffect(() => {
    sessionRef.current = session
    sessionProfileRef.current = session.profile
  }, [session])

  useEffect(() => {
    const normalizedSettings = normalizeAudioSettings(session.profile.audioSettings ?? DEFAULT_AUDIO_SETTINGS)
    setAudioSettings((currentValue) =>
      areAudioSettingsEqual(currentValue, normalizedSettings) ? currentValue : normalizedSettings,
    )
  }, [session.profile.audioSettings])

  useEffect(() => {
    uiSoundControllerRef.current?.updateSettings({
      sfxEnabled: audioSettings.sfxEnabled,
      sfxVolume: audioSettings.sfxVolume,
    })
    ambientMusicControllerRef.current?.updateSettings({
      musicEnabled: audioSettings.musicEnabled,
      musicVolume: sceneLoadingVisible
        ? Math.min(audioSettings.musicVolume, 0.3)
        : audioSettings.musicVolume,
    })
  }, [audioSettings, sceneLoadingVisible])

  useEffect(() => {
    friendRequestPopupsRef.current = friendRequestPopups
  }, [friendRequestPopups])

  useEffect(() => {
    partyInvitePopupsRef.current = partyInvitePopups
  }, [partyInvitePopups])

  useEffect(() => {
    friendsRef.current = friends
  }, [friends])

  useEffect(() => {
    partyRef.current = party
  }, [party])

  useEffect(() => {
    const handlePopState = () => {
      setPathname(window.location.pathname)
    }

    window.addEventListener('popstate', handlePopState)
    return () => window.removeEventListener('popstate', handlePopState)
  }, [])

  useEffect(() => {
    chatOpenRef.current = chatOpen
  }, [chatOpen])

  const clearAllFriendRequestPopupTimeouts = useCallback(() => {
    friendRequestPopupTimeoutsRef.current.forEach((timeoutId) => window.clearTimeout(timeoutId))
    friendRequestPopupTimeoutsRef.current.clear()
  }, [])

  const clearAllPartyInvitePopupTimeouts = useCallback(() => {
    partyInvitePopupTimeoutsRef.current.forEach((timeoutId) => window.clearTimeout(timeoutId))
    partyInvitePopupTimeoutsRef.current.clear()
  }, [])

  const clearAllActivityNoticeTimeouts = useCallback(() => {
    activityNoticeTimeoutsRef.current.forEach((timeoutId) => window.clearTimeout(timeoutId))
    activityNoticeTimeoutsRef.current.clear()
  }, [])

  const dismissActivityNotice = useEffectEvent((noticeId: string) => {
    const timeoutId = activityNoticeTimeoutsRef.current.get(noticeId)
    if (timeoutId) {
      window.clearTimeout(timeoutId)
      activityNoticeTimeoutsRef.current.delete(noticeId)
    }

    setActivityNotices((currentValue) => currentValue.filter((notice) => notice.id !== noticeId))
  })

  const enqueueActivityNotice = useEffectEvent((title: string, message: string) => {
    const noticeId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    void playUiSound('chat-bubble')
    setActivityNotices((currentValue) => [{ id: noticeId, title, message }, ...currentValue].slice(0, 4))
    const timeoutId = window.setTimeout(() => {
      dismissActivityNotice(noticeId)
    }, 6000)
    activityNoticeTimeoutsRef.current.set(noticeId, timeoutId)
  })

  const dismissPartyLeaderFollowPrompt = useEffectEvent(() => {
    if (partyLeaderFollowPromptTimeoutRef.current) {
      window.clearTimeout(partyLeaderFollowPromptTimeoutRef.current)
      partyLeaderFollowPromptTimeoutRef.current = null
    }

    setPartyLeaderFollowPrompt(null)
    setRespondingPartyLeaderFollow(false)
  })

  const applySocialState = useEffectEvent(
    ({
      nextFriends,
      nextIncomingFriendRequests,
      nextOutgoingFriendRequestUserIds,
      notify = true,
    }: {
      nextFriends: FriendSummary[]
      nextIncomingFriendRequests: FriendRequestSummary[]
      nextOutgoingFriendRequestUserIds: string[]
      notify?: boolean
    }) => {
      if (notify && socialStateInitializedRef.current) {
        const previousFriendsById = new Map(friendsRef.current.map((friend) => [friend.userId, friend] as const))
        nextFriends.forEach((friend) => {
          const previousFriend = previousFriendsById.get(friend.userId)
          if (!previousFriend) {
            return
          }

          if (!previousFriend.isOnline && friend.isOnline) {
            enqueueActivityNotice('Amistad conectada', `${friend.displayName} se conecto.`)
          } else if (previousFriend.isOnline && !friend.isOnline) {
            enqueueActivityNotice('Amistad desconectada', `${friend.displayName} se desconecto.`)
          }
        })
      }

      socialStateInitializedRef.current = true
      setFriends(nextFriends)
      setIncomingFriendRequests(nextIncomingFriendRequests)
      setOutgoingFriendRequestUserIds(nextOutgoingFriendRequestUserIds)
    },
  )

  const applyPartyState = useEffectEvent(
    ({
      nextParty,
      nextIncomingPartyInvites,
      nextOutgoingPartyInvites,
      notify = true,
    }: {
      nextParty: PartySummary | null
      nextIncomingPartyInvites: PartyInviteSummary[]
      nextOutgoingPartyInvites: PartyOutgoingInviteSummary[]
      notify?: boolean
    }) => {
      if (notify && partyStateInitializedRef.current) {
        const previousParty = partyRef.current
        if (
          previousParty &&
          (!nextParty || previousParty.partyId === nextParty.partyId)
        ) {
          const previousMembersById = new Map(previousParty.members.map((member) => [member.userId, member] as const))
          const nextMembers = nextParty?.members ?? []
          const nextMembersById = new Map(nextMembers.map((member) => [member.userId, member] as const))

          nextMembers.forEach((member) => {
            if (member.userId === session.profile.userId || previousMembersById.has(member.userId)) {
              return
            }

            enqueueActivityNotice('Grupo actualizado', `${member.displayName} se unio al grupo.`)
          })

          previousParty.members.forEach((member) => {
            if (member.userId === session.profile.userId || nextMembersById.has(member.userId)) {
              return
            }

            enqueueActivityNotice('Grupo actualizado', `${member.displayName} dejo el grupo.`)
          })
        }
      }

      if (
        partyLeaderFollowPrompt &&
        (!nextParty ||
          nextParty.partyId !== partyLeaderFollowPrompt.partyId ||
          nextParty.leaderUserId === session.profile.userId)
      ) {
        dismissPartyLeaderFollowPrompt()
      }

      partyStateInitializedRef.current = true
      setParty(nextParty)
      setIncomingPartyInvites(nextIncomingPartyInvites)
      setOutgoingPartyInvites(nextOutgoingPartyInvites)
    },
  )

  useEffect(() => {
    if (!optionsOpen) {
      return
    }

    const handlePointerDown = (event: MouseEvent) => {
      if (!optionsMenuRef.current?.contains(event.target as Node)) {
        setOptionsOpen(false)
      }
    }

    window.addEventListener('mousedown', handlePointerDown)
    return () => window.removeEventListener('mousedown', handlePointerDown)
  }, [optionsOpen])

  useEffect(() => {
    const timeouts = floatingTimeoutsRef.current
    return () => {
      timeouts.forEach((timeoutId) => window.clearTimeout(timeoutId))
      timeouts.clear()
    }
  }, [])

  useEffect(() => {
    const popupTimeouts = friendRequestPopupTimeoutsRef.current
    return () => {
      popupTimeouts.forEach((timeoutId) => window.clearTimeout(timeoutId))
      popupTimeouts.clear()
    }
  }, [])

  useEffect(() => {
    const popupTimeouts = partyInvitePopupTimeoutsRef.current
    return () => {
      popupTimeouts.forEach((timeoutId) => window.clearTimeout(timeoutId))
      popupTimeouts.clear()
    }
  }, [])

  useEffect(() => {
    const noticeTimeouts = activityNoticeTimeoutsRef.current
    return () => {
      noticeTimeouts.forEach((timeoutId) => window.clearTimeout(timeoutId))
      noticeTimeouts.clear()
    }
  }, [])

  useEffect(() => {
    const enemyCooldownTimeouts = enemyInteractionCooldownTimeoutsRef.current
    return () => {
      enemyCooldownTimeouts.forEach((timeoutId) => window.clearTimeout(timeoutId))
      enemyCooldownTimeouts.clear()
    }
  }, [])

  useEffect(() => {
    return () => {
      if (partyInviteStateRefreshTimeoutRef.current) {
        window.clearTimeout(partyInviteStateRefreshTimeoutRef.current)
        partyInviteStateRefreshTimeoutRef.current = null
      }
    }
  }, [])

  useEffect(() => {
    const speechTimeouts = speechTimeoutsRef.current
    return () => {
      speechTimeouts.forEach((timeoutId) => window.clearTimeout(timeoutId))
      speechTimeouts.clear()
    }
  }, [])

  useEffect(() => {
    return () => {
      if (typingIdleTimeoutRef.current) {
        window.clearTimeout(typingIdleTimeoutRef.current)
      }
    }
  }, [])

  useEffect(() => {
    const mobileMedia = window.matchMedia('(max-width: 820px)')
    const coarseMedia = window.matchMedia('(pointer: coarse)')

    const updateMobileInteractionMode = () => {
      const hasTouchSupport = navigator.maxTouchPoints > 0 || 'ontouchstart' in window
      setMobileInteractionEnabled(mobileMedia.matches || coarseMedia.matches || hasTouchSupport)
    }

    updateMobileInteractionMode()

    mobileMedia.addEventListener?.('change', updateMobileInteractionMode)
    coarseMedia.addEventListener?.('change', updateMobileInteractionMode)

    return () => {
      mobileMedia.removeEventListener?.('change', updateMobileInteractionMode)
      coarseMedia.removeEventListener?.('change', updateMobileInteractionMode)
    }
  }, [])

  useEffect(() => {
    return () => {
      if (dialogueCooldownTimeoutRef.current) {
        window.clearTimeout(dialogueCooldownTimeoutRef.current)
      }
      if (persistAudioSettingsTimeoutRef.current) {
        window.clearTimeout(persistAudioSettingsTimeoutRef.current)
      }
      void uiSoundControllerRef.current?.close()
      void ambientMusicControllerRef.current?.close()
    }
  }, [])

  useEffect(() => {
    try {
      window.localStorage.setItem(PLAYER_NAMES_VISIBILITY_STORAGE_KEY, playerIdentityMode)
    } catch {
      // Ignore localStorage failures and keep the in-memory preference.
    }
  }, [playerIdentityMode])

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.repeat) {
        return
      }

      const target = event.target as HTMLElement | null
      const tagName = target?.tagName?.toLowerCase()
      const isTyping =
        tagName === 'input' ||
        tagName === 'textarea' ||
        target?.isContentEditable === true

      if (isTyping) {
        return
      }

      if (event.key.toLowerCase() === 'p') {
        event.preventDefault()
        setDebugEnabled((currentValue) => !currentValue)
        return
      }

      if (event.key.toLowerCase() === 'm' && !activeDialogue && !initialSkinSetupOpen) {
        event.preventDefault()
        setSkinEditorOpen((currentValue) => !currentValue)
        return
      }

      if (event.key.toLowerCase() === 'n') {
        event.preventDefault()
        setPlayerIdentityMode((currentValue) => getNextPlayerIdentityMode(currentValue))
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [activeDialogue, initialSkinSetupOpen])

  useEffect(() => {
    const hasTypingPlayers = Object.keys(typingByUserId).length > 0
    if (!hasTypingPlayers) {
      setTypingIndicatorFrame(0)
      return
    }

    const intervalId = window.setInterval(() => {
      setTypingIndicatorFrame((currentValue) => (currentValue + 1) % 3)
    }, 350)

    return () => window.clearInterval(intervalId)
  }, [typingByUserId])

  useEffect(() => {
    const nextSocket = io(SERVER_URL, {
      autoConnect: true,
    })

    socketRef.current = nextSocket

    nextSocket.on('connect', () => {
      clearAllFriendRequestPopupTimeouts()
      clearAllPartyInvitePopupTimeouts()
      clearAllActivityNoticeTimeouts()
      clearSceneLoadingHideTimeout()
      pendingSceneLoadRef.current = null
      setSceneLoadingVisible(true)
      setConnected(true)
      setRoom(null)
      setMessages([])
      setFloatingMessages([])
      setQuickChatOpen(false)
      setActiveSpeechByUserId({})
      setTypingByUserId({})
      setRoomEnemyCombatEncounters([])
      roomEnemyCombatEncountersRef.current = []
      setFriends([])
      setIncomingFriendRequests([])
      setOutgoingFriendRequestUserIds([])
      setParty(null)
      setIncomingPartyInvites([])
      setOutgoingPartyInvites([])
      setEnemyCombatSupportInvites([])
      setActivityNotices([])
      friendRequestPopupsRef.current = []
      setFriendRequestPopups([])
      partyInvitePopupsRef.current = []
      setPartyInvitePopups([])
      setRespondingEnemyCombatInviteId(null)
      setStartingEnemyCombatEncounterId(null)
      setFleeingEnemyCombatEncounterId(null)
      setActiveTouchPrompt(null)
      friendsRef.current = []
      partyRef.current = null
      dismissedFriendRequestIdsRef.current.clear()
      dismissedPartyInviteIdsRef.current.clear()
      socialStateInitializedRef.current = false
      partyStateInitializedRef.current = false
      localTypingStateRef.current = false
      nextSocket.emit(clientEvents.connectToGame, { profile: sessionProfileRef.current })
    })

    nextSocket.on('disconnect', () => {
      clearAllFriendRequestPopupTimeouts()
      clearAllPartyInvitePopupTimeouts()
      clearAllActivityNoticeTimeouts()
      clearSceneLoadingHideTimeout()
      pendingSceneLoadRef.current = null
      setSceneLoadingVisible(true)
      setConnected(false)
      setQuickChatOpen(false)
      setTypingByUserId({})
      setRoomEnemyCombatEncounters([])
      roomEnemyCombatEncountersRef.current = []
      setFriends([])
      setIncomingFriendRequests([])
      setOutgoingFriendRequestUserIds([])
      setParty(null)
      setIncomingPartyInvites([])
      setOutgoingPartyInvites([])
      setEnemyCombatSupportInvites([])
      setActivityNotices([])
      friendRequestPopupsRef.current = []
      setFriendRequestPopups([])
      partyInvitePopupsRef.current = []
      setPartyInvitePopups([])
      setRespondingEnemyCombatInviteId(null)
      setStartingEnemyCombatEncounterId(null)
      setFleeingEnemyCombatEncounterId(null)
      setActiveTouchPrompt(null)
      friendsRef.current = []
      partyRef.current = null
      dismissedFriendRequestIdsRef.current.clear()
      dismissedPartyInviteIdsRef.current.clear()
      socialStateInitializedRef.current = false
      partyStateInitializedRef.current = false
      localTypingStateRef.current = false
      setInitialSkinSetupSubmitting(false)
    })

    nextSocket.on(
      serverEvents.connectionAccepted,
      ({
        profile,
        needsOnboarding,
        progress,
        inventory,
        friends,
        incomingFriendRequests,
        outgoingFriendRequestUserIds,
        party,
        incomingPartyInvites,
        outgoingPartyInvites,
      }: ConnectionAcceptedPayload) => {
        sessionProfileRef.current = profile
        setAudioSettings(normalizeAudioSettings(profile.audioSettings))
        applySocialState({
          nextFriends: friends,
          nextIncomingFriendRequests: incomingFriendRequests,
          nextOutgoingFriendRequestUserIds: outgoingFriendRequestUserIds,
          notify: false,
        })
        applyPartyState({
          nextParty: party,
          nextIncomingPartyInvites: incomingPartyInvites,
          nextOutgoingPartyInvites: outgoingPartyInvites,
          notify: false,
        })

        const nextSession: AuthSession = {
          ...session,
          level: progress.level,
          experience: progress.experience,
          inventory,
          profile,
        }

        sessionRef.current = nextSession
        if (session.provider === 'local') {
          saveAuthSession(nextSession)
        }
        savePreferredSkin(profile.userId, profile.skinId)
        savePreferredSkinColors(profile.userId, profile.skinId, profile.skinColors)
        onSessionChange?.(nextSession)

        if (pendingAudioSettingsSyncRef.current) {
          const queuedAudioSettings = pendingAudioSettingsSyncRef.current
          pendingAudioSettingsSyncRef.current = null
          setAudioSettings(queuedAudioSettings)
          persistAudioSettings(queuedAudioSettings, true)
        }

        if (needsOnboarding) {
          clearSceneLoadingHideTimeout()
          pendingSceneLoadRef.current = null
          setSceneLoadingVisible(false)
          const onboardingPreset = resolveAvatarPreset(profile.skinId)
          setSelectedSkinId(onboardingPreset.id)
          setSelectedSkinColorsBySkinId((currentValue) => ({
            ...currentValue,
            [onboardingPreset.id]: normalizeAvatarColorSelections(onboardingPreset, profile.skinColors),
          }))
          setInitialSkinSetupOpen(true)
          return
        }

        setInitialSkinSetupOpen(false)
        const routeTemplate = resolveRoomTemplateFromPath(window.location.pathname)
        startSceneLoad(routeTemplate.id, null)
        nextSocket.emit(clientEvents.joinRoom, {
          templateId: routeTemplate.id,
          transition: 'direct',
        })
      },
    )

    nextSocket.on(serverEvents.socialState, ({ friends, incomingFriendRequests, outgoingFriendRequestUserIds }: SocialStatePayload) => {
      applySocialState({
        nextFriends: friends,
        nextIncomingFriendRequests: incomingFriendRequests,
        nextOutgoingFriendRequestUserIds: outgoingFriendRequestUserIds,
      })
    })

    nextSocket.on(serverEvents.partyState, ({ party, incomingPartyInvites, outgoingPartyInvites }: PartyStatePayload) => {
      applyPartyState({
        nextParty: party,
        nextIncomingPartyInvites: incomingPartyInvites,
        nextOutgoingPartyInvites: outgoingPartyInvites,
      })
    })

    nextSocket.on(serverEvents.friendRequestReceived, (request: FriendRequestSummary) => {
      void playUiSound('friend-request')
      setIncomingFriendRequests((currentValue) =>
        currentValue.some((currentRequest) => currentRequest.requestId === request.requestId)
          ? currentValue
          : [request, ...currentValue],
      )
    })

    nextSocket.on(serverEvents.partyInviteReceived, (invite: PartyInviteSummary) => {
      void playUiSound('friend-request')
      setIncomingPartyInvites((currentValue) =>
        currentValue.some((currentInvite) => currentInvite.inviteId === invite.inviteId)
          ? currentValue
          : [invite, ...currentValue],
      )
    })

    nextSocket.on(serverEvents.enemyCombatSupportInviteReceived, (invite: EnemyCombatSupportInvitePayload) => {
      void playUiSound('friend-request')
      setEnemyCombatSupportInvites((currentValue) =>
        currentValue.some((currentInvite) => currentInvite.encounterId === invite.encounterId)
          ? currentValue
          : [invite, ...currentValue],
      )
    })

    nextSocket.on(serverEvents.partyLeaderFollowRequested, (prompt: PartyLeaderFollowPromptPayload) => {
      void playUiSound('friend-request')
      setRespondingPartyLeaderFollow(false)
      setPartyLeaderFollowPrompt(prompt)
    })

    nextSocket.on(serverEvents.activityNotice, (notice: ActivityNoticePayload) => {
      enqueueActivityNotice(notice.title, notice.message)
    })

    nextSocket.on(serverEvents.serverError, (payload: ServerErrorPayload) => {
      enqueueActivityNotice('Aviso del sistema', payload.message)
    })

    nextSocket.on(serverEvents.roomTransitionRequested, (payload: RoomTransitionRequestedPayload) => {
      dismissPartyLeaderFollowPrompt()
      transitionToRoom(payload.templateId, payload.spawnPosition, {
        roomId: payload.roomId,
        transition: payload.transition,
        allowPartyFollower: true,
      })
    })

    nextSocket.on(serverEvents.roomState, (nextRoom: RoomState) => {
      setRoom(nextRoom)
      const pendingSceneLoad = pendingSceneLoadRef.current
      if (
        pendingSceneLoad &&
        pendingSceneLoad.templateId === nextRoom.templateId &&
        (pendingSceneLoad.roomId === null || pendingSceneLoad.roomId === nextRoom.roomId)
      ) {
        pendingSceneLoad.roomReady = true
        finishPendingSceneLoad()
        return
      }

      const routeTemplate = resolveRoomTemplateFromPath(window.location.pathname)
      if (!pendingSceneLoad && nextRoom.templateId === routeTemplate.id) {
        setSceneLoadingVisible(false)
      }
    })

    nextSocket.on(serverEvents.roomEnemiesState, (payload: RoomEnemiesStatePayload) => {
      setRoom((currentRoom) => {
        if (!currentRoom || currentRoom.roomId !== payload.roomId) {
          return currentRoom
        }

        return {
          ...currentRoom,
          enemies: payload.enemies,
        }
      })
    })

    nextSocket.on(serverEvents.roomEnemyCombatState, (payload: RoomEnemyCombatStatePayload) => {
      const previousEncounters = roomEnemyCombatEncountersRef.current
      const removedEncounterEnemyIds = previousEncounters
        .filter(
          (previousEncounter) =>
            !payload.encounters.some((nextEncounter) => nextEncounter.encounterId === previousEncounter.encounterId),
        )
        .map((previousEncounter) => previousEncounter.enemyId)

      roomEnemyCombatEncountersRef.current = payload.encounters
      setRoomEnemyCombatEncounters(payload.encounters)

      removedEncounterEnemyIds.forEach((enemyId) => {
        blockEnemyInteractionFor(enemyId, ENEMY_ESCAPE_INTERACTION_COOLDOWN_MS)
      })

      const currentUserId = sessionProfileRef.current.userId
      const activeEncounter =
        payload.encounters.find((encounter) =>
          encounter.participants.some((participant) => participant.userId === currentUserId),
        ) ?? null

      if (!activeEncounter) {
        setStartingEnemyCombatEncounterId(null)
        setFleeingEnemyCombatEncounterId(null)
      } else if (activeEncounter.phase === 'battle') {
        setStartingEnemyCombatEncounterId((currentValue) =>
          currentValue === activeEncounter.encounterId ? null : currentValue,
        )
      }

      setEnemyCombatSupportInvites((currentValue) =>
        currentValue.filter((currentInvite) => {
          const encounter = payload.encounters.find(
            (candidateEncounter) => candidateEncounter.encounterId === currentInvite.encounterId,
          )
          if (!encounter) {
            return false
          }

          if (encounter.phase !== 'lobby') {
            return false
          }

          return !encounter.participants.some((participant) => participant.userId === currentUserId)
        }),
      )

      setActiveTouchPrompt((currentValue) => {
        if (!activeEncounter) {
          return currentValue?.kind === 'enemy' ? null : currentValue
        }

        const nextPrompt = buildEnemyCombatPromptState(activeEncounter)
        if (currentValue?.kind === 'npc') {
          return nextPrompt
        }

        if (currentValue?.kind === 'enemy' && currentValue.encounterId === activeEncounter.encounterId) {
          return nextPrompt
        }

        return nextPrompt
      })
    })

    nextSocket.on(serverEvents.playerJoined, (player: Presence) => {
      setRoom((currentRoom) => {
        if (!currentRoom) return currentRoom

        const existingIndex = currentRoom.players.findIndex(
          (currentPlayer) => currentPlayer.sessionId === player.sessionId,
        )
        if (existingIndex >= 0) {
          const nextPlayers = currentRoom.players.slice()
          nextPlayers[existingIndex] = player
          return { ...currentRoom, players: nextPlayers }
        }

        return { ...currentRoom, players: [...currentRoom.players, player] }
      })
    })

    nextSocket.on(serverEvents.playerMoved, (player: Presence) => {
      setRoom((currentRoom) => {
        if (!currentRoom) return currentRoom
        return {
          ...currentRoom,
          players: currentRoom.players.map((currentPlayer) =>
            currentPlayer.sessionId === player.sessionId ? player : currentPlayer,
          ),
        }
      })
    })

    nextSocket.on(serverEvents.playerLeft, ({ sessionId }: { sessionId: string }) => {
      const departedPlayer = roomRef.current?.players.find((player) => player.sessionId === sessionId)
      if (departedPlayer) {
        clearPlayerSpeech(departedPlayer.userId)
        clearPlayerTyping(departedPlayer.userId)
      }

      setRoom((currentRoom) => {
        if (!currentRoom) return currentRoom
        return {
          ...currentRoom,
          players: currentRoom.players.filter((player) => player.sessionId !== sessionId),
        }
      })
    })

    nextSocket.on(serverEvents.typingStateChanged, (payload: TypingStateChangedPayload) => {
      setPlayerTyping(payload.userId, payload.isTyping)
    })

    nextSocket.on(serverEvents.chatMessage, (message: ChatMessage) => {
      clearPlayerTyping(message.userId)
      setMessages((currentMessages) => [...currentMessages, message])
      showPlayerSpeech(message)
      if (!chatOpenRef.current) {
        if (message.userId !== session.profile.userId) {
          void playUiSound('chat-bubble')
        }
        enqueueFloatingMessage(message)
      }
    })

    return () => {
      clearAllFriendRequestPopupTimeouts()
      clearAllPartyInvitePopupTimeouts()
      clearAllActivityNoticeTimeouts()
      clearSceneLoadingHideTimeout()
      clearSceneLoadingFailsafeTimeout()
      socketRef.current = null
      nextSocket.disconnect()
    }
  }, [
    clearAllActivityNoticeTimeouts,
    clearAllFriendRequestPopupTimeouts,
    clearAllPartyInvitePopupTimeouts,
    session.profile.userId,
  ])

  const currentPlayer =
    room?.players.find((player) => player.userId === session.profile.userId) ?? null
  const debugPositionX = currentPlayer ? Math.round(currentPlayer.position.x) : null
  const debugPositionY = currentPlayer ? Math.round(currentPlayer.position.y) : null

  useEffect(() => {
    clearSceneLoadingFailsafeTimeout()

    if (!sceneLoadingVisible) {
      return
    }

    sceneLoadingFailsafeTimeoutRef.current = window.setTimeout(() => {
      sceneLoadingFailsafeTimeoutRef.current = null
      pendingSceneLoadRef.current = null
      clearSceneLoadingHideTimeout()
      setSceneLoadingVisible(false)
    }, SCENE_LOADING_FAILSAFE_MS)

    return () => {
      clearSceneLoadingFailsafeTimeout()
    }
  }, [
    clearSceneLoadingFailsafeTimeout,
    clearSceneLoadingHideTimeout,
    sceneLoadingVisible,
  ])

  const appliedSkinId = currentPlayer?.skinId ?? sessionProfileRef.current.skinId
  const appliedSkinPreset = resolveAvatarPreset(appliedSkinId)
  const appliedSkinColors = normalizeAvatarColorSelections(
    appliedSkinPreset,
    currentPlayer?.skinColors ?? sessionProfileRef.current.skinColors,
  )
  const appliedPrimaryColor = resolveAvatarPrimaryColor(appliedSkinPreset, appliedSkinColors)
  const userAvatarFrameColors = {
    fill: mixHexColor(appliedPrimaryColor, '#FFFFFF', 0.64),
    edge: mixHexColor(appliedPrimaryColor, '#000000', 0.26),
    shadow: withAlpha(mixHexColor(appliedPrimaryColor, '#000000', 0.34), 0.24),
  }
  const userMetaFrameColors = {
    fill: mixHexColor(appliedPrimaryColor, '#FFFFFF', 0.68),
    edge: mixHexColor(appliedPrimaryColor, '#000000', 0.34),
    ink: mixHexColor(appliedPrimaryColor, '#000000', 0.62),
    subInk: mixHexColor(appliedPrimaryColor, '#000000', 0.4),
    shadow: withAlpha(mixHexColor(appliedPrimaryColor, '#000000', 0.38), 0.24),
  }
  const appliedSkinColorsKey = JSON.stringify(appliedSkinColors)
  const selectedSkinPreset = resolveAvatarPreset(selectedSkinId)
  const selectedSkinColors =
    selectedSkinColorsBySkinId[selectedSkinPreset.id] ??
    getDefaultAvatarColorSelections(selectedSkinPreset)
  const musicVolumePercent = Math.round(audioSettings.musicVolume * 100)
  const sfxVolumePercent = Math.round(audioSettings.sfxVolume * 100)
  const activePlayers = room?.players ?? []
  const friendUserIds = new Set(friends.map((friend) => friend.userId))
  const incomingFriendRequestUserIds = new Set(incomingFriendRequests.map((request) => request.fromUserId))
  const outgoingFriendRequestUserIdSet = new Set(outgoingFriendRequestUserIds)
  const partyMemberUserIds = new Set((party?.members ?? []).map((member) => member.userId))
  const outgoingPartyInviteUserIdSet = new Set(outgoingPartyInvites.map((invite) => invite.toUserId))
  const isPartyLeader = party?.leaderUserId === session.profile.userId
  const partyLeaderDisplayName =
    party?.members.find((member) => member.userId === party.leaderUserId)?.displayName ?? 'Sin lider'
  const pendingFriendRequestCount = incomingFriendRequests.length
  const currentDialogueLine = activeDialogue
    ? activeDialogue.dialogue.lines[activeDialogue.lineIndex] ?? ''
    : ''
  const isDialogueLineComplete = dialogueVisibleChars >= currentDialogueLine.length
  const quickChatShortcutDisabled =
    chatOpen || Boolean(activeDialogue) || Boolean(activeTouchPrompt) || initialSkinSetupOpen || skinEditorOpen
  const playerIdentityShortcutLabel =
    playerIdentityMode === 'icons' ? 'siglas' : 'nombres'
  const quickChatShortcutLabel = chatOpen
    ? 'chat abierto'
    : quickChatOpen
      ? chatInput.trim()
        ? 'enviar chat'
      : 'cerrar chat'
      : 'chat rapido'

  const finishPendingSceneLoad = useEffectEvent(() => {
    const pendingSceneLoad = pendingSceneLoadRef.current
    if (!pendingSceneLoad || !pendingSceneLoad.assetsReady || !pendingSceneLoad.roomReady) {
      return
    }

    pendingSceneLoadRef.current = null
    clearSceneLoadingHideTimeout()
    sceneLoadingHideTimeoutRef.current = window.setTimeout(() => {
      sceneLoadingHideTimeoutRef.current = null
      if (pendingSceneLoadRef.current) {
        return
      }

      clearSceneLoadingFailsafeTimeout()
      setSceneLoadingVisible(false)
    }, SCENE_LOADING_EXTRA_HOLD_MS)
  })

  const startSceneLoad = useEffectEvent((templateId: string, roomId: string | null) => {
    const targetTemplate = getRoomTemplateById(templateId)
    if (!targetTemplate) {
      clearSceneLoadingHideTimeout()
      clearSceneLoadingFailsafeTimeout()
      pendingSceneLoadRef.current = null
      setSceneLoadingVisible(false)
      return
    }

    clearSceneLoadingHideTimeout()
    clearSceneLoadingFailsafeTimeout()
    const sequence = sceneLoadSequenceRef.current + 1
    sceneLoadSequenceRef.current = sequence
    pendingSceneLoadRef.current = {
      sequence,
      templateId,
      roomId,
      assetsReady: false,
      roomReady: false,
    }
    setSceneLoadingVisible(true)

    const currentProfile = sessionProfileRef.current
    const loadingPreset = resolveAvatarPreset(currentProfile.skinId)
    const loadingSheetUrl = resolveAvatarSheetUrl(
      loadingPreset,
      normalizeAvatarColorSelections(loadingPreset, currentProfile.skinColors),
    )

    void Promise.allSettled([
      preloadRoomTemplateAssets(targetTemplate),
      preloadImageAsset(loadingSheetUrl),
      ...SCENE_LOADING_LAYER_ASSETS.map((assetUrl) => preloadImageAsset(assetUrl)),
    ]).then((results) => {
      if (import.meta.env.DEV) {
        const rejectedResults = results.filter((result) => result.status === 'rejected')
        if (rejectedResults.length > 0) {
          console.warn('[scene-loading] Some assets failed to preload, continuing anyway.', rejectedResults)
        }
      }

      const activePendingLoad = pendingSceneLoadRef.current
      if (!activePendingLoad || activePendingLoad.sequence !== sequence) {
        return
      }

      activePendingLoad.assetsReady = true
      finishPendingSceneLoad()
    })
  })

  useEffect(() => {
    if (!optionsOpen) {
      return
    }

    socketRef.current?.emit(clientEvents.requestSocialState)
    socketRef.current?.emit(clientEvents.requestPartyState)
  }, [optionsOpen])

  const handleOpenChat = () => {
    void playUiSound('panel-open')
    floatingTimeoutsRef.current.forEach((timeoutId) => window.clearTimeout(timeoutId))
    floatingTimeoutsRef.current.clear()
    setFloatingMessages([])
    setQuickChatOpen(false)
    setChatOpen(true)
  }

  const handleCloseChat = useEffectEvent(() => {
    stopLocalTyping()
    void playUiSound('panel-close')
    setChatOpen(false)
  })

  const toggleOptionsMenu = useEffectEvent(() => {
    void playUiSound(optionsOpen ? 'menu-close' : 'menu-open')
    setOptionsOpen((isOpen) => !isOpen)
  })

  const closeOptionsMenu = useEffectEvent(() => {
    if (!optionsOpen) {
      return
    }

    void playUiSound('menu-close')
    setOptionsOpen(false)
  })

  const openSkinEditorFromMenu = useEffectEvent(() => {
    setOptionsOpen(false)
    toggleSkinEditor()
  })

  useEffect(() => {
    const handleEscapeMenuShortcut = (event: KeyboardEvent) => {
      if (event.repeat || event.key !== 'Escape') {
        return
      }

      const target = event.target as HTMLElement | null
      const tagName = target?.tagName?.toLowerCase()
      const isTyping =
        tagName === 'input' ||
        tagName === 'textarea' ||
        target?.isContentEditable === true

      if (isTyping) {
        return
      }

      if (optionsOpen) {
        event.preventDefault()
        void playUiSound('menu-close')
        setOptionsOpen(false)
        return
      }

      if (activeDialogue || activeTouchPrompt || initialSkinSetupOpen || skinEditorOpen) {
        return
      }

      event.preventDefault()
      void playUiSound('menu-open')
      setOptionsOpen(true)
    }

    window.addEventListener('keydown', handleEscapeMenuShortcut)
    return () => window.removeEventListener('keydown', handleEscapeMenuShortcut)
  }, [activeDialogue, activeTouchPrompt, initialSkinSetupOpen, optionsOpen, skinEditorOpen])

  const requestStopMovement = useEffectEvent(() => {
    const socket = socketRef.current
    if (!socket || !room || !connected) {
      return
    }

    socket.emit(clientEvents.stopNavigation, {
      roomId: room.roomId,
    })
  })

  const emitMovementInput = useEffectEvent((nextInput: MovementInputState) => {
    const socket = socketRef.current
    const activeRoom = roomRef.current

    if (areMovementInputsEqual(movementInputRef.current, nextInput)) {
      return
    }

    const hadMovement = hasMovementInput(movementInputRef.current)
    const hasNextMovement = hasMovementInput(nextInput)
    movementInputRef.current = nextInput

    if (!socket || !activeRoom || !connected) {
      return
    }

    if (hasNextMovement && !hadMovement) {
      socket.emit(clientEvents.stopNavigation, {
        roomId: activeRoom.roomId,
      })
    }

    socket.emit(clientEvents.setMovementInput, {
      roomId: activeRoom.roomId,
      ...nextInput,
    })
  })

  const resetKeyboardMovement = useEffectEvent(() => {
    pressedMovementKeyCodesRef.current.clear()
    emitMovementInput(EMPTY_MOVEMENT_INPUT)
  })

  useEffect(() => {
    const handleMovementKeyDown = (event: KeyboardEvent) => {
      if (event.repeat || !MOVEMENT_KEY_CODES.has(event.code)) {
        return
      }

      const target = event.target as HTMLElement | null
      const tagName = target?.tagName?.toLowerCase()
      const isTyping =
        tagName === 'input' ||
        tagName === 'textarea' ||
        target?.isContentEditable === true

      if (
        isTyping ||
        !connected ||
        !room ||
        sceneLoadingVisible ||
        chatOpen ||
        quickChatOpen ||
        optionsOpen ||
        activeDialogue ||
        activeTouchPrompt ||
        partyLeaderFollowPrompt ||
        skinEditorOpen ||
        initialSkinSetupOpen
      ) {
        return
      }

      if (pressedMovementKeyCodesRef.current.has(event.code)) {
        return
      }

      event.preventDefault()
      pressedMovementKeyCodesRef.current.add(event.code)
      emitMovementInput(buildMovementInputFromKeyCodes(pressedMovementKeyCodesRef.current))
    }

    const handleMovementKeyUp = (event: KeyboardEvent) => {
      if (!MOVEMENT_KEY_CODES.has(event.code)) {
        return
      }

      const didDeleteKey = pressedMovementKeyCodesRef.current.delete(event.code)
      if (!didDeleteKey) {
        return
      }

      event.preventDefault()
      emitMovementInput(buildMovementInputFromKeyCodes(pressedMovementKeyCodesRef.current))
    }

    const handleWindowBlur = () => {
      resetKeyboardMovement()
    }

    window.addEventListener('keydown', handleMovementKeyDown)
    window.addEventListener('keyup', handleMovementKeyUp)
    window.addEventListener('blur', handleWindowBlur)

    return () => {
      window.removeEventListener('keydown', handleMovementKeyDown)
      window.removeEventListener('keyup', handleMovementKeyUp)
      window.removeEventListener('blur', handleWindowBlur)
    }
  }, [
    activeDialogue,
    activeTouchPrompt,
    chatOpen,
    connected,
    initialSkinSetupOpen,
    optionsOpen,
    partyLeaderFollowPrompt,
    quickChatOpen,
    room,
    sceneLoadingVisible,
    skinEditorOpen,
  ])

  useEffect(() => {
    if (
      connected &&
      room &&
      !sceneLoadingVisible &&
      !chatOpen &&
      !quickChatOpen &&
      !optionsOpen &&
      !activeDialogue &&
      !activeTouchPrompt &&
      !partyLeaderFollowPrompt &&
      !skinEditorOpen &&
      !initialSkinSetupOpen
    ) {
      return
    }

    resetKeyboardMovement()
  }, [
    activeDialogue,
    activeTouchPrompt,
    chatOpen,
    connected,
    initialSkinSetupOpen,
    optionsOpen,
    partyLeaderFollowPrompt,
    quickChatOpen,
    room,
    sceneLoadingVisible,
    skinEditorOpen,
  ])

  const closeActiveTouchPrompt = useEffectEvent(() => {
    void playUiSound('panel-close')
    setActiveTouchPrompt(null)
  })

  const clearEnemyInteractionCooldown = useEffectEvent((enemyId: string) => {
    const timeoutId = enemyInteractionCooldownTimeoutsRef.current.get(enemyId)
    if (timeoutId) {
      window.clearTimeout(timeoutId)
      enemyInteractionCooldownTimeoutsRef.current.delete(enemyId)
    }
  })

  const blockEnemyInteractionFor = useEffectEvent((enemyId: string, cooldownMs: number) => {
    clearEnemyInteractionCooldown(enemyId)
    setBlockedEnemyInteractionIds((currentValue) =>
      currentValue.includes(enemyId) ? currentValue : [...currentValue, enemyId],
    )

    const timeoutId = window.setTimeout(() => {
      enemyInteractionCooldownTimeoutsRef.current.delete(enemyId)
      setBlockedEnemyInteractionIds((currentValue) => currentValue.filter((currentEnemyId) => currentEnemyId !== enemyId))
    }, cooldownMs)

    enemyInteractionCooldownTimeoutsRef.current.set(enemyId, timeoutId)
  })

  const clearFriendRequestPopupTimeout = useEffectEvent((requestId: string) => {
    const timeoutId = friendRequestPopupTimeoutsRef.current.get(requestId)
    if (timeoutId) {
      window.clearTimeout(timeoutId)
      friendRequestPopupTimeoutsRef.current.delete(requestId)
    }
  })

  const dismissFriendRequestPopup = useEffectEvent((requestId: string) => {
    dismissedFriendRequestIdsRef.current.add(requestId)
    clearFriendRequestPopupTimeout(requestId)
    setFriendRequestPopups((currentValue) =>
      currentValue.filter((currentRequest) => currentRequest.requestId !== requestId),
    )
  })

  useEffect(() => {
    const availableRequestIds = new Set(incomingFriendRequests.map((request) => request.requestId))
    dismissedFriendRequestIdsRef.current.forEach((requestId) => {
      if (!availableRequestIds.has(requestId)) {
        dismissedFriendRequestIdsRef.current.delete(requestId)
      }
    })

    const now = Date.now()
    const currentPopups = friendRequestPopupsRef.current
    const incomingRequestsById = new Map(
      incomingFriendRequests.map((request) => [request.requestId, request] as const),
    )
    const nextPopups = currentPopups.flatMap((popup) => {
      const latestRequest = incomingRequestsById.get(popup.requestId)
      if (!latestRequest) {
        clearFriendRequestPopupTimeout(popup.requestId)
        return []
      }

      return [{ ...popup, ...latestRequest }]
    })
    const existingIds = new Set(nextPopups.map((popup) => popup.requestId))

    incomingFriendRequests.forEach((request) => {
      if (existingIds.has(request.requestId) || dismissedFriendRequestIdsRef.current.has(request.requestId)) {
        return
      }

      const expiresAt = now + FRIEND_REQUEST_POPUP_DURATION_MS
      nextPopups.push({ ...request, expiresAt })
      existingIds.add(request.requestId)
      clearFriendRequestPopupTimeout(request.requestId)
      const timeoutId = window.setTimeout(() => {
        dismissFriendRequestPopup(request.requestId)
      }, FRIEND_REQUEST_POPUP_DURATION_MS)
      friendRequestPopupTimeoutsRef.current.set(request.requestId, timeoutId)
    })

    friendRequestPopupsRef.current = nextPopups
    setFriendRequestPopups(nextPopups)
  }, [FRIEND_REQUEST_POPUP_DURATION_MS, incomingFriendRequests])

  const clearPartyInvitePopupTimeout = useEffectEvent((inviteId: string) => {
    const timeoutId = partyInvitePopupTimeoutsRef.current.get(inviteId)
    if (timeoutId) {
      window.clearTimeout(timeoutId)
      partyInvitePopupTimeoutsRef.current.delete(inviteId)
    }
  })

  const dismissPartyInvitePopup = useEffectEvent((inviteId: string, requestStateRefresh = false) => {
    dismissedPartyInviteIdsRef.current.add(inviteId)
    clearPartyInvitePopupTimeout(inviteId)
    setPartyInvitePopups((currentValue) =>
      currentValue.filter((currentInvite) => currentInvite.inviteId !== inviteId),
    )

    if (requestStateRefresh) {
      socketRef.current?.emit(clientEvents.requestPartyState)
    }
  })

  const dismissEnemyCombatSupportInvite = useEffectEvent((encounterId: string) => {
    setEnemyCombatSupportInvites((currentValue) =>
      currentValue.filter((currentInvite) => currentInvite.encounterId !== encounterId),
    )
  })

  useEffect(() => {
    const availableInviteIds = new Set(incomingPartyInvites.map((invite) => invite.inviteId))
    dismissedPartyInviteIdsRef.current.forEach((inviteId) => {
      if (!availableInviteIds.has(inviteId)) {
        dismissedPartyInviteIdsRef.current.delete(inviteId)
      }
    })

    const now = Date.now()
    const currentPopups = partyInvitePopupsRef.current
    const incomingInvitesById = new Map(
      incomingPartyInvites.map((invite) => [invite.inviteId, invite] as const),
    )
    const nextPopups = currentPopups.flatMap((popup) => {
      const latestInvite = incomingInvitesById.get(popup.inviteId)
      const expiresAt = latestInvite ? new Date(latestInvite.expiresAt).getTime() : NaN
      if (!latestInvite || !Number.isFinite(expiresAt) || expiresAt <= now) {
        clearPartyInvitePopupTimeout(popup.inviteId)
        return []
      }

      return [latestInvite]
    })
    const existingIds = new Set(nextPopups.map((popup) => popup.inviteId))

    incomingPartyInvites.forEach((invite) => {
      const expiresAt = new Date(invite.expiresAt).getTime()
      if (
        existingIds.has(invite.inviteId) ||
        dismissedPartyInviteIdsRef.current.has(invite.inviteId) ||
        !Number.isFinite(expiresAt) ||
        expiresAt <= now
      ) {
        return
      }

      nextPopups.push(invite)
      existingIds.add(invite.inviteId)
      clearPartyInvitePopupTimeout(invite.inviteId)
      const timeoutId = window.setTimeout(() => {
        dismissPartyInvitePopup(invite.inviteId, true)
      }, Math.max(0, expiresAt - now))
      partyInvitePopupTimeoutsRef.current.set(invite.inviteId, timeoutId)
    })

    partyInvitePopupsRef.current = nextPopups
    setPartyInvitePopups(nextPopups)
  }, [incomingPartyInvites])

  useEffect(() => {
    if (partyInviteStateRefreshTimeoutRef.current) {
      window.clearTimeout(partyInviteStateRefreshTimeoutRef.current)
      partyInviteStateRefreshTimeoutRef.current = null
    }

    if (!connected) {
      return
    }

    const now = Date.now()
    const nextExpiry = [...incomingPartyInvites, ...outgoingPartyInvites]
      .map((invite) => new Date(invite.expiresAt).getTime())
      .filter((expiresAt) => Number.isFinite(expiresAt) && expiresAt > now)
      .sort((left, right) => left - right)[0]

    if (!nextExpiry) {
      return
    }

    partyInviteStateRefreshTimeoutRef.current = window.setTimeout(() => {
      partyInviteStateRefreshTimeoutRef.current = null
      socketRef.current?.emit(clientEvents.requestPartyState)
    }, Math.max(250, nextExpiry - now + 150))

    return () => {
      if (partyInviteStateRefreshTimeoutRef.current) {
        window.clearTimeout(partyInviteStateRefreshTimeoutRef.current)
        partyInviteStateRefreshTimeoutRef.current = null
      }
    }
  }, [connected, incomingPartyInvites, outgoingPartyInvites])

  useEffect(() => {
    if (partyLeaderFollowPromptTimeoutRef.current) {
      window.clearTimeout(partyLeaderFollowPromptTimeoutRef.current)
      partyLeaderFollowPromptTimeoutRef.current = null
    }

    if (!partyLeaderFollowPrompt) {
      return
    }

    const expiresAt = new Date(partyLeaderFollowPrompt.expiresAt).getTime()
    if (!Number.isFinite(expiresAt)) {
      return
    }

    partyLeaderFollowPromptTimeoutRef.current = window.setTimeout(() => {
      partyLeaderFollowPromptTimeoutRef.current = null
      setPartyLeaderFollowPrompt((currentValue) =>
        currentValue?.requestId === partyLeaderFollowPrompt.requestId ? null : currentValue,
      )
      setRespondingPartyLeaderFollow(false)
    }, Math.max(1_000, expiresAt - Date.now() + 2_000))

    return () => {
      if (partyLeaderFollowPromptTimeoutRef.current) {
        window.clearTimeout(partyLeaderFollowPromptTimeoutRef.current)
        partyLeaderFollowPromptTimeoutRef.current = null
      }
    }
  }, [partyLeaderFollowPrompt])

  const handleAddFriend = useEffectEvent((friendUserId: string) => {
    const socket = socketRef.current
    if (!socket || addingFriendUserId) {
      return
    }

    void playUiSound('send')
    setAddingFriendUserId(friendUserId)
    socket.emit(
      clientEvents.addFriend,
      { friendUserId },
      (response: { ok: boolean }) => {
        setAddingFriendUserId(null)
        if (response.ok) {
          socket.emit(clientEvents.requestSocialState)
        }
      },
    )
  })

  const handleRespondToFriendRequest = useEffectEvent((requestId: string, action: 'accept' | 'reject') => {
    const socket = socketRef.current
    if (!socket || respondingFriendRequestId) {
      return
    }

    void playUiSound(action === 'accept' ? 'confirm' : 'cancel')
    setRespondingFriendRequestId(requestId)
    socket.emit(
      clientEvents.respondFriendRequest,
      { requestId, action },
      (response: { ok: boolean }) => {
        setRespondingFriendRequestId(null)
        if (response.ok) {
          dismissedFriendRequestIdsRef.current.delete(requestId)
          setIncomingFriendRequests((currentValue) =>
            currentValue.filter((currentRequest) => currentRequest.requestId !== requestId),
          )
          dismissFriendRequestPopup(requestId)
          socket.emit(clientEvents.requestSocialState)
        }
      },
    )
  })

  const handleRemoveFriend = useEffectEvent((friendUserId: string) => {
    const socket = socketRef.current
    if (!socket || removingFriendUserId) {
      return
    }

    void playUiSound('cancel')
    setRemovingFriendUserId(friendUserId)
    socket.emit(clientEvents.removeFriend, { friendUserId }, (response: { ok: boolean }) => {
      setRemovingFriendUserId(null)
      if (response.ok) {
        socket.emit(clientEvents.requestSocialState)
      }
    })
  })

  const handleInviteToParty = useEffectEvent((friendUserId: string) => {
    const socket = socketRef.current
    if (!socket || invitingPartyUserId) {
      return
    }

    void playUiSound('send')
    setInvitingPartyUserId(friendUserId)
    socket.emit(clientEvents.inviteToParty, { friendUserId }, (response: { ok: boolean }) => {
      setInvitingPartyUserId(null)
      if (response.ok) {
        socket.emit(clientEvents.requestPartyState)
      }
    })
  })

  const handleRespondToPartyInvite = useEffectEvent((inviteId: string, action: 'accept' | 'reject') => {
    const socket = socketRef.current
    if (!socket || respondingPartyInviteId) {
      return
    }

    void playUiSound(action === 'accept' ? 'confirm' : 'cancel')
    setRespondingPartyInviteId(inviteId)
    socket.emit(clientEvents.respondPartyInvite, { inviteId, action }, (response: { ok: boolean }) => {
      setRespondingPartyInviteId(null)
      if (response.ok) {
        setIncomingPartyInvites((currentValue) =>
          currentValue.filter((currentInvite) => currentInvite.inviteId !== inviteId),
        )
        dismissPartyInvitePopup(inviteId)
        socket.emit(clientEvents.requestPartyState)
      }
    })
  })

  const handleRespondToEnemyCombatSupportInvite = useEffectEvent(
    (encounterId: string, action: 'accept' | 'reject') => {
      const socket = socketRef.current
      if (!socket || respondingEnemyCombatInviteId) {
        return
      }

      void playUiSound(action === 'accept' ? 'confirm' : 'cancel')
      setRespondingEnemyCombatInviteId(encounterId)
      socket.emit(
        clientEvents.respondEnemyCombatSupport,
        { encounterId, action },
        (response: { ok: boolean; message?: string }) => {
          setRespondingEnemyCombatInviteId((currentValue) => (currentValue === encounterId ? null : currentValue))

          if (!response.ok) {
            if (response.message) {
              enqueueActivityNotice('Aviso del sistema', response.message)
            }
            return
          }

          dismissEnemyCombatSupportInvite(encounterId)
        },
      )
    },
  )

  const handleRespondToPartyLeaderFollow = useEffectEvent((action: 'accept' | 'reject') => {
    const socket = socketRef.current
    if (!socket || !partyLeaderFollowPrompt || respondingPartyLeaderFollow) {
      return
    }

    void playUiSound(action === 'accept' ? 'confirm' : 'cancel')
    setRespondingPartyLeaderFollow(true)
    socket.emit(
      clientEvents.respondPartyLeaderFollow,
      { requestId: partyLeaderFollowPrompt.requestId, action },
      (response: { ok: boolean }) => {
        if (!response.ok) {
          setRespondingPartyLeaderFollow(false)
          return
        }

        dismissPartyLeaderFollowPrompt()
      },
    )
  })

  const handleLeaveParty = useEffectEvent(() => {
    const socket = socketRef.current
    if (!socket || leavingParty) {
      return
    }

    void playUiSound('cancel')
    setLeavingParty(true)
    socket.emit(clientEvents.leaveParty, {}, (response: { ok: boolean }) => {
      setLeavingParty(false)
      if (response.ok) {
        socket.emit(clientEvents.requestPartyState)
      }
    })
  })

  const handlePromotePartyLeader = useEffectEvent((nextLeaderUserId: string) => {
    const socket = socketRef.current
    if (!socket || promotingPartyLeaderUserId) {
      return
    }

    void playUiSound('confirm')
    setPromotingPartyLeaderUserId(nextLeaderUserId)
    socket.emit(
      clientEvents.promotePartyLeader,
      { nextLeaderUserId },
      (response: { ok: boolean }) => {
        setPromotingPartyLeaderUserId(null)
        if (response.ok) {
          socket.emit(clientEvents.requestPartyState)
        }
      },
    )
  })

  const handleDismissFriendRequestPopup = useEffectEvent((requestId: string) => {
    void playUiSound('panel-close')
    dismissFriendRequestPopup(requestId)
  })

  const handleDismissPartyInvitePopup = useEffectEvent((inviteId: string) => {
    void playUiSound('panel-close')
    dismissPartyInvitePopup(inviteId)
  })

  const commitAudioSettingsSession = useEffectEvent((nextSettings: AudioSettings) => {
    const currentSession = sessionRef.current
    const nextProfile = {
      ...currentSession.profile,
      audioSettings: nextSettings,
    }
    const nextSession: AuthSession = {
      ...currentSession,
      profile: nextProfile,
    }

    sessionRef.current = nextSession
    sessionProfileRef.current = nextProfile
    if (currentSession.provider === 'local') {
      saveAuthSession(nextSession)
    }
    onSessionChange?.(nextSession)
  })

  const persistAudioSettings = useEffectEvent((nextSettings: AudioSettings, immediate = false) => {
    commitAudioSettingsSession(nextSettings)

    if (persistAudioSettingsTimeoutRef.current) {
      window.clearTimeout(persistAudioSettingsTimeoutRef.current)
      persistAudioSettingsTimeoutRef.current = null
    }

    const socket = socketRef.current
    if (!socket || !connected) {
      pendingAudioSettingsSyncRef.current = nextSettings
      return
    }

    const emitUpdate = () => {
      socket.emit(
        clientEvents.updateAudioSettings,
        { audioSettings: nextSettings },
        (response: { ok: boolean; profile?: AuthSession['profile'] }) => {
          if (!response.ok || !response.profile) {
            return
          }

          const currentSession = sessionRef.current
          const nextSession: AuthSession = {
            ...currentSession,
            profile: response.profile,
          }

          sessionRef.current = nextSession
          sessionProfileRef.current = response.profile
          if (currentSession.provider === 'local') {
            saveAuthSession(nextSession)
          }
          onSessionChange?.(nextSession)
        },
      )
    }

    if (immediate) {
      emitUpdate()
      return
    }

    persistAudioSettingsTimeoutRef.current = window.setTimeout(() => {
      persistAudioSettingsTimeoutRef.current = null
      emitUpdate()
    }, 260)
  })

  const handleToggleMusic = useEffectEvent(() => {
    void ensureAudioUnlocked()
    void playUiSound('select')

    const nextEnabled = !audioSettings.musicEnabled
    const nextSettings = {
      ...audioSettings,
      musicEnabled: nextEnabled,
      musicVolume:
        nextEnabled && audioSettings.musicVolume <= 0
          ? DEFAULT_AUDIO_SETTINGS.musicVolume
          : audioSettings.musicVolume,
    }

    setAudioSettings(nextSettings)
    persistAudioSettings(nextSettings, true)
  })

  const handleToggleSfx = useEffectEvent(() => {
    void ensureAudioUnlocked()
    if (!audioSettings.sfxEnabled) {
      void playUiSound('select')
    }

    const nextEnabled = !audioSettings.sfxEnabled
    const nextSettings = {
      ...audioSettings,
      sfxEnabled: nextEnabled,
      sfxVolume:
        nextEnabled && audioSettings.sfxVolume <= 0
          ? DEFAULT_AUDIO_SETTINGS.sfxVolume
          : audioSettings.sfxVolume,
    }

    setAudioSettings(nextSettings)
    persistAudioSettings(nextSettings, true)
  })

  const handleMusicVolumeChange = useEffectEvent((value: number) => {
    const nextSettings = {
      ...audioSettings,
      musicVolume: value,
      musicEnabled: value <= 0 ? false : audioSettings.musicEnabled || value > 0,
    }

    setAudioSettings(nextSettings)
    persistAudioSettings(nextSettings)
  })

  const handleSfxVolumeChange = useEffectEvent((value: number) => {
    const nextSettings = {
      ...audioSettings,
      sfxVolume: value,
      sfxEnabled: value <= 0 ? false : audioSettings.sfxEnabled || value > 0,
    }

    setAudioSettings(nextSettings)
    persistAudioSettings(nextSettings)
  })

  const ensureAudioUnlocked = useEffectEvent(async () => {
    const [uiUnlocked, musicUnlocked] = await Promise.all([
      uiSoundControllerRef.current?.unlock(),
      ambientMusicControllerRef.current?.unlock(),
    ])

    return Boolean(uiUnlocked || musicUnlocked)
  })

  const playUiSound = useEffectEvent(async (soundName: UiSoundName) => {
    await uiSoundControllerRef.current?.play(soundName)
  })

  const playChatTypingTone = useEffectEvent(async (character: string) => {
    chatTypingToneStepRef.current = (chatTypingToneStepRef.current + 1) % 64
    await uiSoundControllerRef.current?.playTypingKey({
      character,
      step: chatTypingToneStepRef.current,
    })
  })

  useEffect(() => {
    const handleAudioUnlock = () => {
      void ensureAudioUnlocked()
    }

    window.addEventListener('pointerdown', handleAudioUnlock, { passive: true })
    window.addEventListener('keydown', handleAudioUnlock)

    return () => {
      window.removeEventListener('pointerdown', handleAudioUnlock)
      window.removeEventListener('keydown', handleAudioUnlock)
    }
  }, [ensureAudioUnlocked])

  const playDialogueBlip = useEffectEvent(() => {
    void playUiSound('dialogue-blip')
  })

  const startNpcInteractionCooldown = useEffectEvent((cooldownMs: number) => {
    if (dialogueCooldownTimeoutRef.current) {
      window.clearTimeout(dialogueCooldownTimeoutRef.current)
    }

    setNpcInteractionLocked(true)
    dialogueCooldownTimeoutRef.current = window.setTimeout(() => {
      setNpcInteractionLocked(false)
      dialogueCooldownTimeoutRef.current = null
    }, cooldownMs)
  })

  const finishDialogue = useEffectEvent((dialogue: DialogueDefinition) => {
    setActiveDialogue(null)
    setDialogueVisibleChars(0)
    lastDialogueAudioProgressRef.current = { lineKey: '', visibleChars: 0 }
    dialogue.onComplete?.()
    startNpcInteractionCooldown(dialogue.cooldownMs ?? 1500)
  })

  const advanceDialogue = useEffectEvent(() => {
    if (!activeDialogue) {
      return
    }

    void ensureAudioUnlocked()

    if (!isDialogueLineComplete) {
      setDialogueVisibleChars(currentDialogueLine.length)
      return
    }

    if (activeDialogue.lineIndex >= activeDialogue.dialogue.lines.length - 1) {
      finishDialogue(activeDialogue.dialogue)
      return
    }

    setActiveDialogue({
      ...activeDialogue,
      lineIndex: activeDialogue.lineIndex + 1,
    })
  })

  useEffect(() => {
    if (!activeDialogue) {
      setDialogueVisibleChars(0)
      lastDialogueAudioProgressRef.current = { lineKey: '', visibleChars: 0 }
      return
    }

    setDialogueVisibleChars(0)
    lastDialogueAudioProgressRef.current = {
      lineKey: `${activeDialogue.dialogue.id}:${activeDialogue.lineIndex}`,
      visibleChars: 0,
    }
  }, [activeDialogue?.dialogue.id, activeDialogue?.lineIndex, activeDialogue?.npcId])

  useEffect(() => {
    if (!activeDialogue || currentDialogueLine.length === 0 || isDialogueLineComplete) {
      return
    }

    const intervalId = window.setInterval(() => {
      setDialogueVisibleChars((currentValue) => Math.min(currentValue + 1, currentDialogueLine.length))
    }, Math.max(16, activeDialogue.dialogue.typewriterMsPerChar ?? 50))

    return () => window.clearInterval(intervalId)
  }, [activeDialogue, currentDialogueLine.length, isDialogueLineComplete])

  useEffect(() => {
    if (!activeDialogue || dialogueVisibleChars <= 0) {
      return
    }

    const lineKey = `${activeDialogue.dialogue.id}:${activeDialogue.lineIndex}`
    const previousProgress = lastDialogueAudioProgressRef.current

    if (previousProgress.lineKey !== lineKey) {
      lastDialogueAudioProgressRef.current = { lineKey, visibleChars: 0 }
    }

    const previousVisibleChars =
      lastDialogueAudioProgressRef.current.lineKey === lineKey
        ? lastDialogueAudioProgressRef.current.visibleChars
        : 0

    if (dialogueVisibleChars > previousVisibleChars) {
      const latestChar = currentDialogueLine.charAt(dialogueVisibleChars - 1)
      if (latestChar.trim().length > 0) {
        playDialogueBlip()
      }
    }

    lastDialogueAudioProgressRef.current = { lineKey, visibleChars: dialogueVisibleChars }
  }, [activeDialogue, currentDialogueLine, dialogueVisibleChars, playDialogueBlip])

  useEffect(() => {
    if (!activeDialogue) {
      return
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.repeat || event.key.toLowerCase() !== 'e') {
        return
      }

      const target = event.target as HTMLElement | null
      const tagName = target?.tagName?.toLowerCase()
      const isTyping =
        tagName === 'input' ||
        tagName === 'textarea' ||
        target?.isContentEditable === true

      if (isTyping) {
        return
      }

      event.preventDefault()
      advanceDialogue()
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [activeDialogue])

  const handleNavigate = (target: Position) => {
    const socket = socketRef.current
    if (!socket || !room || !connected || activeDialogue || activeTouchPrompt || initialSkinSetupOpen) {
      return
    }

    socket.emit(clientEvents.navigateTo, {
      roomId: room.roomId,
      target,
    })
  }

  const transitionToRoom = useEffectEvent((
    templateId: string,
    spawnPosition?: Position,
    options?: {
      roomId?: string
      transition?: 'direct' | 'teleport' | 'follow-leader'
      allowPartyFollower?: boolean
    },
  ) => {
    const socket = socketRef.current
    const targetTemplate = getRoomTemplateById(templateId)
    if (!socket || !connected || !targetTemplate) {
      return
    }

    const transition = options?.transition ?? 'teleport'
    const currentParty = partyRef.current
    if (
      transition === 'teleport' &&
      currentParty &&
      currentParty.leaderUserId !== session.profile.userId &&
      !options?.allowPartyFollower
    ) {
      enqueueActivityNotice('Grupo actualizado', 'Solo el lider del grupo se puede teletransportar.')
      return
    }

    requestStopMovement()
    stopLocalTyping()
    setQuickChatOpen(false)
    setFloatingMessages([])
    setActiveSpeechByUserId({})
    setTypingByUserId({})
    startSceneLoad(targetTemplate.id, options?.roomId ?? null)

    const nextPath = `/${targetTemplate.routeSegment}`
    if (window.location.pathname !== nextPath) {
      window.history.pushState({}, '', nextPath)
      setPathname(nextPath)
    }

    socket.emit(clientEvents.joinRoom, {
      ...(options?.roomId ? { roomId: options.roomId } : {}),
      templateId: targetTemplate.id,
      spawnPosition,
      transition,
    })
  })

  const handleEnemyTouchInteract = useEffectEvent((enemyTemplate: RoomEnemyTemplate) => {
    const socket = socketRef.current
    if (
      !socket ||
      !room ||
      activeDialogue ||
      activeTouchPrompt ||
      npcInteractionLocked ||
      skinEditorOpen ||
      initialSkinSetupOpen
    ) {
      return
    }

    requestStopMovement()
    void ensureAudioUnlocked()
    socket.emit(
      clientEvents.requestEnemyCombat,
      {
        roomId: room.roomId,
        enemyId: enemyTemplate.id,
      },
      (response: { ok: boolean; message?: string }) => {
        if (!response.ok && response.message) {
          enqueueActivityNotice('Aviso del sistema', response.message)
        }
      },
    )
  })

  const handleWorldInteract = useEffectEvent((interactable: WorldInteractableTarget) => {
    if (activeDialogue || activeTouchPrompt || npcInteractionLocked || skinEditorOpen || initialSkinSetupOpen) {
      return
    }

    void ensureAudioUnlocked()

    if (interactable.entityType === 'enemy-combat') {
      requestStopMovement()
      handleRespondToEnemyCombatSupportInvite(interactable.encounterId, 'accept')
      return
    }

    if (interactable.teleportTarget) {
      transitionToRoom(interactable.teleportTarget.templateId, interactable.teleportTarget.position)
      return
    }

    if (interactable.entityType !== 'npc') {
      return
    }

    requestStopMovement()

    if (interactable.interactionMode === 'touch') {
      void playUiSound('panel-open')
      setActiveTouchPrompt({
        kind: 'npc',
        npcId: interactable.id,
        title: interactable.label ?? '',
      })
      return
    }

    const dialogue = getDialogueById(interactable.dialogueId)
    if (dialogue) {
      setActiveDialogue({
        npcId: interactable.id,
        dialogue,
        lineIndex: 0,
      })
      return
    }

    console.info('[WORLD] Interaccion ejecutada', {
      interactableId: interactable.id,
      interactionType: interactable.entityType,
      interactionId: interactable.interactionId ?? null,
      roomId: room?.roomId ?? null,
      userId: session.profile.userId,
    })
  })

  const handleEnemyFlee = useEffectEvent(() => {
    if (!activeTouchPrompt || activeTouchPrompt.kind !== 'enemy') {
      console.info('[COMBATE] Se intento huir, pero no hay un combate enemigo activo en la interfaz.')
      return
    }

    if (!canRetreatFromActiveEnemyCombat) {
      enqueueActivityNotice(
        'Combate bloqueado',
        isCombatLeaderParticipantPresent
          ? `Solo ${activeTouchPrompt.combatLeaderDisplayName} puede retirarse del enfrentamiento.`
          : 'Solo quienes ya participan en el combate pueden retirarse del enfrentamiento.',
      )
      return
    }

    if (fleeingEnemyCombatEncounterId === activeTouchPrompt.encounterId) {
      return
    }

    const socket = socketRef.current
    if (!socket) {
      console.info('[COMBATE] Se intento huir, pero no existe socket activo.')
      return
    }

    console.info('[COMBATE] Boton Huir presionado.', {
      encounterId: activeTouchPrompt.encounterId,
      enemyId: activeTouchPrompt.enemyId,
      enemyLevel: activeTouchPrompt.enemyLevel,
      fleeChance: activeTouchPrompt.fleeChance,
      userId: session.profile.userId,
      roomId: room?.roomId ?? null,
    })

    void playUiSound('cancel')
    setFleeingEnemyCombatEncounterId(activeTouchPrompt.encounterId)
    socket.emit(
      clientEvents.fleeEnemyCombat,
      {
        encounterId: activeTouchPrompt.encounterId,
      },
      (response: { ok: boolean; escaped?: boolean; message?: string }) => {
        setFleeingEnemyCombatEncounterId((currentValue) =>
          currentValue === activeTouchPrompt.encounterId ? null : currentValue,
        )
        console.info('[COMBATE] Respuesta del servidor al intentar huir.', {
          encounterId: activeTouchPrompt.encounterId,
          enemyId: activeTouchPrompt.enemyId,
          response,
        })

        if (!response.ok) {
          if (response.message) {
            enqueueActivityNotice('Aviso del sistema', response.message)
          }
          return
        }

        if (response.escaped) {
          blockEnemyInteractionFor(activeTouchPrompt.enemyId, ENEMY_ESCAPE_INTERACTION_COOLDOWN_MS)
          setActiveTouchPrompt(null)
          enqueueActivityNotice('Huida exitosa', response.message ?? 'Escapaste del rival.')
          return
        }

        enqueueActivityNotice('Huida fallida', response.message ?? 'No lograste escapar del rival.')
      },
    )
  })

  const handleEnemyCombatStart = useEffectEvent(() => {
    if (!activeTouchPrompt || activeTouchPrompt.kind !== 'enemy') {
      return
    }

    if (activeTouchPrompt.phase === 'battle') {
      return
    }

    if (!canStartActiveEnemyCombat) {
      enqueueActivityNotice(
        'Combate bloqueado',
        isCombatLeaderParticipantPresent
          ? `Solo ${activeTouchPrompt.combatLeaderDisplayName} puede comenzar el combate.`
          : 'Solo quienes ya participan en el combate pueden comenzarlo.',
      )
      return
    }

    if (startingEnemyCombatEncounterId === activeTouchPrompt.encounterId) {
      return
    }

    const socket = socketRef.current
    if (!socket) {
      return
    }

    console.info('[COMBATE] Boton Iniciar combate presionado en la sala de espera.', {
      encounterId: activeTouchPrompt.encounterId,
      enemyId: activeTouchPrompt.enemyId,
      participants: activeTouchPrompt.participants.map((participant) => participant.userId),
    })

    void playUiSound('confirm')
    setStartingEnemyCombatEncounterId(activeTouchPrompt.encounterId)
    socket.emit(
      clientEvents.startEnemyCombat,
      {
        encounterId: activeTouchPrompt.encounterId,
      },
      (response: { ok: boolean; message?: string }) => {
        setStartingEnemyCombatEncounterId((currentValue) =>
          currentValue === activeTouchPrompt.encounterId ? null : currentValue,
        )

        if (!response.ok) {
          enqueueActivityNotice('Aviso del sistema', response.message ?? 'No fue posible comenzar el combate.')
        }
      },
    )
  })

  const handleBattleCommandPreview = useEffectEvent((commandLabel: string) => {
    void playUiSound('select')
    enqueueActivityNotice(
      `${commandLabel} en preparacion`,
      'Primero dejamos lista la interfaz de combate. La logica de acciones ira en el siguiente paso.',
    )
  })

  const handleInteractShortcut = useEffectEvent(() => {
    if (activeDialogue) {
      advanceDialogue()
      return
    }

    if (activeInteractable && !activeTouchPrompt && !npcInteractionLocked && !skinEditorOpen && !initialSkinSetupOpen) {
      handleWorldInteract(activeInteractable)
    }
  })

  const toggleDebug = useEffectEvent(() => {
    void playUiSound('select')
    setDebugEnabled((currentValue) => !currentValue)
  })

  const togglePlayerNames = useEffectEvent(() => {
    void playUiSound('select')
    setPlayerIdentityMode((currentValue) => getNextPlayerIdentityMode(currentValue))
  })

  const toggleSkinEditor = useEffectEvent(() => {
    if (activeDialogue || activeTouchPrompt || initialSkinSetupOpen) {
      return
    }

    void playUiSound(skinEditorOpen ? 'panel-close' : 'panel-open')
    setSkinEditorOpen((currentValue) => !currentValue)
  })

  useEffect(() => {
    setActiveTouchPrompt(null)
    setEnemyCombatSupportInvites([])
    setRespondingEnemyCombatInviteId(null)
    setRoomEnemyCombatEncounters([])
  }, [room?.roomId])

  const handleCloseSkinEditor = useEffectEvent(() => {
    if (!skinEditorOpen) {
      return
    }

    void playUiSound('panel-close')
    setSkinEditorOpen(false)
  })

  const handleSkinEditorTabChange = useEffectEvent(() => {
    void playUiSound('select')
  })

  const handleSelectSkin = useEffectEvent((nextSkinId: string) => {
    const nextPreset = resolveAvatarPreset(nextSkinId)
    if (nextPreset.id === selectedSkinId) {
      return
    }

    void playUiSound('select')
    setSelectedSkinId(nextPreset.id)
    setSelectedSkinColorsBySkinId((currentValue) => {
      if (currentValue[nextPreset.id]) {
        return currentValue
      }

      const seedColors =
        nextPreset.id === appliedSkinPreset.id
          ? appliedSkinColors
          : getDefaultAvatarColorSelections(nextPreset)

      return {
        ...currentValue,
        [nextPreset.id]: normalizeAvatarColorSelections(nextPreset, seedColors),
      }
    })
  })

  const handleSelectSkinColor = useEffectEvent((slotId: string, optionId: string) => {
    if (selectedSkinColors[slotId] === optionId) {
      return
    }

    void playUiSound('color')
    setSelectedSkinColorsBySkinId((currentValue) => ({
      ...currentValue,
      [selectedSkinPreset.id]: normalizeAvatarColorSelections(selectedSkinPreset, {
        ...selectedSkinColors,
        [slotId]: optionId,
      }),
    }))
  })

  const handleApplySkin = useEffectEvent(() => {
    if (!room) {
      setSkinEditorOpen(false)
      return
    }

    const nextSkinId = selectedSkinPreset.id
    if (!nextSkinId) {
      return
    }

    void playUiSound('confirm')

    const nextSkinPreset = resolveAvatarPreset(nextSkinId)
    const nextSkinColors = normalizeAvatarColorSelections(
      nextSkinPreset,
      selectedSkinColorsBySkinId[nextSkinPreset.id] ?? {},
    )

    const socket = socketRef.current
    if (socket) {
      socket.emit(clientEvents.updateSkin, {
        roomId: room.roomId,
        skinId: nextSkinId,
        skinColors: nextSkinColors,
      })
    }

    sessionProfileRef.current = {
      ...sessionProfileRef.current,
      skinId: nextSkinId,
      skinColors: nextSkinColors,
    }

    const nextSession: AuthSession = {
      ...session,
      profile: {
        ...session.profile,
        skinId: nextSkinId,
        skinColors: nextSkinColors,
      },
    }

    sessionRef.current = nextSession
    savePreferredSkin(session.profile.userId, nextSkinId)
    savePreferredSkinColors(session.profile.userId, nextSkinId, nextSkinColors)
    if (session.provider === 'local') {
      saveAuthSession(nextSession)
    }
    onSessionChange?.(nextSession)

    setRoom((currentRoom) => {
      if (!currentRoom) {
        return currentRoom
      }

      return {
        ...currentRoom,
        players: currentRoom.players.map((player) =>
          player.userId === session.profile.userId
            ? {
                ...player,
                skinId: nextSkinId,
                skinColors: nextSkinColors,
              }
            : player,
        ),
      }
    })

    setSkinEditorOpen(false)
  })

  const handleApplyInitialSkin = useEffectEvent(() => {
    const socket = socketRef.current
    if (!socket) {
      return
    }

    const nextSkinPreset = resolveAvatarPreset(selectedSkinId)
    const nextSkinColors = normalizeAvatarColorSelections(
      nextSkinPreset,
      selectedSkinColorsBySkinId[nextSkinPreset.id] ?? getDefaultAvatarColorSelections(nextSkinPreset),
    )

    void playUiSound('confirm')
    setInitialSkinSetupSubmitting(true)

    socket.emit(
      clientEvents.completeOnboarding,
      {
        skinId: nextSkinPreset.id,
        skinColors: nextSkinColors,
      },
      (
        response: {
          ok: boolean
          profile?: AuthSession['profile']
          progress?: { level: number; experience: number }
          inventory?: AuthSession['inventory']
          message?: string
        },
      ) => {
        setInitialSkinSetupSubmitting(false)

        if (!response.ok || !response.profile) {
          return
        }

        const profile = response.profile
        sessionProfileRef.current = profile

        const nextSession: AuthSession = {
          ...session,
          level: response.progress?.level ?? session.level,
          experience: response.progress?.experience ?? session.experience,
          inventory: response.inventory ?? session.inventory,
          profile,
        }

        sessionRef.current = nextSession
        savePreferredSkin(profile.userId, profile.skinId)
        savePreferredSkinColors(profile.userId, profile.skinId, profile.skinColors)
        if (session.provider === 'local') {
          saveAuthSession(nextSession)
        }
        onSessionChange?.(nextSession)

        setInitialSkinSetupOpen(false)
        const routeTemplate = resolveRoomTemplateFromPath(window.location.pathname)
        startSceneLoad(routeTemplate.id, null)
        socket.emit(clientEvents.joinRoom, {
          templateId: routeTemplate.id,
          transition: 'direct',
        })
      },
    )
  })

  useEffect(() => {
    if (!skinEditorOpen) {
      return
    }

    setSelectedSkinId(appliedSkinPreset.id)
    setSelectedSkinColorsBySkinId((currentValue) => ({
      ...currentValue,
      [appliedSkinPreset.id]: appliedSkinColors,
    }))
  }, [appliedSkinColorsKey, appliedSkinPreset.id, skinEditorOpen])

  const closeQuickChat = useEffectEvent((clearInput = false) => {
    stopLocalTyping()
    setQuickChatOpen(false)
    if (clearInput) {
      setChatInput('')
    }
  })

  const submitChatMessage = useEffectEvent((closeQuickBarOnSuccess = false) => {
    const socket = socketRef.current
    const trimmedContent = chatInput.trim()
    if (!socket || !trimmedContent || !room) {
      return false
    }

    void playUiSound('send')
    stopLocalTyping()
    socket.emit(clientEvents.sendChatMessage, {
      roomId: room.roomId,
      content: trimmedContent,
    })
    setChatInput('')
    if (closeQuickBarOnSuccess) {
      setQuickChatOpen(false)
    }
    return true
  })

  const handleChatSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    submitChatMessage()
  }

  const handleQuickChatSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!chatInput.trim()) {
      closeQuickChat(true)
      return
    }

    submitChatMessage(true)
  }

  const triggerQuickChatShortcut = useEffectEvent(() => {
    if (chatOpen || activeDialogue || initialSkinSetupOpen || skinEditorOpen) {
      return
    }

    if (!quickChatOpen) {
      setQuickChatOpen(true)
      return
    }

    if (!chatInput.trim()) {
      closeQuickChat(true)
      return
    }

    submitChatMessage(true)
  })

  const handleChatInputChange = (nextValue: string) => {
    const previousValue = chatInput
    setChatInput(nextValue)

    if (nextValue.length > previousValue.length) {
      let typedCharacter = ''

      for (let index = 0; index < nextValue.length; index += 1) {
        if (nextValue[index] !== previousValue[index]) {
          typedCharacter = nextValue[index] ?? ''
          break
        }
      }

      if (!typedCharacter) {
        typedCharacter = nextValue.at(-1) ?? ''
      }

      if (typedCharacter.trim().length > 0) {
        void playChatTypingTone(typedCharacter)
      }
    }

    if (!nextValue.trim()) {
      stopLocalTyping()
      return
    }

    emitLocalTypingState(true)

    if (typingIdleTimeoutRef.current) {
      window.clearTimeout(typingIdleTimeoutRef.current)
    }

    typingIdleTimeoutRef.current = window.setTimeout(() => {
      emitLocalTypingState(false)
      typingIdleTimeoutRef.current = null
    }, 2000)
  }

  useEffect(() => {
    if (!quickChatOpen || chatOpen) {
      return
    }

    const frameId = window.requestAnimationFrame(() => {
      quickChatInputRef.current?.focus()
    })

    return () => window.cancelAnimationFrame(frameId)
  }, [chatOpen, quickChatOpen])

  useEffect(() => {
    if (!quickChatOpen) {
      return
    }

    if (chatOpen || activeDialogue || activeTouchPrompt || initialSkinSetupOpen || skinEditorOpen) {
      closeQuickChat(false)
    }
  }, [activeDialogue, activeTouchPrompt, chatOpen, initialSkinSetupOpen, quickChatOpen, skinEditorOpen])

  useEffect(() => {
    const handleQuickChatShortcut = (event: KeyboardEvent) => {
      if (event.repeat || event.key !== 'Enter') {
        return
      }

      const target = event.target as HTMLElement | null
      const tagName = target?.tagName?.toLowerCase()
      const isTyping =
        tagName === 'input' ||
        tagName === 'textarea' ||
        target?.isContentEditable === true

      if (isTyping || chatOpen || activeDialogue || activeTouchPrompt || initialSkinSetupOpen || skinEditorOpen) {
        return
      }

      event.preventDefault()
      triggerQuickChatShortcut()
    }

    window.addEventListener('keydown', handleQuickChatShortcut)
    return () => window.removeEventListener('keydown', handleQuickChatShortcut)
  }, [activeDialogue, activeTouchPrompt, chatOpen, initialSkinSetupOpen, skinEditorOpen])

  return (
    <main className="hud-layout">
      <div className="world-canvas fullscreen-world">
        <ReactWorld
          room={room}
          currentUserId={session.profile.userId}
          template={activeTemplate}
          enemyCombatEncounters={roomEnemyCombatEncounters}
          onNavigate={handleNavigate}
          debugEnabled={debugEnabled}
          playerIdentityMode={playerIdentityMode}
          activeSpeechByUserId={activeSpeechByUserId}
          typingByUserId={typingByUserId}
          typingIndicatorText={typingIndicatorText}
          onInteract={handleWorldInteract}
          onEnemyTouchInteract={handleEnemyTouchInteract}
          onActiveInteractableChange={setActiveInteractable}
          navigationEnabled={!activeDialogue && !activeTouchPrompt && !skinEditorOpen && !initialSkinSetupOpen}
          interactionEnabled={!activeDialogue && !activeTouchPrompt && !npcInteractionLocked && !skinEditorOpen && !initialSkinSetupOpen}
          blockedEnemyInteractionIds={blockedEnemyInteractionIds}
          suppressInteractionIconForId={activeDialogue?.npcId ?? null}
          pointerInteractionEnabled={false}
        />
        <SceneLoadingOverlay
          visible={sceneLoadingVisible}
          skinId={appliedSkinId}
          skinColors={appliedSkinColors}
        />

        <div className="hud-layer">
          <section className="user-card">
            <div
              className="user-avatar-frame"
              style={{
                boxShadow: `0 16px 34px ${userAvatarFrameColors.shadow}`,
              }}
            >
              <svg
                className="user-avatar-frame-art"
                viewBox="0 0 60 60"
                aria-hidden="true"
                focusable="false"
              >
                <rect x="24" y="0" width="12" height="4" fill={userAvatarFrameColors.edge} />
                <rect x="24" y="56" width="12" height="4" fill={userAvatarFrameColors.edge} />
                <rect x="16" y="4" width="8" height="4" fill={userAvatarFrameColors.edge} />
                <rect x="36" y="4" width="8" height="4" fill={userAvatarFrameColors.edge} />
                <rect x="16" y="52" width="8" height="4" fill={userAvatarFrameColors.edge} />
                <rect x="36" y="52" width="8" height="4" fill={userAvatarFrameColors.edge} />
                <rect x="8" y="8" width="8" height="4" fill={userAvatarFrameColors.edge} />
                <rect x="44" y="8" width="8" height="4" fill={userAvatarFrameColors.edge} />
                <rect x="8" y="48" width="8" height="4" fill={userAvatarFrameColors.edge} />
                <rect x="44" y="48" width="8" height="4" fill={userAvatarFrameColors.edge} />
                <rect x="8" y="12" width="4" height="4" fill={userAvatarFrameColors.edge} />
                <rect x="48" y="12" width="4" height="4" fill={userAvatarFrameColors.edge} />
                <rect x="8" y="44" width="4" height="4" fill={userAvatarFrameColors.edge} />
                <rect x="48" y="44" width="4" height="4" fill={userAvatarFrameColors.edge} />
                <rect x="4" y="16" width="4" height="8" fill={userAvatarFrameColors.edge} />
                <rect x="52" y="16" width="4" height="8" fill={userAvatarFrameColors.edge} />
                <rect x="4" y="36" width="4" height="8" fill={userAvatarFrameColors.edge} />
                <rect x="52" y="36" width="4" height="8" fill={userAvatarFrameColors.edge} />
                <rect x="0" y="24" width="4" height="12" fill={userAvatarFrameColors.edge} />
                <rect x="56" y="24" width="4" height="12" fill={userAvatarFrameColors.edge} />
                <path
                  d="M4 36V24H8V16H12V12H16V8H24V4H36V8H44V12H48V16H52V24H56V36H52V44H48V48H44V52H36V56H24V52H16V48H12V44H8V36H4Z"
                  fill={userAvatarFrameColors.fill}
                />
              </svg>
              <div className="user-avatar image-user">
                <svg
                  className="user-avatar-shape"
                  viewBox="0 0 52 52"
                  aria-label={session.profile.displayName}
                  role="img"
                >
                  <defs>
                    <clipPath id="user-avatar-shape-clip">
                      <path d={USER_AVATAR_SHAPE_PATH} />
                    </clipPath>
                  </defs>

                  <path
                    d={USER_AVATAR_SHAPE_PATH}
                    fill={session.pictureUrl ? mixHexColor(appliedPrimaryColor, '#FFFFFF', 0.56) : appliedPrimaryColor}
                  />

                  {session.pictureUrl ? (
                    <image
                      href={session.pictureUrl}
                      width="52"
                      height="52"
                      preserveAspectRatio="xMidYMid slice"
                      clipPath="url(#user-avatar-shape-clip)"
                    />
                  ) : (
                    <text
                      x="26"
                      y="28"
                      textAnchor="middle"
                      dominantBaseline="middle"
                      className="user-avatar-shape-letter"
                    >
                      {playerInitial}
                    </text>
                  )}
                </svg>
              </div>
            </div>
            <div
              className="user-meta-frame"
              style={{
                boxShadow: `0 16px 34px ${userMetaFrameColors.shadow}`,
              }}
            >
              <svg
                className="user-meta-frame-art"
                viewBox="0 0 184 60"
                aria-hidden="true"
                focusable="false"
              >
                <rect x="4" y="4" width="176" height="52" fill={userMetaFrameColors.fill} />
                <rect x="8" y="0" width="168" height="4" fill={userMetaFrameColors.edge} />
                <rect x="8" y="56" width="168" height="4" fill={userMetaFrameColors.edge} />
                <rect x="4" y="4" width="4" height="4" fill={userMetaFrameColors.edge} />
                <rect x="176" y="52" width="4" height="4" fill={userMetaFrameColors.edge} />
                <rect x="4" y="52" width="4" height="4" fill={userMetaFrameColors.edge} />
                <rect x="0" y="8" width="4" height="44" fill={userMetaFrameColors.edge} />
                <rect x="180" y="8" width="4" height="44" fill={userMetaFrameColors.edge} />
                <rect x="176" y="4" width="4" height="4" fill={userMetaFrameColors.edge} />
              </svg>
              <div
                className="user-meta"
                style={{
                  color: userMetaFrameColors.ink,
                }}
              >
                <strong>{session.profile.displayName}</strong>
                <span style={{ color: userMetaFrameColors.subInk }}>lvl. {session.level}</span>
              </div>
            </div>
          </section>

          <div ref={optionsMenuRef} className="options-anchor">
            <button
              type="button"
              className="hud-square-button options-button"
              onClick={toggleOptionsMenu}
              aria-expanded={optionsOpen}
              aria-haspopup="dialog"
              aria-label={
                pendingFriendRequestCount > 0
                  ? `Abrir opciones de estado. Tienes ${pendingFriendRequestCount} solicitudes pendientes`
                  : 'Abrir opciones de estado'
              }
            >
              MENU
              {pendingFriendRequestCount > 0 ? (
                <span className="options-button-badge" aria-hidden="true">
                  {pendingFriendRequestCount}
                </span>
              ) : null}
            </button>

            {optionsOpen ? (
              <div className="options-menu-modal" role="presentation">
                <button
                  type="button"
                  className="options-menu-backdrop"
                  aria-label="Cerrar menu"
                  onClick={closeOptionsMenu}
                />
                <section className="dropdown-panel options-panel" aria-modal="true" role="dialog" aria-label="Menu principal">
                  <header className="dropdown-header">
                    <div className="options-panel-heading">
                      <h2>Menu</h2>
                      <p className="dropdown-header-subtitle">Ajustes rapidos para tu sesion actual.</p>
                    </div>
                    <button
                      type="button"
                      className="options-panel-close"
                      onClick={closeOptionsMenu}
                      aria-label="Cerrar menu"
                    >
                      Esc
                    </button>
                  </header>
                  <div className="dropdown-body">
                    <div className="dropdown-stats">
                      <article className="dropdown-stat">
                        <span>Sala</span>
                        <strong>/{activeTemplate.routeSegment}</strong>
                      </article>
                      <article className="dropdown-stat">
                        <span>Jugadores</span>
                        <strong>{activePlayers.length}</strong>
                      </article>
                    </div>

                    <details className="dropdown-section" open>
                      <summary>Personajes en la sala</summary>
                      <div className="dropdown-section-body">
                        <ul className="players-list players-list-rich">
                          {activePlayers.length === 0 ? (
                            <li>Sin jugadores visibles</li>
                          ) : (
                            activePlayers.map((player) => {
                              const isCurrentPlayer = player.userId === session.profile.userId
                              const isFriend = friendUserIds.has(player.userId)
                              const isPartyMember = partyMemberUserIds.has(player.userId)
                              const hasIncomingPartyInvite = incomingPartyInvites.some(
                                (invite) => invite.fromUserId === player.userId,
                              )
                              const canInviteToParty =
                                isFriend &&
                                !isCurrentPlayer &&
                                !isPartyMember &&
                                !hasIncomingPartyInvite &&
                                !outgoingPartyInviteUserIdSet.has(player.userId)

                              return (
                                <li
                                  key={player.sessionId}
                                  className={isCurrentPlayer ? 'is-current-player' : ''}
                                >
                                  <div className="player-entry-main">
                                    <MenuAvatarPreview
                                      skinId={player.skinId}
                                      skinColors={player.skinColors}
                                      displayName={player.displayName}
                                    />
                                    <div className="player-entry-copy">
                                      <strong>{player.displayName}</strong>
                                      <small>{resolveLevelSubtitle(player.level)}</small>
                                    </div>
                                  </div>
                                  <div className="inline-actions">
                                    {isCurrentPlayer ? (
                                      <span className="menu-inline-tag is-current">Tu personaje</span>
                                    ) : isPartyMember ? (
                                      <span className="menu-inline-tag is-current">
                                        {party?.leaderUserId === player.userId ? 'Lider del grupo' : 'En tu grupo'}
                                      </span>
                                    ) : null}
                                    {!isCurrentPlayer && isFriend && !isPartyMember ? (
                                      <span className="menu-inline-tag is-friend">Amistad</span>
                                    ) : null}
                                    {!isCurrentPlayer && canInviteToParty ? (
                                      <button
                                        type="button"
                                        className="mini-action-button"
                                        onClick={() => handleInviteToParty(player.userId)}
                                        disabled={invitingPartyUserId === player.userId}
                                      >
                                        {invitingPartyUserId === player.userId ? 'Invitando...' : 'Invitar'}
                                      </button>
                                    ) : null}
                                    {!isCurrentPlayer && hasIncomingPartyInvite && !isPartyMember ? (
                                      <span className="menu-inline-tag is-pending">Te invito</span>
                                    ) : null}
                                    {!isCurrentPlayer && outgoingPartyInviteUserIdSet.has(player.userId) && !isPartyMember ? (
                                      <span className="menu-inline-tag is-pending">Invitacion enviada</span>
                                    ) : null}
                                    {!isCurrentPlayer && !isFriend && incomingFriendRequestUserIds.has(player.userId) ? (
                                      <span className="menu-inline-tag is-pending">Te envio solicitud</span>
                                    ) : null}
                                    {!isCurrentPlayer && !isFriend && outgoingFriendRequestUserIdSet.has(player.userId) ? (
                                      <span className="menu-inline-tag is-pending">Pendiente</span>
                                    ) : null}
                                    {!isCurrentPlayer &&
                                    !isFriend &&
                                    !incomingFriendRequestUserIds.has(player.userId) &&
                                    !outgoingFriendRequestUserIdSet.has(player.userId) ? (
                                      <button
                                        type="button"
                                        className="mini-action-button"
                                        onClick={() => handleAddFriend(player.userId)}
                                        disabled={addingFriendUserId === player.userId}
                                      >
                                        {addingFriendUserId === player.userId ? 'Enviando...' : 'Solicitar'}
                                      </button>
                                    ) : null}
                                  </div>
                                </li>
                              )
                            })
                          )}
                        </ul>
                      </div>
                    </details>
                    <details className="dropdown-section" open={incomingFriendRequests.length > 0}>
                      <summary>Solicitudes</summary>
                      <div className="dropdown-section-body">
                        {incomingFriendRequests.length === 0 ? (
                          <p className="empty-state">No tienes solicitudes pendientes.</p>
                        ) : (
                          <ul className="players-list players-list-rich">
                            {incomingFriendRequests.map((request) => {
                              const isBusy = respondingFriendRequestId === request.requestId

                              return (
                                <li key={request.requestId} className="is-request-entry">
                                  <div className="player-entry-main">
                                    <MenuAvatarPreview
                                      skinId={request.skinId}
                                      skinColors={request.skinColors}
                                      displayName={request.displayName}
                                    />
                                    <div className="player-entry-copy">
                                      <strong>{request.displayName}</strong>
                                      <small>{resolveLevelSubtitle(request.level)}</small>
                                    </div>
                                  </div>
                                  <div className="inline-actions">
                                    <button
                                      type="button"
                                      className="mini-action-button"
                                      onClick={() => handleRespondToFriendRequest(request.requestId, 'accept')}
                                      disabled={isBusy}
                                    >
                                      {isBusy ? '...' : 'Aceptar'}
                                    </button>
                                    <button
                                      type="button"
                                      className="mini-action-button is-danger"
                                      onClick={() => handleRespondToFriendRequest(request.requestId, 'reject')}
                                      disabled={isBusy}
                                    >
                                      Rechazar
                                    </button>
                                  </div>
                                </li>
                              )
                            })}
                          </ul>
                        )}
                      </div>
                    </details>
                    <details className="dropdown-section" open={Boolean(party) || incomingPartyInvites.length > 0}>
                      <summary>Grupo</summary>
                      <div className="dropdown-section-body">
                        {!party ? (
                          <p className="empty-state">
                            {incomingPartyInvites.length > 0
                              ? 'Tienes invitaciones pendientes para unirte a un grupo.'
                              : 'Todavia no haces parte de ningun grupo.'}
                          </p>
                        ) : (
                          <>
                            <p className="dropdown-subtext">
                              Lider actual: <strong>{partyLeaderDisplayName}</strong>
                            </p>
                            <ul className="players-list players-list-rich">
                              {party.members.map((member) => {
                                const isCurrentMember = member.userId === session.profile.userId
                                const isLeaderMember = party.leaderUserId === member.userId
                                const isPromoting = promotingPartyLeaderUserId === member.userId

                                return (
                                  <li key={member.userId}>
                                    <div className="player-entry-main">
                                      <MenuAvatarPreview
                                        skinId={member.skinId}
                                        skinColors={member.skinColors}
                                        displayName={member.displayName}
                                      />
                                      <div className="player-entry-copy">
                                        <strong>{member.displayName}</strong>
                                        <small>{resolveLevelSubtitle(member.level)}</small>
                                      </div>
                                    </div>
                                    <div className="inline-actions">
                                      <span className={`friend-status-pill ${member.isOnline ? 'is-online' : 'is-offline'}`}>
                                        {member.isOnline ? 'Conectado' : 'Desconectado'}
                                      </span>
                                      {isLeaderMember ? (
                                        <span className="menu-inline-tag is-current">Lider</span>
                                      ) : null}
                                      {isCurrentMember && !isLeaderMember ? (
                                        <span className="menu-inline-tag is-friend">Miembro</span>
                                      ) : null}
                                      {isPartyLeader && !isCurrentMember ? (
                                        <button
                                          type="button"
                                          className="mini-action-button"
                                          onClick={() => handlePromotePartyLeader(member.userId)}
                                          disabled={Boolean(promotingPartyLeaderUserId)}
                                        >
                                          {isPromoting ? 'Promoviendo...' : 'Promover'}
                                        </button>
                                      ) : null}
                                    </div>
                                  </li>
                                )
                              })}
                            </ul>
                            <div className="inline-actions">
                              <button
                                type="button"
                                className="mini-action-button is-danger"
                                onClick={handleLeaveParty}
                                disabled={leavingParty}
                              >
                                {leavingParty
                                  ? 'Saliendo...'
                                  : party.members.length <= 1
                                    ? 'Disolver grupo'
                                    : isPartyLeader
                                      ? 'Salir y ceder lider'
                                      : 'Salir del grupo'}
                              </button>
                            </div>
                          </>
                        )}

                        {incomingPartyInvites.length > 0 ? (
                          <>
                            <p className="dropdown-subtext">Invitaciones pendientes</p>
                            <ul className="players-list players-list-rich">
                              {incomingPartyInvites.map((invite) => {
                                const isBusy = respondingPartyInviteId === invite.inviteId

                                return (
                                  <li key={invite.inviteId} className="is-request-entry">
                                    <div className="player-entry-main">
                                      <MenuAvatarPreview
                                        skinId={invite.skinId}
                                        skinColors={invite.skinColors}
                                        displayName={invite.displayName}
                                      />
                                      <div className="player-entry-copy">
                                        <strong>{invite.displayName}</strong>
                                        <small>{`${resolveLevelSubtitle(invite.level)} · Caduca en 1 minuto`}</small>
                                      </div>
                                    </div>
                                    <div className="inline-actions">
                                      <button
                                        type="button"
                                        className="mini-action-button"
                                        onClick={() => handleRespondToPartyInvite(invite.inviteId, 'accept')}
                                        disabled={isBusy}
                                      >
                                        {isBusy ? '...' : 'Aceptar'}
                                      </button>
                                      <button
                                        type="button"
                                        className="mini-action-button is-danger"
                                        onClick={() => handleRespondToPartyInvite(invite.inviteId, 'reject')}
                                        disabled={isBusy}
                                      >
                                        Rechazar
                                      </button>
                                    </div>
                                  </li>
                                )
                              })}
                            </ul>
                          </>
                        ) : null}
                      </div>
                    </details>
                    <details className="dropdown-section" open={friends.length > 0}>
                      <summary>Amistades</summary>
                      <div className="dropdown-section-body">
                        {friends.length === 0 ? (
                          <p className="empty-state">Todavia no agregas amistades.</p>
                        ) : (
                          <ul className="players-list players-list-rich">
                            {friends.map((friend) => {
                              const isPartyMember = partyMemberUserIds.has(friend.userId)
                              const hasIncomingPartyInvite = incomingPartyInvites.some(
                                (invite) => invite.fromUserId === friend.userId,
                              )
                              const canInviteToParty =
                                friend.isOnline &&
                                !isPartyMember &&
                                !hasIncomingPartyInvite &&
                                !outgoingPartyInviteUserIdSet.has(friend.userId)

                              return (
                                <li key={friend.userId}>
                                  <div className="player-entry-main">
                                    <MenuAvatarPreview
                                      skinId={friend.skinId}
                                      skinColors={friend.skinColors}
                                      displayName={friend.displayName}
                                    />
                                    <div className="player-entry-copy">
                                      <strong>{friend.displayName}</strong>
                                      <small>{resolveLevelSubtitle(friend.level)}</small>
                                    </div>
                                  </div>
                                  <div className="inline-actions">
                                    <span className={`friend-status-pill ${friend.isOnline ? 'is-online' : 'is-offline'}`}>
                                      {friend.isOnline ? 'Conectado' : 'Desconectado'}
                                    </span>
                                    {isPartyMember ? (
                                      <span className="menu-inline-tag is-current">
                                        {party?.leaderUserId === friend.userId ? 'Lider' : 'En tu grupo'}
                                      </span>
                                    ) : null}
                                    {canInviteToParty ? (
                                      <button
                                        type="button"
                                        className="mini-action-button"
                                        onClick={() => handleInviteToParty(friend.userId)}
                                        disabled={invitingPartyUserId === friend.userId}
                                      >
                                        {invitingPartyUserId === friend.userId ? 'Invitando...' : 'Invitar'}
                                      </button>
                                    ) : null}
                                    {!isPartyMember && hasIncomingPartyInvite ? (
                                      <span className="menu-inline-tag is-pending">Te invito</span>
                                    ) : null}
                                    {!isPartyMember && outgoingPartyInviteUserIdSet.has(friend.userId) ? (
                                      <span className="menu-inline-tag is-pending">Invitacion enviada</span>
                                    ) : null}
                                    <button
                                      type="button"
                                      className="mini-action-button is-danger"
                                      onClick={() => handleRemoveFriend(friend.userId)}
                                      disabled={removingFriendUserId === friend.userId}
                                    >
                                      {removingFriendUserId === friend.userId ? 'Quitando...' : 'Quitar'}
                                    </button>
                                  </div>
                                </li>
                              )
                            })}
                          </ul>
                        )}
                      </div>
                    </details>

                    <details className="dropdown-section" open>
                      <summary>Ambiente sonoro</summary>
                      <div className="dropdown-section-body">
                        <div className="audio-settings-panel">
                          <div className="audio-toggle-row">
                            <div className="audio-toggle-copy">
                              <strong>Tema mitico</strong>
                              <span>Melodia 8-bit de aventura.</span>
                            </div>
                            <button
                              type="button"
                              className={`audio-toggle-button ${audioSettings.musicEnabled ? 'is-active' : ''}`}
                              onClick={handleToggleMusic}
                              aria-pressed={audioSettings.musicEnabled}
                            >
                              {audioSettings.musicEnabled ? 'Activo' : 'Silencio'}
                            </button>
                          </div>
                          <label className="audio-slider-row">
                            <div className="audio-slider-header">
                              <span>Volumen del ambiente</span>
                              <strong>{musicVolumePercent}%</strong>
                            </div>
                            <input
                              className="audio-slider"
                              type="range"
                              min="0"
                              max="100"
                              step="1"
                              value={musicVolumePercent}
                              onChange={(event) => handleMusicVolumeChange(Number(event.target.value) / 100)}
                              aria-label="Volumen de la musica ambiental"
                            />
                          </label>
                          <div className="audio-toggle-row">
                            <div className="audio-toggle-copy">
                              <strong>Efectos pixel</strong>
                              <span>Notificaciones, menu, chat y editor.</span>
                            </div>
                            <button
                              type="button"
                              className={`audio-toggle-button ${audioSettings.sfxEnabled ? 'is-active' : ''}`}
                              onClick={handleToggleSfx}
                              aria-pressed={audioSettings.sfxEnabled}
                            >
                              {audioSettings.sfxEnabled ? 'Activos' : 'Mute'}
                            </button>
                          </div>
                          <label className="audio-slider-row">
                            <div className="audio-slider-header">
                              <span>Volumen de efectos</span>
                              <strong>{sfxVolumePercent}%</strong>
                            </div>
                            <input
                              className="audio-slider"
                              type="range"
                              min="0"
                              max="100"
                              step="1"
                              value={sfxVolumePercent}
                              onChange={(event) => handleSfxVolumeChange(Number(event.target.value) / 100)}
                              aria-label="Volumen de efectos de interfaz"
                            />
                          </label>
                          <p className="dropdown-subtext">
                            Puedes bajar el volumen, silenciar por completo y dejar guardada tu mezcla para futuras sesiones.
                          </p>
                        </div>
                      </div>
                    </details>
                    <div className="dropdown-actions">
                      <button
                        type="button"
                        className={`secondary-action-button ${playerIdentityMode === 'names' ? 'is-active' : ''}`}
                        onClick={togglePlayerNames}
                      >
                        {`Identificadores: ${playerIdentityShortcutLabel}`}
                      </button>
                      <button
                        type="button"
                        className={`secondary-action-button ${debugEnabled ? 'is-active' : ''}`}
                        onClick={toggleDebug}
                      >
                        {debugEnabled ? 'Ocultar coliders' : 'Mostrar coliders'}
                      </button>
                      <button type="button" className="secondary-action-button" onClick={openSkinEditorFromMenu}>
                        Personalizar skin
                      </button>
                      <button type="button" className="secondary-action-button" onClick={onLogout}>
                        Cerrar sesion
                      </button>
                    </div>
                  </div>
                </section>
              </div>
            ) : null}
          </div>

          {!chatOpen && floatingMessages.length > 0 ? (
            <section
              className={`chat-bubble-stack ${quickChatOpen ? 'is-offset-for-quick-chat' : ''}`}
              aria-label="Mensajes emergentes"
            >
              {floatingMessages.map((message) => {
                const bubblePalette = createAvatarBubblePalette(message.primaryColor)
                const bubbleStyle = {
                  '--chat-bubble-fill': bubblePalette.fill,
                  '--chat-bubble-border': bubblePalette.border,
                  '--chat-bubble-outline': bubblePalette.outline,
                  '--chat-bubble-shadow': bubblePalette.shadow,
                  '--chat-bubble-title': bubblePalette.title,
                  '--chat-bubble-text': bubblePalette.ink,
                } as CSSProperties

                return (
                <article
                  key={message.messageId}
                  className={`chat-bubble ${message.isOwnMessage ? 'is-self' : 'is-other'}`}
                  style={bubbleStyle}
                >
                  <strong>{message.displayName}</strong>
                  <span>{message.content}</span>
                </article>
                )
              })}
            </section>
          ) : null}

          {friendRequestPopups.length > 0 ? (
            <section className="friend-request-popup-stack" aria-label="Solicitudes de amistad en tiempo real">
              {friendRequestPopups.map((request) => (
                <article key={request.requestId} className="friend-request-popup">
                  <div className="friend-request-popup-progress" aria-hidden="true">
                    <span
                      key={request.expiresAt}
                      style={{ animationDuration: `${Math.max(250, request.expiresAt - Date.now())}ms` }}
                    />
                  </div>
                  <div className="friend-request-popup-copy">
                    <strong>{request.displayName}</strong>
                    <span>te envio una solicitud de amistad</span>
                  </div>
                  <div className="inline-actions">
                    <button
                      type="button"
                      className="mini-action-button"
                      onClick={() => handleRespondToFriendRequest(request.requestId, 'accept')}
                      disabled={respondingFriendRequestId === request.requestId}
                    >
                      Aceptar
                    </button>
                    <button
                      type="button"
                      className="mini-action-button is-danger"
                      onClick={() => handleRespondToFriendRequest(request.requestId, 'reject')}
                      disabled={respondingFriendRequestId === request.requestId}
                    >
                      Rechazar
                    </button>
                    <button
                      type="button"
                      className="mini-action-button is-ghost"
                      onClick={() => handleDismissFriendRequestPopup(request.requestId)}
                    >
                      Luego
                    </button>
                  </div>
                </article>
              ))}
            </section>
          ) : null}

          {activityNotices.length > 0 ? (
            <section className="activity-notice-stack" aria-label="Avisos sociales y de grupo">
              {activityNotices.map((notice) => (
                <article key={notice.id} className="activity-notice">
                  <div className="activity-notice-copy">
                    <strong>{notice.title}</strong>
                    <span>{notice.message}</span>
                  </div>
                  <button
                    type="button"
                    className="mini-action-button is-ghost"
                    onClick={() => dismissActivityNotice(notice.id)}
                  >
                    Cerrar
                  </button>
                </article>
              ))}
            </section>
          ) : null}

          {enemyCombatSupportInvites.length > 0 ? (
            <section className="friend-request-popup-stack" aria-label="Apoyo disponible para combate">
              {enemyCombatSupportInvites.map((invite) => (
                <article key={invite.encounterId} className="friend-request-popup">
                  <div className="friend-request-popup-copy">
                    <strong>{invite.requestedByDisplayName}</strong>
                    <span>{`inicio un combate contra ${invite.enemyLabel}. Puedes apoyar el combate.`}</span>
                  </div>
                  <div className="inline-actions">
                    <button
                      type="button"
                      className="mini-action-button"
                      onClick={() => handleRespondToEnemyCombatSupportInvite(invite.encounterId, 'accept')}
                      disabled={respondingEnemyCombatInviteId === invite.encounterId}
                    >
                      {respondingEnemyCombatInviteId === invite.encounterId ? '...' : 'Apoyar'}
                    </button>
                    <button
                      type="button"
                      className="mini-action-button is-danger"
                      onClick={() => handleRespondToEnemyCombatSupportInvite(invite.encounterId, 'reject')}
                      disabled={respondingEnemyCombatInviteId === invite.encounterId}
                    >
                      Rechazar
                    </button>
                    <button
                      type="button"
                      className="mini-action-button is-ghost"
                      onClick={() => dismissEnemyCombatSupportInvite(invite.encounterId)}
                    >
                      Luego
                    </button>
                  </div>
                </article>
              ))}
            </section>
          ) : null}

          {partyLeaderFollowPrompt ? (
            <section className="friend-request-popup-stack" aria-label="Seguimiento del lider del grupo">
              <article className="friend-request-popup">
                <div className="friend-request-popup-progress" aria-hidden="true">
                  <span
                    key={partyLeaderFollowPrompt.expiresAt}
                    style={{
                      animationDuration: `${Math.max(250, new Date(partyLeaderFollowPrompt.expiresAt).getTime() - Date.now())}ms`,
                    }}
                  />
                </div>
                <div className="friend-request-popup-copy">
                  <strong>{partyLeaderFollowPrompt.leaderDisplayName}</strong>
                  <span>
                    {`El lider del grupo se movio a la sala ${partyLeaderFollowPrompt.roomName} quieres seguirlo`}
                  </span>
                </div>
                <div className="inline-actions">
                  <button
                    type="button"
                    className="mini-action-button"
                    onClick={() => handleRespondToPartyLeaderFollow('accept')}
                    disabled={respondingPartyLeaderFollow}
                  >
                    {respondingPartyLeaderFollow ? '...' : 'Seguir al lider'}
                  </button>
                  <button
                    type="button"
                    className="mini-action-button is-danger"
                    onClick={() => handleRespondToPartyLeaderFollow('reject')}
                    disabled={respondingPartyLeaderFollow}
                  >
                    Dejar el grupo
                  </button>
                </div>
              </article>
            </section>
          ) : null}

          {partyInvitePopups.length > 0 ? (
            <section className="friend-request-popup-stack" aria-label="Invitaciones de grupo en tiempo real">
              {partyInvitePopups.map((invite) => (
                <article key={invite.inviteId} className="friend-request-popup">
                  <div className="friend-request-popup-progress" aria-hidden="true">
                    <span
                      key={invite.expiresAt}
                      style={{
                        animationDuration: `${Math.max(250, new Date(invite.expiresAt).getTime() - Date.now())}ms`,
                      }}
                    />
                  </div>
                  <div className="friend-request-popup-copy">
                    <strong>{invite.displayName}</strong>
                    <span>te invito a un grupo. Caduca en 1 minuto.</span>
                  </div>
                  <div className="inline-actions">
                    <button
                      type="button"
                      className="mini-action-button"
                      onClick={() => handleRespondToPartyInvite(invite.inviteId, 'accept')}
                      disabled={respondingPartyInviteId === invite.inviteId}
                    >
                      Aceptar
                    </button>
                    <button
                      type="button"
                      className="mini-action-button is-danger"
                      onClick={() => handleRespondToPartyInvite(invite.inviteId, 'reject')}
                      disabled={respondingPartyInviteId === invite.inviteId}
                    >
                      Rechazar
                    </button>
                    <button
                      type="button"
                      className="mini-action-button is-ghost"
                      onClick={() => handleDismissPartyInvitePopup(invite.inviteId)}
                    >
                      Luego
                    </button>
                  </div>
                </article>
              ))}
            </section>
          ) : null}

          <button
            type="button"
            className="hud-square-button chat-button"
            onClick={handleOpenChat}
            aria-label="Abrir chat"
          >
            Chat
          </button>

          {mobileInteractionEnabled && activeInteractable && !activeDialogue && !activeTouchPrompt && !npcInteractionLocked && !skinEditorOpen && !initialSkinSetupOpen ? (
            <MobileNpcInteractButton onInteract={() => handleWorldInteract(activeInteractable)} />
          ) : null}

          {!mobileInteractionEnabled ? (
            <section className="shortcut-board" aria-label="Atajos de teclado">
              <header className="shortcut-board-header">
                <h2>Atajos</h2>
              </header>
              <div className="shortcut-board-actions">
                <button type="button" className="shortcut-chip" onClick={togglePlayerNames}>
                  <span className="shortcut-key">N</span>
                  <span className="shortcut-label">{playerIdentityShortcutLabel}</span>
                </button>
                <button type="button" className="shortcut-chip" onClick={toggleDebug}>
                  <span className="shortcut-key">P</span>
                  <span className="shortcut-label">colision</span>
                </button>
                <button type="button" className="shortcut-chip" onClick={toggleSkinEditor}>
                  <span className="shortcut-key">M</span>
                  <span className="shortcut-label">skins</span>
                </button>
                <button type="button" className="shortcut-chip" onClick={toggleOptionsMenu}>
                  <span className="shortcut-key">ESC</span>
                  <span className="shortcut-label">{optionsOpen ? 'cerrar menu' : 'abrir menu'}</span>
                </button>
                <button
                  type="button"
                  className={`shortcut-chip ${quickChatShortcutDisabled ? 'is-disabled' : ''}`}
                  onClick={triggerQuickChatShortcut}
                  disabled={quickChatShortcutDisabled}
                >
                  <span className="shortcut-key">ENT</span>
                  <span className="shortcut-label">{quickChatShortcutLabel}</span>
                </button>
                <button
                  type="button"
                  className={`shortcut-chip ${activeInteractable || activeDialogue ? '' : 'is-disabled'}`}
                  onClick={handleInteractShortcut}
                  disabled={!activeInteractable && !activeDialogue}
                >
                  <span className="shortcut-key">E</span>
                  <span className="shortcut-label">{activeDialogue ? 'dialogo' : 'interactuar'}</span>
                </button>
              </div>
            </section>
          ) : null}

          {debugEnabled && debugPositionX !== null && debugPositionY !== null ? (
            <section className="debug-position-panel" aria-label="Posicion del personaje en debug">
              <strong>Posicion</strong>
              <span>X: {debugPositionX} / {activeTemplate.world.width}</span>
              <span>Y: {debugPositionY} / {activeTemplate.world.height}</span>
            </section>
          ) : null}

          {skinEditorOpen ? (
            <SkinEditorOverlay
              presets={availableSkins}
              selectedSkinId={selectedSkinId}
              appliedSkinId={appliedSkinId}
              selectedSkinColors={selectedSkinColors}
              onSelectSkin={handleSelectSkin}
              onSelectColor={handleSelectSkinColor}
              onApply={handleApplySkin}
              onClose={handleCloseSkinEditor}
              onTabChange={handleSkinEditorTabChange}
            />
          ) : null}

          {initialSkinSetupOpen ? (
            <InitialSkinSetupOverlay
              presets={availableSkins}
              selectedSkinId={selectedSkinId}
              selectedSkinColors={
                selectedSkinColorsBySkinId[selectedSkinPreset.id] ?? getDefaultAvatarColorSelections(selectedSkinPreset)
              }
              isSubmitting={initialSkinSetupSubmitting}
              onSelectSkin={handleSelectSkin}
              onApply={handleApplyInitialSkin}
            />
          ) : null}

          {chatOpen ? (
            <section className="chat-panel-floating">
              <div className="chat-panel-header">
                <div>
                  <p className="chat-kicker">Social Sena</p>
                  <h2>Chat de sala</h2>
                </div>
                <button
                  type="button"
                  className="chat-close-button"
                  onClick={handleCloseChat}
                >
                  Cerrar
                </button>
              </div>
              <div className="chat-summary">
                <span>Ruta: /{activeTemplate.routeSegment}</span>
                <span>Mapa: {activeTemplate.world.width} x {activeTemplate.world.height}</span>
                <span>Spawn: {activeTemplate.world.spawn.x}, {activeTemplate.world.spawn.y}</span>
                <span>Plantillas: {availableRoomRoutes.join(', ')}</span>
              </div>
              <div className="chat-log">
                {messages.length === 0 ? (
                  <p className="empty-state">Todavia no hay mensajes en la sala.</p>
                ) : (
                  messages.map((message) => (
                    <p key={message.messageId}>
                      <strong>{message.displayName}:</strong> {message.content}
                    </p>
                  ))
                )}
              </div>
              <form className="chat-form" onSubmit={handleChatSubmit}>
                <input
                  value={chatInput}
                  onChange={(event) => handleChatInputChange(event.target.value)}
                  placeholder="Escribe un mensaje para la sala"
                />
                <button type="submit">Enviar</button>
              </form>
            </section>
          ) : null}

          {!chatOpen && quickChatOpen ? (
            <section className="quick-chat-bar" aria-label="Barra de chat rapido">
              <form className="quick-chat-form" onSubmit={handleQuickChatSubmit}>
                <input
                  ref={quickChatInputRef}
                  value={chatInput}
                  onChange={(event) => handleChatInputChange(event.target.value)}
                  placeholder="Escribe rapido y pulsa Enter"
                />
                <span>Enter envia · Enter vacio cierra</span>
              </form>
            </section>
          ) : null}

          {activeDialogue ? (
            <DialogueOverlay
              dialogue={activeDialogue.dialogue}
              lineIndex={activeDialogue.lineIndex}
              fullText={currentDialogueLine}
              visibleText={currentDialogueLine.slice(0, dialogueVisibleChars)}
              onAdvance={advanceDialogue}
            />
          ) : null}

          {activeTouchPrompt ? (
            <section
              className="fullscreen-touch-prompt"
              aria-modal="true"
              role="dialog"
              aria-label={activeTouchPrompt.kind === 'enemy' ? 'Encuentro rival' : 'Evento rival'}
            >
              <div className="fullscreen-touch-prompt-backdrop" />
              <div className={`fullscreen-touch-prompt-panel ${activeTouchPrompt.kind === 'enemy' ? 'is-enemy' : ''}`}>
                {activeTouchPrompt.title && activeTouchPrompt.kind !== 'enemy' ? (
                  <header className="fullscreen-touch-prompt-header">
                    <h2>{activeTouchPrompt.title}</h2>
                  </header>
                ) : null}
                {activeTouchPrompt.kind === 'enemy' ? (
                  activeTouchPrompt.phase === 'battle' && activeCombatCurrentParticipant ? (
                    <div className="pokemon-combat-shell">
                      <div className="pokemon-combat-stage">
                        <div className="pokemon-combat-stage-header">
                          <span>Combate activo</span>
                          <span>{`Lider: ${activeTouchPrompt.combatLeaderDisplayName}`}</span>
                        </div>

                        <div className="pokemon-combat-battlefield">
                          <section className="pokemon-combat-enemy-zone">
                            <article className="pokemon-combat-status-card is-enemy">
                              <div className="pokemon-combat-status-topline">
                                <strong>{activeTouchPrompt.title}</strong>
                                <span>{`Nv${activeTouchPrompt.enemyLevel}`}</span>
                              </div>
                              <div className="pokemon-combat-status-bar-row">
                                <span>PS</span>
                                <div className="pokemon-combat-status-bar">
                                  <div className="pokemon-combat-status-bar-fill" style={{ width: '100%' }} />
                                </div>
                              </div>
                              <p>{`Rival listo para el combate`}</p>
                            </article>

                            <div className="pokemon-combat-platform is-enemy">
                              <PokemonCombatEnemySprite
                                enemyTemplate={activeCombatEnemyTemplate}
                                label={activeTouchPrompt.title}
                                size={172}
                              />
                            </div>
                          </section>

                          <section className="pokemon-combat-ally-zone">
                            <div className="pokemon-combat-platform is-ally">
                              <div className="pokemon-combat-ally-formation">
                                <div className="pokemon-combat-ally-squad" aria-label="Equipo aliado en combate">
                                  {activeCombatBattlefieldParticipants.map((participant) => (
                                    <div
                                      key={participant.userId}
                                      className={`pokemon-combat-ally-sprite-slot ${
                                        participant.userId === activeCombatCurrentParticipant.userId ? 'is-current' : ''
                                      }`}
                                    >
                                      <PokemonCombatParticipantSprite
                                        participant={participant}
                                        size={activeCombatParticipantSpriteSize}
                                      />
                                    </div>
                                  ))}
                                </div>
                              </div>
                            </div>

                            <article className="pokemon-combat-status-card is-ally">
                              <div className="pokemon-combat-status-topline">
                                <strong>{activeCombatCurrentParticipant.displayName}</strong>
                                <span>{`Nv${Math.max(1, Math.floor(activeCombatCurrentParticipant.level ?? 1))}`}</span>
                              </div>
                              <div className="pokemon-combat-status-bar-row">
                                <span>PS</span>
                                <div className="pokemon-combat-status-bar">
                                  <div className="pokemon-combat-status-bar-fill" style={{ width: '100%' }} />
                                </div>
                              </div>
                              <p>{`Aliados presentes: ${activeTouchPrompt.participants.length}`}</p>
                              <div className="pokemon-combat-team-health-list" aria-label="Salud del equipo">
                                {activeCombatHealthParticipants.map((participant) => (
                                  <div
                                    key={participant.userId}
                                    className={`pokemon-combat-team-health-row ${
                                      participant.userId === activeCombatCurrentParticipant.userId ? 'is-current' : ''
                                    }`}
                                  >
                                    <div className="pokemon-combat-team-health-topline">
                                      <strong className="pokemon-combat-team-health-name">
                                        {participant.userId === activeCombatCurrentParticipant.userId ? 'Tu' : participant.displayName}
                                      </strong>
                                      <span className="pokemon-combat-team-health-level">{`Nv${Math.max(
                                        1,
                                        Math.floor(participant.level ?? 1),
                                      )}`}</span>
                                    </div>
                                    <div className="pokemon-combat-team-health-bar">
                                      <div className="pokemon-combat-team-health-fill" style={{ width: '100%' }} />
                                    </div>
                                  </div>
                                ))}
                              </div>
                            </article>
                          </section>
                        </div>
                      </div>

                      <div className="pokemon-combat-command-shell">
                        <div className="pokemon-combat-dialogue-box">
                          <p className="pokemon-combat-dialogue-title">{`¿Que hara ${activeCombatCurrentParticipant.displayName}?`}</p>
                          <p className="pokemon-combat-dialogue-copy">
                            {`Rival: ${activeTouchPrompt.title} · Lider del combate: ${activeTouchPrompt.combatLeaderDisplayName}`}
                          </p>
                          <div className="pokemon-combat-party-strip">
                            {activeTouchPrompt.participants.map((participant) => (
                              <span
                                key={participant.userId}
                                className={`pokemon-combat-party-chip ${
                                  participant.userId === activeCombatCurrentParticipant.userId ? 'is-active' : ''
                                }`}
                              >
                                {participant.userId === activeCombatCurrentParticipant.userId ? 'Tu' : participant.displayName}
                              </span>
                            ))}
                          </div>
                          {activeCombatSupportParticipants.length > 0 ? (
                            <div className="pokemon-combat-support-strip">
                              {activeCombatSupportParticipants.map((participant) => (
                                <div key={participant.userId} className="pokemon-combat-support-card">
                                  <PokemonCombatParticipantSprite participant={participant} size={54} />
                                  <span>{participant.displayName}</span>
                                </div>
                              ))}
                            </div>
                          ) : null}
                          {!canRetreatFromActiveEnemyCombat ? (
                            <p className="pokemon-combat-dialogue-helper">
                              {isCombatLeaderParticipantPresent
                                ? `Solo ${activeTouchPrompt.combatLeaderDisplayName} puede huir.`
                                : 'El lider aun no se unio. Cualquier participante puede iniciar o huir.'}
                            </p>
                          ) : null}
                        </div>

                        <div className="pokemon-combat-command-grid">
                          <button
                            type="button"
                            className="pokemon-combat-command-button is-fight"
                            onClick={() => handleBattleCommandPreview('Luchar')}
                          >
                            LUCHAR
                          </button>
                          <button
                            type="button"
                            className="pokemon-combat-command-button is-bag"
                            onClick={() => handleBattleCommandPreview('Mochila')}
                          >
                            MOCHILA
                          </button>
                          <button
                            type="button"
                            className="pokemon-combat-command-button is-party"
                            onClick={() => handleBattleCommandPreview('Grupo')}
                          >
                            GRUPO
                          </button>
                          <button
                            type="button"
                            className="pokemon-combat-command-button is-run"
                            onClick={handleEnemyFlee}
                            disabled={isSubmittingEnemyCombatFlee}
                          >
                            {isSubmittingEnemyCombatFlee ? '...' : 'HUIR'}
                          </button>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="combat-banner-shell">
                      <button
                        type="button"
                        className="combat-banner-close-button"
                        aria-label="Huir del combate"
                        onClick={handleEnemyFlee}
                        disabled={!canRetreatFromActiveEnemyCombat || isSubmittingEnemyCombatFlee}
                        title={
                          canRetreatFromActiveEnemyCombat
                            ? isSubmittingEnemyCombatFlee
                              ? 'Retirandose del combate...'
                              : 'Retirarse del combate'
                            : isCombatLeaderParticipantPresent
                              ? `Solo ${activeTouchPrompt.combatLeaderDisplayName} puede retirarse`
                              : 'Solo quienes participan pueden retirarse'
                        }
                      >
                        {isSubmittingEnemyCombatFlee ? '...' : 'X'}
                      </button>

                      <div className="combat-banner-topband">
                        <p className="combat-banner-kicker">Sala de espera de combate</p>
                        <div className="combat-banner-heading">
                          <h2>{activeTouchPrompt.title}</h2>
                          <p>{`Iniciado por ${activeTouchPrompt.requestedByDisplayName} · Huida ${Math.round(activeTouchPrompt.fleeChance * 100)}%`}</p>
                          <p>{`Lider del combate: ${activeTouchPrompt.combatLeaderDisplayName}`}</p>
                          {!canStartActiveEnemyCombat ? (
                            <p className="combat-banner-helper-copy">
                              {isCombatLeaderParticipantPresent
                                ? `Solo ${activeTouchPrompt.combatLeaderDisplayName} puede iniciar el combate.`
                                : 'El lider aun no se unio. Cualquier participante puede iniciar el combate.'}
                            </p>
                          ) : null}
                          {!canRetreatFromActiveEnemyCombat ? (
                            <p className="combat-banner-helper-copy">
                              {isCombatLeaderParticipantPresent
                                ? `Solo ${activeTouchPrompt.combatLeaderDisplayName} puede retirarse.`
                                : 'El lider aun no se unio. Cualquier participante puede retirarse.'}
                            </p>
                          ) : null}
                        </div>
                      </div>

                      <div className="combat-banner-stage">
                        <section className="combat-banner-side">
                          <header className="combat-banner-side-header">
                            <span>Aliados</span>
                            <strong>{activeTouchPrompt.participants.length}</strong>
                          </header>
                          <div className="combat-banner-roster is-allies">
                            {activeTouchPrompt.participants.map((participant) => (
                              <CombatParticipantPreview
                                key={participant.userId}
                                participant={participant}
                                isRequester={participant.userId === activeTouchPrompt.requestedByUserId}
                              />
                            ))}
                          </div>
                        </section>

                        <div className="combat-banner-versus">
                          <span>VS</span>
                        </div>

                        <section className="combat-banner-side is-enemy">
                          <header className="combat-banner-side-header is-enemy">
                            <span>Rival</span>
                            <strong>{activeTouchPrompt.enemyLevel}</strong>
                          </header>
                          <div className="combat-banner-roster is-enemy">
                            <CombatEnemyPreview
                              enemyTemplate={activeCombatEnemyTemplate}
                              label={activeTouchPrompt.title}
                              enemyLevel={activeTouchPrompt.enemyLevel}
                            />
                          </div>
                        </section>
                      </div>

                      <div className="combat-banner-bottomband">
                        <button
                          type="button"
                          className="combat-banner-start-button"
                          onClick={handleEnemyCombatStart}
                          disabled={isSubmittingEnemyCombatStart}
                          title={
                            canStartActiveEnemyCombat
                              ? isSubmittingEnemyCombatStart
                                ? 'Preparando el combate...'
                                : 'Comenzar combate'
                              : isCombatLeaderParticipantPresent
                                ? `Solo ${activeTouchPrompt.combatLeaderDisplayName} puede iniciar el combate`
                                : 'Solo quienes participan pueden iniciar el combate'
                          }
                        >
                          {isSubmittingEnemyCombatStart ? 'Preparando...' : 'Iniciar combate'}
                        </button>
                      </div>
                    </div>
                  )
                ) : (
                  <>
                    <div className="fullscreen-touch-prompt-body" />
                    <div className="fullscreen-touch-prompt-actions">
                      <button
                        type="button"
                        className="secondary-action-button is-active"
                        onClick={closeActiveTouchPrompt}
                      >
                        Cerrar
                      </button>
                    </div>
                  </>
                )}
              </div>
            </section>
          ) : null}
        </div>
      </div>
    </main>
  )
}

export default GameClient
