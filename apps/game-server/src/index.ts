import { randomUUID } from 'node:crypto'
import { createServer } from 'node:http'
import { Server } from 'socket.io'
import {
  DEFAULT_ROOM_CAPACITY,
  PLAYER_REACH_THRESHOLD,
  PLAYER_SPEED,
  clientEvents,
  connectToGameSchema,
  getRoomTemplateById,
  joinRoomSchema,
  navigateToSchema,
  sendChatMessageSchema,
  serverEvents,
  type ChatMessage,
  type Direction,
  type Position,
  type Presence,
  type RoomState,
  type UserProfile,
} from '@social-sena/shared'

interface SessionState {
  sessionId: string
  profile: UserProfile
  roomId: string | null
}

const port = Number(process.env.PORT ?? 3001)
const allowedOriginPatterns = (process.env.CORS_ALLOWED_ORIGINS ?? 'http://localhost:5173')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean)

function matchesOriginPattern(origin: string, pattern: string) {
  if (pattern === '*') {
    return true
  }

  if (!pattern.includes('*')) {
    return origin === pattern
  }

  const escapedPattern = pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\\\*/g, '.*')
  return new RegExp(`^${escapedPattern}$`).test(origin)
}

function isOriginAllowed(origin?: string) {
  if (!origin) {
    return true
  }

  return allowedOriginPatterns.some((pattern) => matchesOriginPattern(origin, pattern))
}

const httpServer = createServer((request, response) => {
  if (request.url === '/health') {
    response.writeHead(200, { 'content-type': 'application/json; charset=utf-8' })
    response.end(JSON.stringify({ status: 'ok', service: 'social-sena-game-server' }))
    return
  }

  response.writeHead(200, { 'content-type': 'application/json; charset=utf-8' })
  response.end(
    JSON.stringify({
      service: 'social-sena-game-server',
      status: 'running',
      sockets: io.engine.clientsCount,
    }),
  )
})

const io = new Server(httpServer, {
  cors: {
    origin(origin, callback) {
      callback(null, isOriginAllowed(origin))
    },
  },
})

const sessions = new Map<string, SessionState>()
const rooms = new Map<string, RoomState>()
let lastSimulationTick = Date.now()

function getOrCreateRoom(roomId: string, templateId: string): RoomState | null {
  const existingRoom = rooms.get(roomId)
  if (existingRoom) {
    return existingRoom.templateId === templateId ? existingRoom : null
  }

  const template = getRoomTemplateById(templateId)
  if (!template) {
    return null
  }

  const room: RoomState = {
    roomId,
    templateId: template.id,
    name: template.name,
    maxUsers: DEFAULT_ROOM_CAPACITY,
    template,
    players: [],
  }

  rooms.set(roomId, room)
  return room
}

function buildPresence(profile: UserProfile, sessionId: string, room: RoomState): Presence {
  return {
    userId: profile.userId,
    displayName: profile.displayName,
    sessionId,
    roomId: room.roomId,
    position: { ...room.template.world.spawn },
    direction: 'down',
    moving: false,
    skinId: profile.skinId,
    animation: 'idle-down',
    destination: null,
    route: null,
  }
}

function clonePosition(position: Position): Position {
  return { x: position.x, y: position.y }
}

function clampPositionToRoom(room: RoomState, position: Position): Position {
  return {
    x: Math.min(Math.max(position.x, 32), room.template.world.width - 32),
    y: Math.min(Math.max(position.y, 48), room.template.world.height - 32),
  }
}

function resolveDirection(from: Position, to: Position): Direction {
  const deltaX = to.x - from.x
  const deltaY = to.y - from.y

  if (Math.abs(deltaX) > Math.abs(deltaY)) {
    return deltaX >= 0 ? 'right' : 'left'
  }

  return deltaY >= 0 ? 'down' : 'up'
}

function updateRoute(room: RoomState, player: Presence, target: Position) {
  const start = clonePosition(player.position)
  const destination = clampPositionToRoom(room, target)

  player.destination = destination
  player.route = {
    start,
    target: destination,
    waypoints: [start, destination],
  }
  player.direction = resolveDirection(start, destination)
  player.animation = `walk-${player.direction}`
  player.moving = true
}

function stopPlayer(player: Presence) {
  player.moving = false
  player.destination = null
  player.route = null
  player.animation = `idle-${player.direction}`
}

function simulateMovement(deltaSeconds: number) {
  rooms.forEach((room) => {
    room.players.forEach((player) => {
      if (!player.destination) {
        return
      }

      const deltaX = player.destination.x - player.position.x
      const deltaY = player.destination.y - player.position.y
      const distance = Math.hypot(deltaX, deltaY)

      if (distance <= PLAYER_REACH_THRESHOLD) {
        player.position = clonePosition(player.destination)
        stopPlayer(player)
        io.to(room.roomId).emit(serverEvents.playerMoved, player)
        return
      }

      const step = PLAYER_SPEED * deltaSeconds
      const factor = Math.min(step / distance, 1)
      player.position = clampPositionToRoom(room, {
        x: player.position.x + deltaX * factor,
        y: player.position.y + deltaY * factor,
      })
      player.direction = resolveDirection(player.position, player.destination)
      player.animation = `walk-${player.direction}`
      player.moving = true
      io.to(room.roomId).emit(serverEvents.playerMoved, player)
    })
  })
}

setInterval(() => {
  const now = Date.now()
  const deltaSeconds = Math.min((now - lastSimulationTick) / 1000, 0.05)
  lastSimulationTick = now
  simulateMovement(deltaSeconds)
}, 1000 / 20)

io.on('connection', (socket) => {
  socket.on(clientEvents.connectToGame, (rawPayload) => {
    const parsed = connectToGameSchema.safeParse(rawPayload)

    if (!parsed.success) {
      socket.emit(serverEvents.serverError, {
        code: 'INVALID_CONNECT_PAYLOAD',
        message: 'La conexion inicial no es valida.',
      })
      return
    }

    const session: SessionState = {
      sessionId: socket.id,
      profile: parsed.data.profile,
      roomId: null,
    }

    sessions.set(socket.id, session)

    socket.emit(serverEvents.connectionAccepted, {
      sessionId: socket.id,
      profile: parsed.data.profile,
    })
  })

  socket.on(clientEvents.joinRoom, (rawPayload) => {
    const session = sessions.get(socket.id)
    const parsed = joinRoomSchema.safeParse(rawPayload)

    if (!session || !parsed.success) {
      socket.emit(serverEvents.serverError, {
        code: 'JOIN_ROOM_FAILED',
        message: 'No fue posible unir al jugador a la sala.',
      })
      return
    }

    const room = getOrCreateRoom(parsed.data.roomId, parsed.data.templateId)
    if (!room) {
      socket.emit(serverEvents.serverError, {
        code: 'ROOM_TEMPLATE_INVALID',
        message: 'La plantilla de la sala no existe o no coincide con la ruta solicitada.',
      })
      return
    }

    if (room.players.length >= room.maxUsers) {
      socket.emit(serverEvents.serverError, {
        code: 'ROOM_FULL',
        message: 'La sala esta llena.',
      })
      return
    }

    socket.join(room.roomId)
    session.roomId = room.roomId

    const presence = buildPresence(session.profile, socket.id, room)
    room.players.push(presence)

    socket.emit(serverEvents.roomJoined, {
      roomId: room.roomId,
      player: presence,
    })
    socket.emit(serverEvents.roomState, room)
    socket.to(room.roomId).emit(serverEvents.playerJoined, presence)
  })

  socket.on(clientEvents.navigateTo, (rawPayload) => {
    const parsed = navigateToSchema.safeParse(rawPayload)
    const session = sessions.get(socket.id)

    if (!parsed.success || !session?.roomId) {
      return
    }

    const room = rooms.get(session.roomId)
    const player = room?.players.find((presence) => presence.sessionId === socket.id)

    if (!room || !player || parsed.data.roomId !== room.roomId) {
      return
    }

    updateRoute(room, player, parsed.data.target)
    io.to(room.roomId).emit(serverEvents.playerMoved, player)
  })

  socket.on(clientEvents.sendChatMessage, (rawPayload) => {
    const parsed = sendChatMessageSchema.safeParse(rawPayload)
    const session = sessions.get(socket.id)

    if (!parsed.success || !session?.roomId) {
      return
    }

    const message: ChatMessage = {
      messageId: randomUUID(),
      roomId: session.roomId,
      userId: session.profile.userId,
      displayName: session.profile.displayName,
      content: parsed.data.content,
      timestamp: new Date().toISOString(),
    }

    io.to(session.roomId).emit(serverEvents.chatMessage, message)
  })

  socket.on('disconnect', () => {
    const session = sessions.get(socket.id)
    if (!session?.roomId) {
      sessions.delete(socket.id)
      return
    }

    const room = rooms.get(session.roomId)
    if (room) {
      room.players = room.players.filter((presence) => presence.sessionId !== socket.id)
      socket.to(session.roomId).emit(serverEvents.playerLeft, {
        sessionId: socket.id,
        userId: session.profile.userId,
      })
    }

    sessions.delete(socket.id)
  })
})

httpServer.listen(port, '0.0.0.0', () => {
  console.log(`Social Sena game server listening on port ${port}`)
})
