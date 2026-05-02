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
  type RoomObjectTemplate,
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
const PLAYER_FOOT_WIDTH = 30
const PLAYER_FOOT_HEIGHT = 14

interface RectBounds {
  left: number
  right: number
  top: number
  bottom: number
}

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
  const halfFootWidth = PLAYER_FOOT_WIDTH / 2
  return {
    x: Math.min(Math.max(position.x, halfFootWidth + 16), room.template.world.width - halfFootWidth - 16),
    y: Math.min(Math.max(position.y, PLAYER_FOOT_HEIGHT + 16), room.template.world.height - 20),
  }
}

function getObjectColliderBounds(objectTemplate: RoomObjectTemplate): RectBounds {
  const collider = objectTemplate.collider ?? {
    offsetX: 0,
    offsetY: 0,
    width: objectTemplate.width,
    height: objectTemplate.height,
  }

  const centerX = objectTemplate.x + collider.offsetX
  const centerY = objectTemplate.y + collider.offsetY

  return {
    left: centerX - collider.width / 2,
    right: centerX + collider.width / 2,
    top: centerY - collider.height / 2,
    bottom: centerY + collider.height / 2,
  }
}

function getPlayerFootBounds(position: Position): RectBounds {
  return {
    left: position.x - PLAYER_FOOT_WIDTH / 2,
    right: position.x + PLAYER_FOOT_WIDTH / 2,
    top: position.y - PLAYER_FOOT_HEIGHT,
    bottom: position.y,
  }
}

function overlapsRect(a: RectBounds, b: RectBounds) {
  return !(a.right <= b.left || a.left >= b.right || a.bottom <= b.top || a.top >= b.bottom)
}

function isBlockedByRoomObjects(room: RoomState, position: Position) {
  const playerFootBounds = getPlayerFootBounds(position)

  return room.template.objects.some((objectTemplate) => {
    if (!objectTemplate.blocksMovement) {
      return false
    }

    return overlapsRect(playerFootBounds, getObjectColliderBounds(objectTemplate))
  })
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

  if (isBlockedByRoomObjects(room, destination)) {
    stopPlayer(player)
    return false
  }

  player.destination = destination
  player.route = {
    start,
    target: destination,
    waypoints: [start, destination],
  }
  player.direction = resolveDirection(start, destination)
  player.animation = `walk-${player.direction}`
  player.moving = true
  return true
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
      const nextPosition = clampPositionToRoom(room, {
        x: player.position.x + deltaX * factor,
        y: player.position.y + deltaY * factor,
      })

      if (isBlockedByRoomObjects(room, nextPosition)) {
        stopPlayer(player)
        io.to(room.roomId).emit(serverEvents.playerMoved, player)
        return
      }

      player.position = nextPosition
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

    const routeAccepted = updateRoute(room, player, parsed.data.target)
    if (routeAccepted) {
      io.to(room.roomId).emit(serverEvents.playerMoved, player)
    }
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
