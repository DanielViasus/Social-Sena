import { FormEvent, useEffect, useEffectEvent, useRef, useState } from 'react'
import { io, type Socket } from 'socket.io-client'
import { clientEvents, serverEvents, type ChatMessage, type Position, type Presence, type RoomState } from '@social-sena/shared'
import type { AuthSession } from '../auth/localSession'
import PhaserWorld from './PhaserWorld'
import { availableRoomRoutes, resolveRoomTemplateFromPath } from '../rooms/registry'

const SERVER_URL = import.meta.env.VITE_GAME_SERVER_URL ?? 'http://localhost:3001'

interface GameClientProps {
  onLogout: () => void
  session: AuthSession
}

function GameClient({ session, onLogout }: GameClientProps) {
  const [pathname, setPathname] = useState(() => window.location.pathname)
  const [room, setRoom] = useState<RoomState | null>(null)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [floatingMessages, setFloatingMessages] = useState<ChatMessage[]>([])
  const [chatInput, setChatInput] = useState('')
  const [connected, setConnected] = useState(false)
  const [optionsOpen, setOptionsOpen] = useState(false)
  const [chatOpen, setChatOpen] = useState(false)
  const socketRef = useRef<Socket | null>(null)
  const optionsMenuRef = useRef<HTMLDivElement | null>(null)
  const chatOpenRef = useRef(false)
  const floatingTimeoutsRef = useRef<Map<string, number>>(new Map())
  const activeTemplate = resolveRoomTemplateFromPath(pathname)
  const playerInitial = session.profile.displayName.slice(0, 1).toUpperCase()

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
    const nextSocket = io(SERVER_URL, {
      autoConnect: true,
    })

    socketRef.current = nextSocket

    nextSocket.on('connect', () => {
      setConnected(true)
      setRoom(null)
      setMessages([])
      setFloatingMessages([])
      nextSocket.emit(clientEvents.connectToGame, { profile: session.profile })
      nextSocket.emit(clientEvents.joinRoom, {
        roomId: activeTemplate.id,
        templateId: activeTemplate.id,
      })
    })

    nextSocket.on('disconnect', () => {
      setConnected(false)
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
        return {
          ...currentRoom,
          players: currentRoom.players.filter((player) => player.sessionId !== sessionId),
        }
      })
    })

    nextSocket.on(serverEvents.chatMessage, (message: ChatMessage) => {
      setMessages((currentMessages) => [...currentMessages, message])
      if (!chatOpenRef.current) {
        enqueueFloatingMessage(message)
      }
    })

    return () => {
      socketRef.current = null
      nextSocket.disconnect()
    }
  }, [activeTemplate.id, session.profile])

  const currentPlayer =
    room?.players.find((player) => player.userId === session.profile.userId) ?? null
  const activePlayers = room?.players ?? []

  const handleOpenChat = () => {
    floatingTimeoutsRef.current.forEach((timeoutId) => window.clearTimeout(timeoutId))
    floatingTimeoutsRef.current.clear()
    setFloatingMessages([])
    setChatOpen(true)
  }

  const handleNavigate = (target: Position) => {
    const socket = socketRef.current
    if (!socket || !room || !connected) {
      return
    }

    socket.emit(clientEvents.navigateTo, {
      roomId: room.roomId,
      target,
    })
  }

  const handleChatSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const socket = socketRef.current
    if (!socket || !chatInput.trim() || !room) return

    socket.emit(clientEvents.sendChatMessage, {
      roomId: room.roomId,
      content: chatInput,
    })
    setChatInput('')
  }

  return (
    <main className="hud-layout">
      <div className="world-canvas fullscreen-world">
        <PhaserWorld
          room={room}
          currentUserId={session.profile.userId}
          template={activeTemplate}
          onNavigate={handleNavigate}
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
                  onClick={() => setChatOpen(false)}
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
                  onChange={(event) => setChatInput(event.target.value)}
                  placeholder="Escribe un mensaje para la sala"
                />
                <button type="submit">Enviar</button>
              </form>
            </section>
          ) : null}
        </div>
      </div>
    </main>
  )
}

export default GameClient
