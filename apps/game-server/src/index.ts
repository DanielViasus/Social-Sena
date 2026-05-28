import { randomUUID } from 'node:crypto'
import { createServer } from 'node:http'
import { Server } from 'socket.io'
import { initializeDatabase } from './db/client'
import { gameRepository } from './db/repositories/gameRepository'
import {
  DEFAULT_ROOM_CAPACITY,
  PLAYER_REACH_THRESHOLD,
  PLAYER_SPEED,
  addFriendSchema,
  clientEvents,
  completeOnboardingSchema,
  connectToGameSchema,
  getRoomTemplateById,
  joinRoomSchema,
  movementInputSchema,
  navigateToSchema,
  updateSkinSchema,
  updateInventorySchema,
  setTypingStateSchema,
  stopNavigationSchema,
  sendChatMessageSchema,
  serverEvents,
  type ChatMessage,
  type ConnectionAcceptedPayload,
  type Direction,
  type FriendSummary,
  type PlayerInventory,
  type PlayerProgress,
  type Position,
  type Presence,
  type RoomState,
  type UserProfile,
} from '@social-sena/shared'

interface SessionState {
  sessionId: string
  profile: UserProfile
  progress: PlayerProgress
  inventory: PlayerInventory
  roomId: string | null
  movementInput: {
    up: boolean
    down: boolean
    left: boolean
    right: boolean
  }
  keyboardControlling: boolean
}

interface RectBounds {
  left: number
  right: number
  top: number
  bottom: number
}

const port = Number(process.env.PORT ?? 3001)
const allowedOriginPatterns = (process.env.CORS_ALLOWED_ORIGINS ?? 'http://localhost:5173')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean)

const PLAYER_COLLIDER_WIDTH = 68
const PLAYER_COLLIDER_HEIGHT = 24
const ROUTE_SAMPLE_STEP = 8
const PATH_GRID_SIZE = 32
const PATH_SEARCH_MAX_RADIUS = 6
const PATH_START_SEARCH_MAX_RADIUS = 4
const PATH_TARGET_SEARCH_MAX_RADIUS = 10
const PATH_COLLIDER_MARGIN = 2

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

function hasMovementInput(input: SessionState['movementInput']) {
  return input.up || input.down || input.left || input.right
}

function sessionsHasUser(userId: string) {
  return Array.from(sessions.values()).some((session) => session.profile.userId === userId)
}

async function buildFriendSummariesForUser(userId: string): Promise<FriendSummary[]> {
  const persistedFriends = await gameRepository.getFriends(userId)
  const onlineUserIds = new Set(Array.from(sessions.values()).map((session) => session.profile.userId))

  return persistedFriends.map((friend) => ({
    ...friend,
    isOnline: onlineUserIds.has(friend.userId),
  }))
}

async function emitSocialStateToSocket(socketId: string) {
  const session = sessions.get(socketId)
  if (!session) {
    return
  }

  const friends = await buildFriendSummariesForUser(session.profile.userId)
  io.to(socketId).emit(serverEvents.socialState, { friends })
}

async function refreshSocialStateForAllSessions() {
  await Promise.all(Array.from(sessions.keys()).map((socketId) => emitSocialStateToSocket(socketId)))
}

function getOrCreateRoom(roomId: string, templateId: string): RoomState | null {
  const existingRoom = rooms.get(roomId)
  if (existingRoom) {
    if (existingRoom.templateId !== templateId) {
      return null
    }

    const latestTemplate = getRoomTemplateById(templateId)
    if (!latestTemplate) {
      return null
    }

    existingRoom.template = latestTemplate
    existingRoom.name = latestTemplate.name
    return existingRoom
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

function buildPresence(
  profile: UserProfile,
  sessionId: string,
  room: RoomState,
  spawnPosition: Position = room.template.world.spawn,
): Presence {
  return {
    userId: profile.userId,
    displayName: profile.displayName,
    sessionId,
    roomId: room.roomId,
    position: { ...spawnPosition },
    direction: 'down',
    moving: false,
    skinId: profile.skinId,
    skinColors: { ...(profile.skinColors ?? {}) },
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
    x: Math.min(Math.max(position.x, PLAYER_COLLIDER_WIDTH / 2), room.template.world.width - PLAYER_COLLIDER_WIDTH / 2),
    y: Math.min(Math.max(position.y, PLAYER_COLLIDER_HEIGHT), room.template.world.height - 20),
  }
}

function getPlayerColliderBounds(position: Position): RectBounds {
  return {
    left: position.x - PLAYER_COLLIDER_WIDTH / 2,
    right: position.x + PLAYER_COLLIDER_WIDTH / 2,
    top: position.y - PLAYER_COLLIDER_HEIGHT,
    bottom: position.y,
  }
}

function getObjectColliderBoundsList(roomObject: RoomState['template']['objects'][number]): RectBounds[] {
  const colliders = roomObject.colliders?.length
    ? roomObject.colliders.slice(0, 4)
    : roomObject.collider
      ? [roomObject.collider]
      : []

  return colliders
    .filter((collider) => collider.width > 0 && collider.height > 0)
    .map((collider) => ({
      left: roomObject.x + collider.offsetX - collider.width / 2,
      right: roomObject.x + collider.offsetX + collider.width / 2,
      top: roomObject.y + collider.offsetY - collider.height / 2,
      bottom: roomObject.y + collider.offsetY + collider.height / 2,
    }))
}

function getObjectNavigationBoundsList(roomObject: RoomState['template']['objects'][number]): RectBounds[] {
  return getObjectColliderBoundsList(roomObject).map((bounds) => ({
    left: bounds.left - PATH_COLLIDER_MARGIN,
    right: bounds.right + PATH_COLLIDER_MARGIN,
    top: bounds.top - PATH_COLLIDER_MARGIN,
    bottom: bounds.bottom + PATH_COLLIDER_MARGIN,
  }))
}

function getNpcColliderBoundsList(roomNpc: NonNullable<RoomState['template']['npcs']>[number]): RectBounds[] {
  if (!roomNpc.collider || roomNpc.collider.width <= 0 || roomNpc.collider.height <= 0) {
    return []
  }

  return [
    {
      left: roomNpc.x + roomNpc.collider.offsetX - roomNpc.collider.width / 2,
      right: roomNpc.x + roomNpc.collider.offsetX + roomNpc.collider.width / 2,
      top: roomNpc.y + roomNpc.collider.offsetY - roomNpc.collider.height / 2,
      bottom: roomNpc.y + roomNpc.collider.offsetY + roomNpc.collider.height / 2,
    },
  ]
}

function getNpcNavigationBoundsList(roomNpc: NonNullable<RoomState['template']['npcs']>[number]): RectBounds[] {
  return getNpcColliderBoundsList(roomNpc).map((bounds) => ({
    left: bounds.left - PATH_COLLIDER_MARGIN,
    right: bounds.right + PATH_COLLIDER_MARGIN,
    top: bounds.top - PATH_COLLIDER_MARGIN,
    bottom: bounds.bottom + PATH_COLLIDER_MARGIN,
  }))
}

function overlapsRect(a: RectBounds, b: RectBounds) {
  return !(a.right <= b.left || a.left >= b.right || a.bottom <= b.top || a.top >= b.bottom)
}

function isBlockedByRoomObjects(room: RoomState, position: Position) {
  const playerBounds = getPlayerColliderBounds(position)
  return (
    room.template.objects.some((roomObject) => getObjectNavigationBoundsList(roomObject).some((bounds) => overlapsRect(playerBounds, bounds))) ||
    (room.template.npcs ?? []).some((roomNpc) => getNpcNavigationBoundsList(roomNpc).some((bounds) => overlapsRect(playerBounds, bounds)))
  )
}

function expandBoundsForPlayer(bounds: RectBounds): RectBounds {
  return {
    left: bounds.left - PLAYER_COLLIDER_WIDTH / 2,
    right: bounds.right + PLAYER_COLLIDER_WIDTH / 2,
    top: bounds.top,
    bottom: bounds.bottom + PLAYER_COLLIDER_HEIGHT,
  }
}

function segmentIntersectsExpandedBounds(from: Position, to: Position, bounds: RectBounds) {
  const expanded = expandBoundsForPlayer(bounds)

  if (
    from.x >= expanded.left &&
    from.x <= expanded.right &&
    from.y >= expanded.top &&
    from.y <= expanded.bottom
  ) {
    return true
  }

  if (
    to.x >= expanded.left &&
    to.x <= expanded.right &&
    to.y >= expanded.top &&
    to.y <= expanded.bottom
  ) {
    return true
  }

  const deltaX = to.x - from.x
  const deltaY = to.y - from.y
  let entry = 0
  let exit = 1

  const updateInterval = (p: number, q: number) => {
    if (Math.abs(p) < 0.000001) {
      return q >= 0
    }

    const ratio = q / p

    if (p < 0) {
      if (ratio > exit) {
        return false
      }
      if (ratio > entry) {
        entry = ratio
      }
      return true
    }

    if (ratio < entry) {
      return false
    }
    if (ratio < exit) {
      exit = ratio
    }
    return true
  }

  if (!updateInterval(-deltaX, from.x - expanded.left)) {
    return false
  }
  if (!updateInterval(deltaX, expanded.right - from.x)) {
    return false
  }
  if (!updateInterval(-deltaY, from.y - expanded.top)) {
    return false
  }
  if (!updateInterval(deltaY, expanded.bottom - from.y)) {
    return false
  }

  return entry <= exit && exit >= 0 && entry <= 1
}

function isRouteSegmentBlocked(room: RoomState, from: Position, to: Position) {
  if (
    room.template.objects.some((roomObject) => getObjectNavigationBoundsList(roomObject).some((bounds) => segmentIntersectsExpandedBounds(from, to, bounds))) ||
    (room.template.npcs ?? []).some((roomNpc) => getNpcNavigationBoundsList(roomNpc).some((bounds) => segmentIntersectsExpandedBounds(from, to, bounds)))
  ) {
    return true
  }

  const deltaX = to.x - from.x
  const deltaY = to.y - from.y
  const distance = Math.hypot(deltaX, deltaY)

  if (distance <= 0.001) {
    return isBlockedByRoomObjects(room, to)
  }

  const totalSamples = Math.max(1, Math.ceil(distance / ROUTE_SAMPLE_STEP))

  for (let sampleIndex = 1; sampleIndex <= totalSamples; sampleIndex += 1) {
    const factor = sampleIndex / totalSamples
    const samplePosition = clampPositionToRoom(room, {
      x: from.x + deltaX * factor,
      y: from.y + deltaY * factor,
    })

    if (isBlockedByRoomObjects(room, samplePosition)) {
      return true
    }
  }

  return false
}


function isSamePosition(a: Position, b: Position) {
  return Math.abs(a.x - b.x) < 0.001 && Math.abs(a.y - b.y) < 0.001
}

function isPointNavigable(room: RoomState, position: Position) {
  const clamped = clampPositionToRoom(room, position)
  return isSamePosition(clamped, position) && !isBlockedByRoomObjects(room, position)
}

interface GridCell {
  column: number
  row: number
}

interface PathResult {
  resolvedTarget: Position
  waypoints: Position[]
}

function createCellKey(cell: GridCell) {
  return `${cell.column}:${cell.row}`
}

function getCellCenter(room: RoomState, cell: GridCell): Position {
  return clampPositionToRoom(room, {
    x: cell.column * PATH_GRID_SIZE + PATH_GRID_SIZE / 2,
    y: cell.row * PATH_GRID_SIZE + PATH_GRID_SIZE / 2,
  })
}

function getCellFromPosition(position: Position): GridCell {
  return {
    column: Math.max(0, Math.floor(position.x / PATH_GRID_SIZE)),
    row: Math.max(0, Math.floor(position.y / PATH_GRID_SIZE)),
  }
}

function getGridDimensions(room: RoomState) {
  return {
    columns: Math.max(1, Math.ceil(room.template.world.width / PATH_GRID_SIZE)),
    rows: Math.max(1, Math.ceil(room.template.world.height / PATH_GRID_SIZE)),
  }
}

function buildBlockedCellSet(room: RoomState) {
  const { columns, rows } = getGridDimensions(room)
  const blocked = new Set<string>()

  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const cell = { column, row }
      const center = getCellCenter(room, cell)
      if (!isPointNavigable(room, center)) {
        blocked.add(createCellKey(cell))
      }
    }
  }

  return blocked
}

function findNearestWalkableCell(room: RoomState, position: Position, blocked: Set<string>, maxRadius = PATH_SEARCH_MAX_RADIUS) {
  const { columns, rows } = getGridDimensions(room)
  const origin = getCellFromPosition(position)

  const isWalkable = (cell: GridCell) => {
    if (cell.column < 0 || cell.column >= columns || cell.row < 0 || cell.row >= rows) {
      return false
    }

    return !blocked.has(createCellKey(cell))
  }

  if (isWalkable(origin)) {
    return origin
  }

  for (let radius = 1; radius <= maxRadius; radius += 1) {
    let bestCell: GridCell | null = null
    let bestDistance = Number.POSITIVE_INFINITY

    for (let row = origin.row - radius; row <= origin.row + radius; row += 1) {
      for (let column = origin.column - radius; column <= origin.column + radius; column += 1) {
        const isBorder = row === origin.row - radius || row === origin.row + radius || column === origin.column - radius || column === origin.column + radius
        if (!isBorder) {
          continue
        }

        const candidate = { column, row }
        if (!isWalkable(candidate)) {
          continue
        }

        const center = getCellCenter(room, candidate)
        const distance = Math.hypot(center.x - position.x, center.y - position.y)
        if (distance < bestDistance) {
          bestCell = candidate
          bestDistance = distance
        }
      }
    }

    if (bestCell) {
      return bestCell
    }
  }

  return null
}


function findReachableStartCells(room: RoomState, start: Position, blocked: Set<string>, maxRadius = PATH_START_SEARCH_MAX_RADIUS) {
  const { columns, rows } = getGridDimensions(room)
  const origin = getCellFromPosition(start)
  const candidates: Array<{ cell: GridCell; approachCost: number }> = []
  const seen = new Set<string>()

  for (let radius = 0; radius <= maxRadius; radius += 1) {
    for (let row = origin.row - radius; row <= origin.row + radius; row += 1) {
      for (let column = origin.column - radius; column <= origin.column + radius; column += 1) {
        const isBorder = radius === 0 || row === origin.row - radius || row === origin.row + radius || column === origin.column - radius || column === origin.column + radius
        if (!isBorder) {
          continue
        }

        if (column < 0 || column >= columns || row < 0 || row >= rows) {
          continue
        }

        const cell = { column, row }
        const key = createCellKey(cell)
        if (seen.has(key) || blocked.has(key)) {
          continue
        }

        const center = getCellCenter(room, cell)
        if (isRouteSegmentBlocked(room, start, center)) {
          continue
        }

        seen.add(key)
        candidates.push({
          cell,
          approachCost: Math.hypot(center.x - start.x, center.y - start.y),
        })
      }
    }
  }

  return candidates.sort((left, right) => left.approachCost - right.approachCost)
}

function getNeighborCells(room: RoomState, cell: GridCell, blocked: Set<string>) {
  const { columns, rows } = getGridDimensions(room)
  const neighbors: Array<{ cell: GridCell; cost: number }> = []

  for (let rowOffset = -1; rowOffset <= 1; rowOffset += 1) {
    for (let columnOffset = -1; columnOffset <= 1; columnOffset += 1) {
      if (rowOffset === 0 && columnOffset === 0) {
        continue
      }

      const nextCell = {
        column: cell.column + columnOffset,
        row: cell.row + rowOffset,
      }

      if (nextCell.column < 0 || nextCell.column >= columns || nextCell.row < 0 || nextCell.row >= rows) {
        continue
      }

      if (blocked.has(createCellKey(nextCell))) {
        continue
      }

      if (rowOffset !== 0 && columnOffset !== 0) {
        const sideA = { column: cell.column + columnOffset, row: cell.row }
        const sideB = { column: cell.column, row: cell.row + rowOffset }
        if (blocked.has(createCellKey(sideA)) || blocked.has(createCellKey(sideB))) {
          continue
        }
      }

      neighbors.push({
        cell: nextCell,
        cost: rowOffset !== 0 && columnOffset !== 0 ? Math.SQRT2 : 1,
      })
    }
  }

  return neighbors
}

function estimateCellDistance(a: GridCell, b: GridCell) {
  const deltaColumn = Math.abs(a.column - b.column)
  const deltaRow = Math.abs(a.row - b.row)
  const diagonal = Math.min(deltaColumn, deltaRow)
  const straight = Math.max(deltaColumn, deltaRow) - diagonal
  return diagonal * Math.SQRT2 + straight
}

function reconstructCellPath(cameFrom: Map<string, string>, endCell: GridCell) {
  const cells = [endCell]
  let currentKey = createCellKey(endCell)

  while (cameFrom.has(currentKey)) {
    const parentKey = cameFrom.get(currentKey)
    if (!parentKey) {
      break
    }

    const [column, row] = parentKey.split(':').map(Number)
    cells.push({ column, row })
    currentKey = parentKey
  }

  return cells.reverse()
}

function findPathBetweenCells(
  room: RoomState,
  blocked: Set<string>,
  start: Position,
  startCell: GridCell,
  targetCell: GridCell,
  destination: Position,
) {
  const startKey = createCellKey(startCell)
  const targetKey = createCellKey(targetCell)
  const openSet = new Set([startKey])
  const cameFrom = new Map<string, string>()
  const gScore = new Map<string, number>([[startKey, 0]])
  const fScore = new Map<string, number>([[startKey, estimateCellDistance(startCell, targetCell)]])

  while (openSet.size > 0) {
    let currentKey: string | null = null
    let currentScore = Number.POSITIVE_INFINITY

    for (const candidateKey of openSet) {
      const score = fScore.get(candidateKey) ?? Number.POSITIVE_INFINITY
      if (score < currentScore) {
        currentKey = candidateKey
        currentScore = score
      }
    }

    if (!currentKey) {
      break
    }

    if (currentKey === targetKey) {
      const cellPath = reconstructCellPath(cameFrom, targetCell)
      const cellCenters = cellPath.map((cell) => getCellCenter(room, cell))
      const roughPoints: Position[] = [start]

      for (const point of cellCenters) {
        const previousPoint = roughPoints[roughPoints.length - 1]
        if (!isSamePosition(previousPoint, point)) {
          roughPoints.push(point)
        }
      }

      const lastPoint = roughPoints[roughPoints.length - 1]
      const finalPoints = isSamePosition(lastPoint, destination) || isRouteSegmentBlocked(room, lastPoint, destination)
        ? roughPoints
        : [...roughPoints, destination]
      const waypoints = finalPoints.slice(1).filter((point, index, array) => index === 0 || !isSamePosition(point, array[index - 1]))
      return waypoints.length > 0 ? waypoints : [destination]
    }

    openSet.delete(currentKey)
    const [currentColumn, currentRow] = currentKey.split(':').map(Number)
    const currentCell = { column: currentColumn, row: currentRow }
    const currentG = gScore.get(currentKey) ?? Number.POSITIVE_INFINITY

    for (const neighbor of getNeighborCells(room, currentCell, blocked)) {
      const neighborKey = createCellKey(neighbor.cell)
      const tentativeG = currentG + neighbor.cost

      if (tentativeG >= (gScore.get(neighborKey) ?? Number.POSITIVE_INFINITY)) {
        continue
      }

      cameFrom.set(neighborKey, currentKey)
      gScore.set(neighborKey, tentativeG)
      fScore.set(neighborKey, tentativeG + estimateCellDistance(neighbor.cell, targetCell))
      openSet.add(neighborKey)
    }
  }

  return null
}

function findPath(room: RoomState, start: Position, destination: Position): PathResult | null {
  const blocked = buildBlockedCellSet(room)
  const destinationIsNavigable = isPointNavigable(room, destination)
  const targetCell = findNearestWalkableCell(room, destination, blocked, PATH_TARGET_SEARCH_MAX_RADIUS)

  if (!targetCell) {
    return null
  }

  const cellTargetCenter = getCellCenter(room, targetCell)
  const resolvedTarget = destinationIsNavigable && !isRouteSegmentBlocked(room, cellTargetCenter, destination)
    ? destination
    : cellTargetCenter

  if (!isRouteSegmentBlocked(room, start, resolvedTarget)) {
    return {
      resolvedTarget,
      waypoints: [resolvedTarget],
    }
  }

  const candidateStartCells = findReachableStartCells(room, start, blocked)
  if (candidateStartCells.length === 0) {
    return null
  }

  const rankedStartCells = candidateStartCells.sort((left, right) => {
    const leftScore = left.approachCost + estimateCellDistance(left.cell, targetCell)
    const rightScore = right.approachCost + estimateCellDistance(right.cell, targetCell)
    return leftScore - rightScore
  })

  for (const candidate of rankedStartCells) {
    const path = findPathBetweenCells(room, blocked, start, candidate.cell, targetCell, resolvedTarget)
    if (path && path.length > 0) {
      return {
        resolvedTarget,
        waypoints: path,
      }
    }
  }

  return null
}


function ensureNavigablePlayerPosition(room: RoomState, player: Presence) {
  if (!isBlockedByRoomObjects(room, player.position)) {
    return true
  }

  const blocked = buildBlockedCellSet(room)
  const safeCell = findNearestWalkableCell(room, player.position, blocked, PATH_SEARCH_MAX_RADIUS * 2)
  if (!safeCell) {
    return false
  }

  player.position = getCellCenter(room, safeCell)
  return true
}

function setPlayerDestination(player: Presence, destination: Position) {
  player.destination = destination
  player.direction = resolveDirection(player.position, destination)
  player.animation = `walk-${player.direction}`
  player.moving = true
}

function advancePlayerRoute(player: Presence) {
  if (!player.route || player.route.waypoints.length === 0) {
    stopPlayer(player)
    return false
  }

  player.route.waypoints.shift()

  if (player.route.waypoints.length === 0) {
    stopPlayer(player)
    return false
  }

  setPlayerDestination(player, player.route.waypoints[0])
  return true
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
  if (!ensureNavigablePlayerPosition(room, player)) {
    stopPlayer(player)
    return false
  }

  const start = clonePosition(player.position)
  const desiredTarget = clampPositionToRoom(room, target)
  const path = findPath(room, start, desiredTarget)

  if (!path || path.waypoints.length === 0) {
    stopPlayer(player)
    return false
  }

  player.route = {
    start,
    target: path.resolvedTarget,
    waypoints: path.waypoints,
  }
  setPlayerDestination(player, path.waypoints[0])
  return true
}

function stopPlayer(player: Presence) {
  player.moving = false
  player.destination = null
  player.route = null
  player.animation = `idle-${player.direction}`
}

function movePlayerWithKeyboard(room: RoomState, player: Presence, session: SessionState, deltaSeconds: number) {
  if (!ensureNavigablePlayerPosition(room, player)) {
    stopPlayer(player)
    return
  }

  const horizontal = (session.movementInput.right ? 1 : 0) - (session.movementInput.left ? 1 : 0)
  const vertical = (session.movementInput.down ? 1 : 0) - (session.movementInput.up ? 1 : 0)

  if (horizontal === 0 && vertical === 0) {
    stopPlayer(player)
    return
  }

  stopPlayer(player)

  const magnitude = Math.hypot(horizontal, vertical)
  const normalizedX = horizontal / magnitude
  const normalizedY = vertical / magnitude
  const step = PLAYER_SPEED * deltaSeconds

  const combinedPosition = clampPositionToRoom(room, {
    x: player.position.x + normalizedX * step,
    y: player.position.y + normalizedY * step,
  })

  const xOnlyPosition = clampPositionToRoom(room, {
    x: player.position.x + normalizedX * step,
    y: player.position.y,
  })

  const yOnlyPosition = clampPositionToRoom(room, {
    x: player.position.x,
    y: player.position.y + normalizedY * step,
  })

  let nextPosition = player.position

  if (!isBlockedByRoomObjects(room, combinedPosition) && !isRouteSegmentBlocked(room, player.position, combinedPosition)) {
    nextPosition = combinedPosition
  } else if (
    horizontal !== 0 &&
    !isBlockedByRoomObjects(room, xOnlyPosition) &&
    !isRouteSegmentBlocked(room, player.position, xOnlyPosition)
  ) {
    nextPosition = xOnlyPosition
  } else if (
    vertical !== 0 &&
    !isBlockedByRoomObjects(room, yOnlyPosition) &&
    !isRouteSegmentBlocked(room, player.position, yOnlyPosition)
  ) {
    nextPosition = yOnlyPosition
  }

  const targetDirection = resolveDirection(player.position, {
    x: player.position.x + horizontal,
    y: player.position.y + vertical,
  })

  player.direction = targetDirection

  if (isSamePosition(nextPosition, player.position)) {
    player.moving = false
    player.animation = `idle-${player.direction}`
    return
  }

  player.position = nextPosition
  player.moving = true
  player.animation = `walk-${player.direction}`
}

function simulateMovement(deltaSeconds: number) {
  rooms.forEach((room) => {
    room.players.forEach((player) => {
      const session = sessions.get(player.sessionId)

      if (session?.keyboardControlling) {
        movePlayerWithKeyboard(room, player, session, deltaSeconds)
        io.to(room.roomId).emit(serverEvents.playerMoved, player)
        return
      }

      if (!player.destination) {
        return
      }

      const deltaX = player.destination.x - player.position.x
      const deltaY = player.destination.y - player.position.y
      const distance = Math.hypot(deltaX, deltaY)

      if (distance <= PLAYER_REACH_THRESHOLD) {
        player.position = clonePosition(player.destination)

        if (!advancePlayerRoute(player)) {
          io.to(room.roomId).emit(serverEvents.playerMoved, player)
          return
        }

        io.to(room.roomId).emit(serverEvents.playerMoved, player)
        return
      }

      const step = PLAYER_SPEED * deltaSeconds
      const factor = Math.min(step / distance, 1)
      const nextPosition = clampPositionToRoom(room, {
        x: player.position.x + deltaX * factor,
        y: player.position.y + deltaY * factor,
      })

      if (isBlockedByRoomObjects(room, nextPosition) || isRouteSegmentBlocked(room, player.position, nextPosition)) {
        stopPlayer(player)
        io.to(room.roomId).emit(serverEvents.playerMoved, player)
        return
      }

      player.position = nextPosition
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
  socket.on(clientEvents.connectToGame, async (rawPayload) => {
    const parsed = connectToGameSchema.safeParse(rawPayload)

    if (!parsed.success) {
      socket.emit(serverEvents.serverError, {
        code: 'INVALID_CONNECT_PAYLOAD',
        message: 'La conexion inicial no es valida.',
      })
      return
    }

    const resolvedProfileResult = await gameRepository.resolveUserProfile(parsed.data.profile)
    const resolvedProfile = resolvedProfileResult.profile

    const session: SessionState = {
      sessionId: socket.id,
      profile: resolvedProfile,
      progress: resolvedProfileResult.progress,
      inventory: resolvedProfileResult.inventory,
      roomId: null,
      movementInput: {
        up: false,
        down: false,
        left: false,
        right: false,
      },
      keyboardControlling: false,
    }

    sessions.set(socket.id, session)

    const connectionAcceptedPayload: ConnectionAcceptedPayload = {
      sessionId: socket.id,
      profile: resolvedProfile,
      needsOnboarding: resolvedProfileResult.needsOnboarding,
      progress: resolvedProfileResult.progress,
      inventory: resolvedProfileResult.inventory,
      friends: resolvedProfileResult.friends.map((friend) => ({
        ...friend,
        isOnline: sessionsHasUser(friend.userId),
      })),
    }

    socket.emit(serverEvents.connectionAccepted, connectionAcceptedPayload)
    void refreshSocialStateForAllSessions()
  })

  socket.on(clientEvents.completeOnboarding, async (rawPayload, callback) => {
    const parsed = completeOnboardingSchema.safeParse(rawPayload)
    const session = sessions.get(socket.id)

    if (!parsed.success || !session) {
      callback?.({
        ok: false,
        message: 'No fue posible completar el registro inicial.',
      })
      return
    }

    session.profile.skinId = parsed.data.skinId
    session.profile.skinColors = { ...(parsed.data.skinColors ?? {}) }
    await gameRepository.completeOnboarding(session.profile)
    session.progress = await gameRepository.getPlayerProgress(session.profile.userId)
    session.inventory = await gameRepository.getPlayerInventory(session.profile.userId)

    callback?.({
      ok: true,
      profile: session.profile,
      progress: session.progress,
      inventory: session.inventory,
    })

    void emitSocialStateToSocket(socket.id)
  })

  socket.on(clientEvents.joinRoom, async (rawPayload) => {
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

    const persistedState = await gameRepository.getPlayerState(session.profile.userId)
    const preferredSpawnPosition =
      persistedState?.roomId === room.roomId && persistedState.position
        ? clampPositionToRoom(room, persistedState.position)
        : room.template.world.spawn

    const presence = buildPresence(session.profile, socket.id, room, preferredSpawnPosition)
    ensureNavigablePlayerPosition(room, presence)
    room.players.push(presence)
    void gameRepository.savePlayerState(session.profile.userId, {
      roomId: room.roomId,
      position: clonePosition(presence.position),
    })

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

  socket.on(clientEvents.stopNavigation, (rawPayload) => {
    const parsed = stopNavigationSchema.safeParse(rawPayload)
    const session = sessions.get(socket.id)

    if (!parsed.success || !session?.roomId) {
      return
    }

    const room = rooms.get(session.roomId)
    const player = room?.players.find((presence) => presence.sessionId === socket.id)

    if (!room || !player || parsed.data.roomId !== room.roomId) {
      return
    }

    stopPlayer(player)
    io.to(room.roomId).emit(serverEvents.playerMoved, player)
  })

  socket.on(clientEvents.setMovementInput, (rawPayload) => {
    const parsed = movementInputSchema.safeParse(rawPayload)
    const session = sessions.get(socket.id)

    if (!parsed.success || !session?.roomId || parsed.data.roomId !== session.roomId) {
      return
    }

    const room = rooms.get(session.roomId)
    const player = room?.players.find((presence) => presence.sessionId === socket.id)

    if (!room || !player) {
      return
    }

    const nextInput = {
      up: parsed.data.up,
      down: parsed.data.down,
      left: parsed.data.left,
      right: parsed.data.right,
    }

    const wasKeyboardControlling = session.keyboardControlling
    session.movementInput = nextInput
    session.keyboardControlling = hasMovementInput(nextInput)

    if (session.keyboardControlling) {
      stopPlayer(player)
      io.to(room.roomId).emit(serverEvents.playerMoved, player)
      return
    }

    if (wasKeyboardControlling) {
      stopPlayer(player)
      io.to(room.roomId).emit(serverEvents.playerMoved, player)
    }
  })

  socket.on(clientEvents.updateSkin, (rawPayload) => {
    const parsed = updateSkinSchema.safeParse(rawPayload)
    const session = sessions.get(socket.id)

    if (!parsed.success || !session?.roomId) {
      return
    }

    const room = rooms.get(session.roomId)
    const player = room?.players.find((presence) => presence.sessionId === socket.id)

    if (!room || !player || parsed.data.roomId !== room.roomId) {
      return
    }

    session.profile.skinId = parsed.data.skinId
    session.profile.skinColors = { ...(parsed.data.skinColors ?? {}) }
    player.skinId = parsed.data.skinId
    player.skinColors = { ...(parsed.data.skinColors ?? {}) }
    void gameRepository.savePlayerProfile(session.profile)
    io.to(room.roomId).emit(serverEvents.playerMoved, player)
    io.to(room.roomId).emit(serverEvents.roomState, room)
  })

  socket.on(clientEvents.updateInventory, (rawPayload, callback) => {
    const parsed = updateInventorySchema.safeParse(rawPayload)
    const session = sessions.get(socket.id)

    if (!parsed.success || !session) {
      callback?.({
        ok: false,
        message: 'No fue posible actualizar el inventario.',
      })
      return
    }

    session.inventory = { ...parsed.data.inventory }
    void gameRepository.savePlayerInventory(session.profile.userId, session.inventory)

    callback?.({
      ok: true,
      inventory: session.inventory,
    })
  })

  socket.on(clientEvents.requestSocialState, () => {
    void emitSocialStateToSocket(socket.id)
  })

  socket.on(clientEvents.addFriend, async (rawPayload, callback) => {
    const parsed = addFriendSchema.safeParse(rawPayload)
    const session = sessions.get(socket.id)

    if (!parsed.success || !session) {
      callback?.({
        ok: false,
        message: 'No fue posible registrar la amistad.',
      })
      return
    }

    const result = await gameRepository.addFriend(session.profile.userId, parsed.data.friendUserId)

    if (!result.ok) {
      callback?.(result)
      return
    }

    const friends = await buildFriendSummariesForUser(session.profile.userId)
    socket.emit(serverEvents.socialState, { friends })
    await refreshSocialStateForAllSessions()

    callback?.({
      ok: true,
      friends,
    })
  })

  socket.on(clientEvents.sendChatMessage, (rawPayload) => {
    const parsed = sendChatMessageSchema.safeParse(rawPayload)
    const session = sessions.get(socket.id)

    if (!parsed.success || !session?.roomId) {
      return
    }

    io.to(session.roomId).emit(serverEvents.typingStateChanged, {
      roomId: session.roomId,
      userId: session.profile.userId,
      isTyping: false,
    })

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

  socket.on(clientEvents.setTypingState, (rawPayload) => {
    const parsed = setTypingStateSchema.safeParse(rawPayload)
    const session = sessions.get(socket.id)

    if (!parsed.success || !session?.roomId) {
      return
    }

    if (parsed.data.roomId !== session.roomId) {
      return
    }

    io.to(session.roomId).emit(serverEvents.typingStateChanged, {
      roomId: session.roomId,
      userId: session.profile.userId,
      isTyping: parsed.data.isTyping,
    })
  })

  socket.on('disconnect', () => {
    const session = sessions.get(socket.id)
    if (!session) {
      return
    }

    if (session.roomId) {
      const room = rooms.get(session.roomId)
      if (room) {
        const departingPlayer = room.players.find((presence) => presence.sessionId === socket.id)
        if (departingPlayer) {
          void gameRepository.savePlayerState(session.profile.userId, {
            roomId: room.roomId,
            position: clonePosition(departingPlayer.position),
          })
        }

        room.players = room.players.filter((presence) => presence.sessionId !== socket.id)
        io.to(room.roomId).emit(serverEvents.typingStateChanged, {
          roomId: room.roomId,
          userId: session.profile.userId,
          isTyping: false,
        })
        socket.to(room.roomId).emit(serverEvents.playerLeft, { sessionId: socket.id, userId: session.profile.userId })

        if (room.players.length === 0) {
          rooms.delete(room.roomId)
        }
      }
    }

    sessions.delete(socket.id)
    void refreshSocialStateForAllSessions()
  })
})

void initializeDatabase().finally(() => {
  httpServer.listen(port, '0.0.0.0', () => {
    console.log(`Social Sena game server listening on port ${port}`)
  })
})
