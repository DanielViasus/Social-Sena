import { FormEvent, useCallback, useEffect, useEffectEvent, useRef, useState } from 'react'
import { io, type Socket } from 'socket.io-client'
import {
  clientEvents,
  serverEvents,
  DEFAULT_AUDIO_SETTINGS,
  normalizeAudioSettings,
  type AudioSettings,
  type ChatMessage,
  type ConnectionAcceptedPayload,
  type FriendRequestSummary,
  type FriendSummary,
  type Position,
  type Presence,
  type RoomNpcTemplate,
  type RoomState,
  type SkinColorSelections,
  type SocialStatePayload,
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
  resolveAvatarSheetUrl,
  type AvatarColorSelections,
} from '../game/avatar/avatarSprites'
import ReactWorld from './ReactWorld'
import DialogueOverlay from './dialogue/DialogueOverlay'
import MobileNpcInteractButton from './MobileNpcInteractButton'
import InitialSkinSetupOverlay from './skins/InitialSkinSetupOverlay'
import SkinEditorOverlay from './skins/SkinEditorOverlay'
import { availableRoomRoutes, resolveRoomTemplateFromPath } from '../rooms/registry'
import { createUiSoundController, type UiSoundName } from '../audio/chiptuneSounds'
import { createAmbientMusicController } from '../audio/chiptuneMusic'

const SERVER_URL = import.meta.env.VITE_GAME_SERVER_URL ?? 'http://localhost:3001'

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

interface FriendRequestPopupState extends FriendRequestSummary {
  expiresAt: number
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

function GameClient({ session, onLogout, onSessionChange }: GameClientProps) {
  const MAX_HEADLINE_SPEECH_CHARS = 30
  const FRIEND_REQUEST_POPUP_DURATION_MS = 8000
  const [pathname, setPathname] = useState(() => window.location.pathname)
  const [room, setRoom] = useState<RoomState | null>(null)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [floatingMessages, setFloatingMessages] = useState<ChatMessage[]>([])
  const [chatInput, setChatInput] = useState('')
  const [activeSpeechByUserId, setActiveSpeechByUserId] = useState<Record<string, string>>({})
  const [typingByUserId, setTypingByUserId] = useState<Record<string, boolean>>({})
  const [typingIndicatorFrame, setTypingIndicatorFrame] = useState(0)
  const [connected, setConnected] = useState(false)
  const [optionsOpen, setOptionsOpen] = useState(false)
  const [chatOpen, setChatOpen] = useState(false)
  const [debugEnabled, setDebugEnabled] = useState(false)
  const [friends, setFriends] = useState<FriendSummary[]>([])
  const [incomingFriendRequests, setIncomingFriendRequests] = useState<FriendRequestSummary[]>([])
  const [outgoingFriendRequestUserIds, setOutgoingFriendRequestUserIds] = useState<string[]>([])
  const [friendRequestPopups, setFriendRequestPopups] = useState<FriendRequestPopupState[]>([])
  const [addingFriendUserId, setAddingFriendUserId] = useState<string | null>(null)
  const [respondingFriendRequestId, setRespondingFriendRequestId] = useState<string | null>(null)
  const [removingFriendUserId, setRemovingFriendUserId] = useState<string | null>(null)
  const [activeDialogue, setActiveDialogue] = useState<ActiveDialogueState | null>(null)
  const [dialogueVisibleChars, setDialogueVisibleChars] = useState(0)
  const [npcInteractionLocked, setNpcInteractionLocked] = useState(false)
  const [mobileInteractionEnabled, setMobileInteractionEnabled] = useState(false)
  const [activeInteractableNpc, setActiveInteractableNpc] = useState<RoomNpcTemplate | null>(null)
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
  const sessionRef = useRef(session)
  const sessionProfileRef = useRef(session.profile)
  const optionsMenuRef = useRef<HTMLDivElement | null>(null)
  const chatOpenRef = useRef(false)
  const floatingTimeoutsRef = useRef<Map<string, number>>(new Map())
  const friendRequestPopupTimeoutsRef = useRef<Map<string, number>>(new Map())
  const friendRequestPopupsRef = useRef<FriendRequestPopupState[]>([])
  const speechTimeoutsRef = useRef<Map<string, number>>(new Map())
  const typingIdleTimeoutRef = useRef<number | null>(null)
  const localTypingStateRef = useRef(false)
  const dismissedFriendRequestIdsRef = useRef<Set<string>>(new Set())
  const dialogueCooldownTimeoutRef = useRef<number | null>(null)
  const uiSoundControllerRef = useRef<ReturnType<typeof createUiSoundController> | null>(null)
  const ambientMusicControllerRef = useRef<ReturnType<typeof createAmbientMusicController> | null>(null)
  const persistAudioSettingsTimeoutRef = useRef<number | null>(null)
  const pendingAudioSettingsSyncRef = useRef<AudioSettings | null>(null)
  const chatTypingToneStepRef = useRef(0)
  const lastDialogueAudioProgressRef = useRef<{ lineKey: string; visibleChars: number }>({
    lineKey: '',
    visibleChars: 0,
  })
  if (!uiSoundControllerRef.current) {
    uiSoundControllerRef.current = createUiSoundController()
  }
  if (!ambientMusicControllerRef.current) {
    ambientMusicControllerRef.current = createAmbientMusicController()
  }
  const activeTemplate = resolveRoomTemplateFromPath(pathname)
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
    setFloatingMessages((currentMessages) => {
      const nextMessages = [message, ...currentMessages].slice(0, 3)
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
      musicVolume: audioSettings.musicVolume,
    })
  }, [audioSettings])

  useEffect(() => {
    friendRequestPopupsRef.current = friendRequestPopups
  }, [friendRequestPopups])

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
      setConnected(true)
      setRoom(null)
      setMessages([])
      setFloatingMessages([])
      setActiveSpeechByUserId({})
      setTypingByUserId({})
      setFriends([])
      setIncomingFriendRequests([])
      setOutgoingFriendRequestUserIds([])
      friendRequestPopupsRef.current = []
      setFriendRequestPopups([])
      dismissedFriendRequestIdsRef.current.clear()
      localTypingStateRef.current = false
      nextSocket.emit(clientEvents.connectToGame, { profile: sessionProfileRef.current })
    })

    nextSocket.on('disconnect', () => {
      clearAllFriendRequestPopupTimeouts()
      setConnected(false)
      setTypingByUserId({})
      setFriends([])
      setIncomingFriendRequests([])
      setOutgoingFriendRequestUserIds([])
      friendRequestPopupsRef.current = []
      setFriendRequestPopups([])
      dismissedFriendRequestIdsRef.current.clear()
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
      }: ConnectionAcceptedPayload) => {
        sessionProfileRef.current = profile
        setAudioSettings(normalizeAudioSettings(profile.audioSettings))
        setFriends(friends)
        setIncomingFriendRequests(incomingFriendRequests)
        setOutgoingFriendRequestUserIds(outgoingFriendRequestUserIds)

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
        nextSocket.emit(clientEvents.joinRoom, {
          roomId: activeTemplate.id,
          templateId: activeTemplate.id,
        })
      },
    )

    nextSocket.on(serverEvents.socialState, ({ friends, incomingFriendRequests, outgoingFriendRequestUserIds }: SocialStatePayload) => {
      setFriends(friends)
      setIncomingFriendRequests(incomingFriendRequests)
      setOutgoingFriendRequestUserIds(outgoingFriendRequestUserIds)
    })

    nextSocket.on(serverEvents.friendRequestReceived, (request: FriendRequestSummary) => {
      void playUiSound('friend-request')
      setIncomingFriendRequests((currentValue) =>
        currentValue.some((currentRequest) => currentRequest.requestId === request.requestId)
          ? currentValue
          : [request, ...currentValue],
      )
    })

    nextSocket.on(serverEvents.roomState, (nextRoom: RoomState) => {
      setRoom(nextRoom)
    })

    nextSocket.on(serverEvents.playerJoined, (player: Presence) => {
      setRoom((currentRoom) => {
        if (!currentRoom) return currentRoom
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
      socketRef.current = null
      nextSocket.disconnect()
    }
  }, [
    activeTemplate.id,
    clearAllFriendRequestPopupTimeouts,
    session.profile.userId,
  ])

  const currentPlayer =
    room?.players.find((player) => player.userId === session.profile.userId) ?? null
  const appliedSkinId = currentPlayer?.skinId ?? sessionProfileRef.current.skinId
  const appliedSkinPreset = resolveAvatarPreset(appliedSkinId)
  const appliedSkinColors = normalizeAvatarColorSelections(
    appliedSkinPreset,
    currentPlayer?.skinColors ?? sessionProfileRef.current.skinColors,
  )
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
  const pendingFriendRequestCount = incomingFriendRequests.length
  const currentDialogueLine = activeDialogue
    ? activeDialogue.dialogue.lines[activeDialogue.lineIndex] ?? ''
    : ''
  const isDialogueLineComplete = dialogueVisibleChars >= currentDialogueLine.length

  useEffect(() => {
    if (!optionsOpen) {
      return
    }

    socketRef.current?.emit(clientEvents.requestSocialState)
  }, [optionsOpen])

  const handleOpenChat = () => {
    void playUiSound('panel-open')
    floatingTimeoutsRef.current.forEach((timeoutId) => window.clearTimeout(timeoutId))
    floatingTimeoutsRef.current.clear()
    setFloatingMessages([])
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

  const requestStopMovement = useEffectEvent(() => {
    const socket = socketRef.current
    if (!socket || !room || !connected) {
      return
    }

    socket.emit(clientEvents.stopNavigation, {
      roomId: room.roomId,
    })
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
  }, [FRIEND_REQUEST_POPUP_DURATION_MS, clearFriendRequestPopupTimeout, dismissFriendRequestPopup, incomingFriendRequests])

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

  const handleDismissFriendRequestPopup = useEffectEvent((requestId: string) => {
    void playUiSound('panel-close')
    dismissFriendRequestPopup(requestId)
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
  }, [activeDialogue, advanceDialogue])

  const handleNavigate = (target: Position) => {
    const socket = socketRef.current
    if (!socket || !room || !connected || activeDialogue || initialSkinSetupOpen) {
      return
    }

    socket.emit(clientEvents.navigateTo, {
      roomId: room.roomId,
      target,
    })
  }

  const handleNpcInteract = useEffectEvent((npc: RoomNpcTemplate) => {
    if (activeDialogue || npcInteractionLocked || skinEditorOpen || initialSkinSetupOpen) {
      return
    }

    void ensureAudioUnlocked()
    requestStopMovement()

    const dialogue = getDialogueById(npc.dialogueId)
    if (dialogue) {
      setActiveDialogue({
        npcId: npc.id,
        dialogue,
        lineIndex: 0,
      })
      return
    }

    console.info('[NPC] Interaccion ejecutada', {
      npcId: npc.id,
      interactionId: npc.interactionId ?? null,
      roomId: room?.roomId ?? null,
      userId: session.profile.userId,
    })
  })

  const handleInteractShortcut = useEffectEvent(() => {
    if (activeDialogue) {
      advanceDialogue()
      return
    }

    if (activeInteractableNpc && !npcInteractionLocked && !skinEditorOpen && !initialSkinSetupOpen) {
      handleNpcInteract(activeInteractableNpc)
    }
  })

  const toggleDebug = useEffectEvent(() => {
    void playUiSound('select')
    setDebugEnabled((currentValue) => !currentValue)
  })

  const toggleSkinEditor = useEffectEvent(() => {
    if (activeDialogue || initialSkinSetupOpen) {
      return
    }

    void playUiSound(skinEditorOpen ? 'panel-close' : 'panel-open')
    setSkinEditorOpen((currentValue) => !currentValue)
  })

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
        socket.emit(clientEvents.joinRoom, {
          roomId: activeTemplate.id,
          templateId: activeTemplate.id,
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

  const handleChatSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const socket = socketRef.current
    if (!socket || !chatInput.trim() || !room) return

    void playUiSound('send')
    stopLocalTyping()
    socket.emit(clientEvents.sendChatMessage, {
      roomId: room.roomId,
      content: chatInput,
    })
    setChatInput('')
  }

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

  return (
    <main className="hud-layout">
      <div className="world-canvas fullscreen-world">
        <ReactWorld
          room={room}
          currentUserId={session.profile.userId}
          template={activeTemplate}
          onNavigate={handleNavigate}
          debugEnabled={debugEnabled}
          activeSpeechByUserId={activeSpeechByUserId}
          typingByUserId={typingByUserId}
          typingIndicatorText={typingIndicatorText}
          onNpcInteract={handleNpcInteract}
          onActiveInteractableNpcChange={setActiveInteractableNpc}
          navigationEnabled={!activeDialogue && !skinEditorOpen && !initialSkinSetupOpen}
          npcInteractionEnabled={!activeDialogue && !npcInteractionLocked && !skinEditorOpen && !initialSkinSetupOpen}
          suppressNpcIconForId={activeDialogue?.npcId ?? null}
          pointerNpcInteractionEnabled={false}
        />

        <div className="hud-layer">
          <section className="user-card">
            <div className="user-avatar">
              {session.pictureUrl ? (
                <img src={session.pictureUrl} alt={session.profile.displayName} />
              ) : (
                playerInitial
              )}
            </div>
            <div className="user-meta">
              <strong>{session.profile.displayName}</strong>
              <span>Nivel {session.level}</span>
            </div>
          </section>

          <div ref={optionsMenuRef} className="options-anchor">
            <button
              type="button"
              className="hud-square-button options-button"
              onClick={toggleOptionsMenu}
              aria-expanded={optionsOpen}
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
              <section className="dropdown-panel options-panel">
                <header className="dropdown-header">
                  <h2>Menu</h2>
                  <p className="dropdown-header-subtitle">Ajustes rapidos para tu sesion actual.</p>
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
                                {isCurrentPlayer ? (
                                  <span className="menu-inline-tag is-current">Tu personaje</span>
                                ) : isFriend ? (
                                  <span className="menu-inline-tag is-friend">Amistad</span>
                                ) : incomingFriendRequestUserIds.has(player.userId) ? (
                                  <span className="menu-inline-tag is-pending">Te envio solicitud</span>
                                ) : outgoingFriendRequestUserIdSet.has(player.userId) ? (
                                  <span className="menu-inline-tag is-pending">Pendiente</span>
                                ) : (
                                  <button
                                    type="button"
                                    className="mini-action-button"
                                    onClick={() => handleAddFriend(player.userId)}
                                    disabled={addingFriendUserId === player.userId}
                                  >
                                    {addingFriendUserId === player.userId ? 'Enviando...' : 'Solicitar'}
                                  </button>
                                )}
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
                  <details className="dropdown-section" open={friends.length > 0}>
                    <summary>Amistades</summary>
                    <div className="dropdown-section-body">
                      {friends.length === 0 ? (
                        <p className="empty-state">Todavia no agregas amistades.</p>
                      ) : (
                        <ul className="players-list players-list-rich">
                          {friends.map((friend) => {
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
                      className={`secondary-action-button ${debugEnabled ? 'is-active' : ''}`}
                      onClick={toggleDebug}
                    >
                      {debugEnabled ? 'Ocultar coliders' : 'Mostrar coliders'}
                    </button>
                    <button type="button" className="secondary-action-button" onClick={toggleSkinEditor}>
                      Personalizar skin
                    </button>
                    <button type="button" className="secondary-action-button" onClick={onLogout}>
                      Cerrar sesion
                    </button>
                  </div>
                </div>
              </section>
            ) : null}
          </div>

          {!chatOpen && floatingMessages.length > 0 ? (
            <section className="chat-bubble-stack" aria-label="Mensajes emergentes">
              {floatingMessages.map((message) => (
                <article key={message.messageId} className="chat-bubble">
                  <strong>{message.displayName}</strong>
                  <span>{message.content}</span>
                </article>
              ))}
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

          <button
            type="button"
            className="hud-square-button chat-button"
            onClick={handleOpenChat}
            aria-label="Abrir chat"
          >
            Chat
          </button>

          {mobileInteractionEnabled && activeInteractableNpc && !activeDialogue && !npcInteractionLocked && !skinEditorOpen && !initialSkinSetupOpen ? (
            <MobileNpcInteractButton onInteract={() => handleNpcInteract(activeInteractableNpc)} />
          ) : null}

          {!mobileInteractionEnabled ? (
            <section className="shortcut-board" aria-label="Atajos de teclado">
              <header className="shortcut-board-header">
                <h2>Atajos</h2>
              </header>
              <div className="shortcut-board-actions">
                <button type="button" className="shortcut-chip" onClick={toggleDebug}>
                  <span className="shortcut-key">P</span>
                  <span className="shortcut-label">coliders</span>
                </button>
                <button type="button" className="shortcut-chip" onClick={toggleSkinEditor}>
                  <span className="shortcut-key">M</span>
                  <span className="shortcut-label">skins</span>
                </button>
                <button
                  type="button"
                  className={`shortcut-chip ${activeInteractableNpc || activeDialogue ? '' : 'is-disabled'}`}
                  onClick={handleInteractShortcut}
                  disabled={!activeInteractableNpc && !activeDialogue}
                >
                  <span className="shortcut-key">E</span>
                  <span className="shortcut-label">{activeDialogue ? 'dialogo' : 'interactuar'}</span>
                </button>
              </div>
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

          {activeDialogue ? (
            <DialogueOverlay
              dialogue={activeDialogue.dialogue}
              lineIndex={activeDialogue.lineIndex}
              fullText={currentDialogueLine}
              visibleText={currentDialogueLine.slice(0, dialogueVisibleChars)}
              onAdvance={advanceDialogue}
            />
          ) : null}
        </div>
      </div>
    </main>
  )
}

export default GameClient
