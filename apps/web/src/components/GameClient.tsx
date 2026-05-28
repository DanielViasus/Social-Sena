import { FormEvent, useEffect, useEffectEvent, useRef, useState } from 'react'
import { io, type Socket } from 'socket.io-client'
import {
  clientEvents,
  serverEvents,
  type ChatMessage,
  type Position,
  type Presence,
  type RoomNpcTemplate,
  type RoomState,
  type TypingStateChangedPayload,
} from '@social-sena/shared'
import { saveAuthSession, savePreferredSkin, type AuthSession } from '../auth/localSession'
import type { DialogueDefinition } from '../dialogue/registry'
import { getDialogueById } from '../dialogue/registry'
import { getAvailableAvatarPresets } from '../game/avatar/avatarSprites'
import ReactWorld from './ReactWorld'
import DialogueOverlay from './dialogue/DialogueOverlay'
import MobileNpcInteractButton from './MobileNpcInteractButton'
import SkinEditorOverlay from './skins/SkinEditorOverlay'
import { availableRoomRoutes, resolveRoomTemplateFromPath } from '../rooms/registry'

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

function GameClient({ session, onLogout, onSessionChange }: GameClientProps) {
  const MAX_HEADLINE_SPEECH_CHARS = 30
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
  const [activeDialogue, setActiveDialogue] = useState<ActiveDialogueState | null>(null)
  const [dialogueVisibleChars, setDialogueVisibleChars] = useState(0)
  const [npcInteractionLocked, setNpcInteractionLocked] = useState(false)
  const [mobileInteractionEnabled, setMobileInteractionEnabled] = useState(false)
  const [activeInteractableNpc, setActiveInteractableNpc] = useState<RoomNpcTemplate | null>(null)
  const [skinEditorOpen, setSkinEditorOpen] = useState(false)
  const [selectedSkinId, setSelectedSkinId] = useState(session.profile.skinId)
  const socketRef = useRef<Socket | null>(null)
  const sessionProfileRef = useRef(session.profile)
  const movementInputRef = useRef({
    up: false,
    down: false,
    left: false,
    right: false,
  })
  const optionsMenuRef = useRef<HTMLDivElement | null>(null)
  const chatOpenRef = useRef(false)
  const floatingTimeoutsRef = useRef<Map<string, number>>(new Map())
  const speechTimeoutsRef = useRef<Map<string, number>>(new Map())
  const typingIdleTimeoutRef = useRef<number | null>(null)
  const localTypingStateRef = useRef(false)
  const dialogueCooldownTimeoutRef = useRef<number | null>(null)
  const dialogueAudioContextRef = useRef<AudioContext | null>(null)
  const dialogueAudioUnlockedRef = useRef(false)
  const lastDialogueAudioProgressRef = useRef<{ lineKey: string; visibleChars: number }>({
    lineKey: '',
    visibleChars: 0,
  })
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

  const emitMovementInput = useEffectEvent((nextInput: typeof movementInputRef.current) => {
    movementInputRef.current = nextInput

    const socket = socketRef.current
    if (!socket || !connected || !room) {
      return
    }

    socket.emit(clientEvents.setMovementInput, {
      roomId: room.roomId,
      ...nextInput,
    })
  })

  const clearMovementInput = useEffectEvent(() => {
    const nextInput = {
      up: false,
      down: false,
      left: false,
      right: false,
    }

    const currentInput = movementInputRef.current
    if (
      currentInput.up === nextInput.up &&
      currentInput.down === nextInput.down &&
      currentInput.left === nextInput.left &&
      currentInput.right === nextInput.right
    ) {
      return
    }

    emitMovementInput(nextInput)
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
    sessionProfileRef.current = session.profile
  }, [session.profile])

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
      clearMovementInput()
    }
  }, [clearMovementInput])

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
      if (dialogueAudioContextRef.current && dialogueAudioContextRef.current.state !== 'closed') {
        void dialogueAudioContextRef.current.close()
      }
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

      if (event.key.toLowerCase() === 'm' && !activeDialogue) {
        event.preventDefault()
        setSkinEditorOpen((currentValue) => !currentValue)
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [activeDialogue])

  useEffect(() => {
    const resolveMovementKey = (key: string) => {
      switch (key.toLowerCase()) {
        case 'w':
          return 'up' as const
        case 'a':
          return 'left' as const
        case 's':
          return 'down' as const
        case 'd':
          return 'right' as const
        default:
          return null
      }
    }

    const handleMovementKeyDown = (event: KeyboardEvent) => {
      const movementKey = resolveMovementKey(event.key)
      if (!movementKey) {
        return
      }

      const target = event.target as HTMLElement | null
      const tagName = target?.tagName?.toLowerCase()
      const isTyping =
        tagName === 'input' ||
        tagName === 'textarea' ||
        target?.isContentEditable === true

      if (isTyping || activeDialogue || skinEditorOpen) {
        return
      }

      const currentInput = movementInputRef.current
      if (currentInput[movementKey]) {
        return
      }

      event.preventDefault()
      emitMovementInput({
        ...currentInput,
        [movementKey]: true,
      })
    }

    const handleMovementKeyUp = (event: KeyboardEvent) => {
      const movementKey = resolveMovementKey(event.key)
      if (!movementKey) {
        return
      }

      const currentInput = movementInputRef.current
      if (!currentInput[movementKey]) {
        return
      }

      event.preventDefault()
      emitMovementInput({
        ...currentInput,
        [movementKey]: false,
      })
    }

    const handleWindowBlur = () => {
      clearMovementInput()
    }

    window.addEventListener('keydown', handleMovementKeyDown)
    window.addEventListener('keyup', handleMovementKeyUp)
    window.addEventListener('blur', handleWindowBlur)

    return () => {
      window.removeEventListener('keydown', handleMovementKeyDown)
      window.removeEventListener('keyup', handleMovementKeyUp)
      window.removeEventListener('blur', handleWindowBlur)
    }
  }, [activeDialogue, clearMovementInput, emitMovementInput, skinEditorOpen])

  useEffect(() => {
    if (activeDialogue || skinEditorOpen) {
      clearMovementInput()
    }
  }, [activeDialogue, clearMovementInput, skinEditorOpen])

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
      setConnected(true)
      setRoom(null)
      setMessages([])
      setFloatingMessages([])
      setActiveSpeechByUserId({})
      setTypingByUserId({})
      localTypingStateRef.current = false
      nextSocket.emit(clientEvents.connectToGame, { profile: sessionProfileRef.current })
      nextSocket.emit(clientEvents.joinRoom, {
        roomId: activeTemplate.id,
        templateId: activeTemplate.id,
      })
    })

    nextSocket.on('disconnect', () => {
      setConnected(false)
      setTypingByUserId({})
      localTypingStateRef.current = false
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
      setRoom((currentRoom) => {
        if (!currentRoom) return currentRoom
        const departedPlayer = currentRoom.players.find((player) => player.sessionId === sessionId)
        if (departedPlayer) {
          clearPlayerSpeech(departedPlayer.userId)
          clearPlayerTyping(departedPlayer.userId)
        }
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
        enqueueFloatingMessage(message)
      }
    })

    return () => {
      socketRef.current = null
      nextSocket.disconnect()
    }
  }, [activeTemplate.id, session.profile.userId])

  const currentPlayer =
    room?.players.find((player) => player.userId === session.profile.userId) ?? null
  const appliedSkinId = currentPlayer?.skinId ?? sessionProfileRef.current.skinId
  const activePlayers = room?.players ?? []
  const currentDialogueLine = activeDialogue
    ? activeDialogue.dialogue.lines[activeDialogue.lineIndex] ?? ''
    : ''
  const isDialogueLineComplete = dialogueVisibleChars >= currentDialogueLine.length

  const handleOpenChat = () => {
    floatingTimeoutsRef.current.forEach((timeoutId) => window.clearTimeout(timeoutId))
    floatingTimeoutsRef.current.clear()
    setFloatingMessages([])
    setChatOpen(true)
  }

  const requestStopMovement = useEffectEvent(() => {
    const socket = socketRef.current
    if (!socket || !room || !connected) {
      return
    }

    socket.emit(clientEvents.stopNavigation, {
      roomId: room.roomId,
    })
  })

  const ensureDialogueAudioUnlocked = useEffectEvent(async () => {
    if (typeof window === 'undefined' || typeof window.AudioContext === 'undefined') {
      return
    }

    if (!dialogueAudioContextRef.current) {
      dialogueAudioContextRef.current = new window.AudioContext()
    }

    if (dialogueAudioContextRef.current.state === 'suspended') {
      try {
        await dialogueAudioContextRef.current.resume()
      } catch {
        return
      }
    }

    dialogueAudioUnlockedRef.current = dialogueAudioContextRef.current.state === 'running'
  })

  const playDialogueBlip = useEffectEvent(() => {
    const audioContext = dialogueAudioContextRef.current
    if (!audioContext || !dialogueAudioUnlockedRef.current) {
      return
    }

    const oscillator = audioContext.createOscillator()
    const gainNode = audioContext.createGain()

    oscillator.type = 'square'
    oscillator.frequency.setValueAtTime(880, audioContext.currentTime)
    oscillator.frequency.exponentialRampToValueAtTime(660, audioContext.currentTime + 0.035)

    gainNode.gain.setValueAtTime(0.0001, audioContext.currentTime)
    gainNode.gain.exponentialRampToValueAtTime(0.018, audioContext.currentTime + 0.005)
    gainNode.gain.exponentialRampToValueAtTime(0.0001, audioContext.currentTime + 0.045)

    oscillator.connect(gainNode)
    gainNode.connect(audioContext.destination)
    oscillator.start(audioContext.currentTime)
    oscillator.stop(audioContext.currentTime + 0.05)
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

    void ensureDialogueAudioUnlocked()

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
    if (!socket || !room || !connected || activeDialogue) {
      return
    }

    socket.emit(clientEvents.navigateTo, {
      roomId: room.roomId,
      target,
    })
  }

  const handleNpcInteract = useEffectEvent((npc: RoomNpcTemplate) => {
    if (activeDialogue || npcInteractionLocked || skinEditorOpen) {
      return
    }

    void ensureDialogueAudioUnlocked()
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

  const handleApplySkin = useEffectEvent(() => {
    if (!room) {
      setSkinEditorOpen(false)
      return
    }

    const nextSkinId = selectedSkinId.trim()
    if (!nextSkinId) {
      return
    }

    const socket = socketRef.current
    if (socket) {
      socket.emit(clientEvents.updateSkin, {
        roomId: room.roomId,
        skinId: nextSkinId,
      })
    }

    sessionProfileRef.current = {
      ...sessionProfileRef.current,
      skinId: nextSkinId,
    }

    const nextSession: AuthSession = {
      ...session,
      profile: {
        ...session.profile,
        skinId: nextSkinId,
      },
    }

    savePreferredSkin(session.profile.userId, nextSkinId)
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
              }
            : player,
        ),
      }
    })

    setSkinEditorOpen(false)
  })

  useEffect(() => {
    if (!skinEditorOpen) {
      return
    }

    setSelectedSkinId(appliedSkinId)
  }, [appliedSkinId, skinEditorOpen])

  const handleChatSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const socket = socketRef.current
    if (!socket || !chatInput.trim() || !room) return

    stopLocalTyping()
    socket.emit(clientEvents.sendChatMessage, {
      roomId: room.roomId,
      content: chatInput,
    })
    setChatInput('')
  }

  const handleChatInputChange = (nextValue: string) => {
    setChatInput(nextValue)

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
          navigationEnabled={!activeDialogue && !skinEditorOpen}
          npcInteractionEnabled={!activeDialogue && !npcInteractionLocked && !skinEditorOpen}
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
              onClick={() => setOptionsOpen((isOpen) => !isOpen)}
              aria-expanded={optionsOpen}
              aria-label="Abrir opciones de estado"
            >
              O
            </button>

            {optionsOpen ? (
              <section className="dropdown-panel options-panel">
                <header className="dropdown-header">
                  <h2>Opciones</h2>
                </header>
                <div className="dropdown-body">
                  <div className="dropdown-row">
                    <span>Conectividad</span>
                    <strong>{connected ? 'Online' : 'Offline'}</strong>
                  </div>
                  <div className="dropdown-row">
                    <span>Ruta</span>
                    <strong>/{activeTemplate.routeSegment}</strong>
                  </div>
                  <div className="dropdown-row">
                    <span>Posicion</span>
                    <strong>
                      {currentPlayer
                        ? `${Math.round(currentPlayer.position.x)}, ${Math.round(currentPlayer.position.y)}`
                        : 'sin datos'}
                    </strong>
                  </div>
                  <div className="dropdown-row">
                    <span>Mi usuario</span>
                    <strong>{session.profile.displayName}</strong>
                    <small className="dropdown-subtext">{session.profile.userId}</small>
                  </div>
                  <div className="dropdown-block">
                    <span>Usuarios activos</span>
                    <ul className="players-list">
                      {activePlayers.length === 0 ? (
                        <li>Sin jugadores visibles</li>
                      ) : (
                        activePlayers.map((player) => (
                          <li key={player.sessionId}>
                            <strong>{player.displayName}</strong>
                            <small>{player.userId}</small>
                          </li>
                        ))
                      )}
                    </ul>
                  </div>
                  <div className="dropdown-row">
                    <span>Modo debug</span>
                    <strong>{debugEnabled ? 'Activo' : 'Inactivo'}</strong>
                    <small className="dropdown-subtext">Atajo rapido: tecla P</small>
                  </div>
                  <button
                    type="button"
                    className={`secondary-action-button ${debugEnabled ? 'is-active' : ''}`}
                    onClick={() => setDebugEnabled((currentValue) => !currentValue)}
                  >
                    {debugEnabled ? 'Ocultar coliders' : 'Mostrar coliders'}
                  </button>
                  <button type="button" className="secondary-action-button" onClick={onLogout}>
                    Cerrar sesion
                  </button>
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

          <button
            type="button"
            className="hud-square-button chat-button"
            onClick={handleOpenChat}
            aria-label="Abrir chat"
          >
            Chat
          </button>

          {mobileInteractionEnabled && activeInteractableNpc && !activeDialogue && !npcInteractionLocked && !skinEditorOpen ? (
            <MobileNpcInteractButton onInteract={() => handleNpcInteract(activeInteractableNpc)} />
          ) : null}

          {skinEditorOpen ? (
            <SkinEditorOverlay
              presets={availableSkins}
              selectedSkinId={selectedSkinId}
              appliedSkinId={appliedSkinId}
              onSelectSkin={setSelectedSkinId}
              onApply={handleApplySkin}
              onClose={() => setSkinEditorOpen(false)}
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
                  onClick={() => {
                    stopLocalTyping()
                    setChatOpen(false)
                  }}
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
