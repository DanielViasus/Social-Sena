import { randomUUID } from 'node:crypto'
import { createServer } from 'node:http'
import { Server, type Socket } from 'socket.io'
import { initializeDatabase } from './db/client'
import { gameRepository } from './db/repositories/gameRepository'
import {
  DEFAULT_ROOM_CAPACITY,
  PARTY_LEADER_FOLLOW_TTL_MS,
  PLAYER_REACH_THRESHOLD,
  PLAYER_SPEED,
  addFriendSchema,
  clientEvents,
  completeOnboardingSchema,
  connectToGameSchema,
  getRoomTemplateById,
  inviteToPartySchema,
  joinRoomSchema,
  leavePartySchema,
  movementInputSchema,
  navigateToSchema,
  promotePartyLeaderSchema,
  removeFriendSchema,
  respondPartyLeaderFollowSchema,
  respondPartyInviteSchema,
  respondFriendRequestSchema,
  updateAudioSettingsSchema,
  updateSkinSchema,
  updateInventorySchema,
  type ActivityNoticePayload,
  type PartyInviteSummary,
  type PartyLeaderFollowPromptPayload,
  type PartyOutgoingInviteSummary,
  type PartyStatePayload,
  type PartySummary,
  type RoomTransitionRequestedPayload,
  setTypingStateSchema,
  stopNavigationSchema,
  sendChatMessageSchema,
  serverEvents,
  type ChatMessage,
  type ConnectionAcceptedPayload,
  type Direction,
  type FriendRequestSummary,
  type FriendSummary,
  type PlayerInventory,
  type PlayerProgress,
  type Position,
  type Presence,
  type RoomState,
  type SkinColorSelections,
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

interface PartyPresenceMarker {
  partyId: string | null
  partyLeaderUserId: string | null
  partyLeaderDisplayName: string | null
  partyLeaderSkinId: string | null
  partyLeaderSkinColors: SkinColorSelections | null
}

interface PendingPartyLeaderFollowRequest {
  requestId: string
  partyId: string
  leaderUserId: string
  leaderDisplayName: string
  targetUserId: string
  roomId: string
  roomName: string
  templateId: string
  spawnPosition: Position
  expiresAt: number
  timeoutId: ReturnType<typeof setTimeout>
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
const pendingPartyLeaderFollowRequests = new Map<string, PendingPartyLeaderFollowRequest>()
const pendingPartyLeaderFollowRequestIdsByUser = new Map<string, string>()
let lastSimulationTick = Date.now()
const ROOM_INSTANCE_SEPARATOR = '::'

function getRoomInstanceNumber(roomId: string, templateId: string) {
  if (roomId === templateId) {
    return 1
  }

  const prefix = `${templateId}${ROOM_INSTANCE_SEPARATOR}`
  if (!roomId.startsWith(prefix)) {
    return Number.MAX_SAFE_INTEGER
  }

  const instanceNumber = Number(roomId.slice(prefix.length))
  return Number.isInteger(instanceNumber) && instanceNumber > 0 ? instanceNumber : Number.MAX_SAFE_INTEGER
}

function buildRoomInstanceId(templateId: string, instanceNumber: number) {
  return `${templateId}${ROOM_INSTANCE_SEPARATOR}${instanceNumber}`
}

function getRoomsForTemplate(templateId: string) {
  return Array.from(rooms.values())
    .filter((room) => room.templateId === templateId)
    .sort(
      (leftRoom, rightRoom) =>
        getRoomInstanceNumber(leftRoom.roomId, templateId) -
        getRoomInstanceNumber(rightRoom.roomId, templateId),
    )
}

function getAvailableSlotsForRoom(room: RoomState) {
  return room.maxUsers - room.players.length
}

function createRoomInstance(templateId: string): RoomState | null {
  const nextInstanceNumber =
    getRoomsForTemplate(templateId).reduce(
      (highestInstanceNumber, room) =>
        Math.max(highestInstanceNumber, getRoomInstanceNumber(room.roomId, templateId)),
      0,
    ) + 1

  return getOrCreateRoom(buildRoomInstanceId(templateId, nextInstanceNumber), templateId)
}

function findOrCreateRoomForDirectJoin(templateId: string): RoomState | null {
  const bestExistingRoom =
    getRoomsForTemplate(templateId)
      .filter((room) => getAvailableSlotsForRoom(room) >= 1)
      .sort(
        (leftRoom, rightRoom) =>
          rightRoom.players.length - leftRoom.players.length ||
          getRoomInstanceNumber(leftRoom.roomId, templateId) -
            getRoomInstanceNumber(rightRoom.roomId, templateId),
      )[0] ?? null

  return bestExistingRoom ?? createRoomInstance(templateId)
}

function findOrCreateRoomForPartyPlacement(
  templateId: string,
  requiredPartySize: number,
  excludedRoomIds: string[] = [],
): RoomState | null {
  if (requiredPartySize > DEFAULT_ROOM_CAPACITY) {
    return null
  }

  const normalizedExcludedRoomIds = new Set(excludedRoomIds)
  const candidateRooms = getRoomsForTemplate(templateId).filter(
    (room) =>
      !normalizedExcludedRoomIds.has(room.roomId) && getAvailableSlotsForRoom(room) >= requiredPartySize,
  )

  const emptyRoom = candidateRooms.find((room) => room.players.length === 0)
  if (emptyRoom) {
    return emptyRoom
  }

  const bestExistingRoom =
    candidateRooms.sort(
      (leftRoom, rightRoom) =>
        leftRoom.players.length - rightRoom.players.length ||
        getRoomInstanceNumber(leftRoom.roomId, templateId) -
          getRoomInstanceNumber(rightRoom.roomId, templateId),
    )[0] ?? null

  return bestExistingRoom ?? createRoomInstance(templateId)
}

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

async function buildIncomingFriendRequestsForUser(userId: string): Promise<FriendRequestSummary[]> {
  return gameRepository.getIncomingFriendRequests(userId)
}

async function buildOutgoingFriendRequestUserIdsForUser(userId: string): Promise<string[]> {
  return gameRepository.getOutgoingFriendRequestUserIds(userId)
}

async function emitSocialStateToSocket(socketId: string) {
  const session = sessions.get(socketId)
  if (!session) {
    return
  }

  const [friends, incomingFriendRequests, outgoingFriendRequestUserIds] = await Promise.all([
    buildFriendSummariesForUser(session.profile.userId),
    buildIncomingFriendRequestsForUser(session.profile.userId),
    buildOutgoingFriendRequestUserIdsForUser(session.profile.userId),
  ])
  io.to(socketId).emit(serverEvents.socialState, { friends, incomingFriendRequests, outgoingFriendRequestUserIds })
}

async function refreshSocialStateForAllSessions() {
  await Promise.all(Array.from(sessions.keys()).map((socketId) => emitSocialStateToSocket(socketId)))
}

async function buildPartyForUser(userId: string): Promise<PartySummary | null> {
  const persistedParty = await gameRepository.getParty(userId)
  if (!persistedParty) {
    return null
  }

  const onlineUserIds = new Set(Array.from(sessions.values()).map((session) => session.profile.userId))

  return {
    ...persistedParty,
    members: persistedParty.members.map((member) => ({
      ...member,
      isOnline: onlineUserIds.has(member.userId),
    })),
  }
}

async function buildPartyPresenceMarkerForUser(userId: string): Promise<PartyPresenceMarker> {
  const party = await buildPartyForUser(userId)
  if (!party) {
    return {
      partyId: null,
      partyLeaderUserId: null,
      partyLeaderDisplayName: null,
      partyLeaderSkinId: null,
      partyLeaderSkinColors: null,
    }
  }

  const leaderMember = party.members.find((member) => member.userId === party.leaderUserId) ?? null
  return {
    partyId: party.partyId,
    partyLeaderUserId: party.leaderUserId,
    partyLeaderDisplayName: leaderMember?.displayName ?? null,
    partyLeaderSkinId: leaderMember?.skinId ?? null,
    partyLeaderSkinColors: leaderMember?.skinColors ?? null,
  }
}

async function refreshRoomPresenceForUserIds(userIds: string[]) {
  const normalizedUserIds = [...new Set(userIds.filter((userId) => userId.trim().length > 0))]
  if (normalizedUserIds.length === 0) {
    return
  }

  const partyMarkers = new Map<string, PartyPresenceMarker>()
  await Promise.all(
    normalizedUserIds.map(async (userId) => {
      partyMarkers.set(userId, await buildPartyPresenceMarkerForUser(userId))
    }),
  )

  const affectedRoomIds = new Set<string>()
  rooms.forEach((room) => {
    let roomChanged = false
    room.players.forEach((player) => {
      const marker = partyMarkers.get(player.userId)
      if (!marker) {
        return
      }

      const nextLeaderSkinColors = marker.partyLeaderSkinColors ? { ...marker.partyLeaderSkinColors } : null
      const didChange =
        player.partyId !== marker.partyId ||
        player.partyLeaderUserId !== marker.partyLeaderUserId ||
        player.partyLeaderDisplayName !== marker.partyLeaderDisplayName ||
        player.partyLeaderSkinId !== marker.partyLeaderSkinId ||
        JSON.stringify(player.partyLeaderSkinColors ?? null) !== JSON.stringify(nextLeaderSkinColors)

      if (!didChange) {
        return
      }

      player.partyId = marker.partyId
      player.partyLeaderUserId = marker.partyLeaderUserId
      player.partyLeaderDisplayName = marker.partyLeaderDisplayName
      player.partyLeaderSkinId = marker.partyLeaderSkinId
      player.partyLeaderSkinColors = nextLeaderSkinColors
      roomChanged = true
    })

    if (roomChanged) {
      affectedRoomIds.add(room.roomId)
    }
  })

  await Promise.all(
    Array.from(affectedRoomIds).map(async (roomId) => {
      const room = rooms.get(roomId)
      if (room) {
        io.to(roomId).emit(serverEvents.roomState, room)
      }
    }),
  )
}

async function buildIncomingPartyInvitesForUser(userId: string): Promise<PartyInviteSummary[]> {
  return gameRepository.getIncomingPartyInvites(userId)
}

async function buildOutgoingPartyInvitesForUser(userId: string): Promise<PartyOutgoingInviteSummary[]> {
  return gameRepository.getOutgoingPartyInvites(userId)
}

async function emitPartyStateToSocket(socketId: string) {
  const session = sessions.get(socketId)
  if (!session) {
    return
  }

  const [party, incomingPartyInvites, outgoingPartyInvites] = await Promise.all([
    buildPartyForUser(session.profile.userId),
    buildIncomingPartyInvitesForUser(session.profile.userId),
    buildOutgoingPartyInvitesForUser(session.profile.userId),
  ])

  const payload: PartyStatePayload = {
    party,
    incomingPartyInvites,
    outgoingPartyInvites,
  }

  io.to(socketId).emit(serverEvents.partyState, payload)
}

async function refreshPartyStateForAllSessions() {
  await Promise.all(Array.from(sessions.keys()).map((socketId) => emitPartyStateToSocket(socketId)))
}

async function refreshPartyStateForUserIds(userIds: string[]) {
  const normalizedUserIds = [...new Set(userIds.filter((userId) => userId.trim().length > 0))]
  if (normalizedUserIds.length === 0) {
    return
  }

  const targetSocketIds = Array.from(sessions.entries())
    .filter(([, session]) => normalizedUserIds.includes(session.profile.userId))
    .map(([socketId]) => socketId)

  await Promise.all(targetSocketIds.map((socketId) => emitPartyStateToSocket(socketId)))
}

function getSocketIdsForUser(userId: string) {
  return Array.from(sessions.entries())
    .filter(([, session]) => session.profile.userId === userId)
    .map(([socketId]) => socketId)
}

function getPresenceForUser(userId: string): Presence | null {
  for (const [socketId, session] of sessions.entries()) {
    if (session.profile.userId !== userId || !session.roomId) {
      continue
    }

    const room = rooms.get(session.roomId)
    const player = room?.players.find((presence) => presence.sessionId === socketId) ?? null
    if (player) {
      return player
    }
  }

  return null
}

function emitActivityNoticeToUserIds(userIds: string[], title: string, message: string) {
  const payload: ActivityNoticePayload = {
    noticeId: randomUUID(),
    title,
    message,
  }

  const targetSocketIds = Array.from(
    new Set(userIds.flatMap((userId) => getSocketIdsForUser(userId))),
  )

  targetSocketIds.forEach((socketId) => {
    io.to(socketId).emit(serverEvents.activityNotice, payload)
  })
}

function clearPendingPartyLeaderFollowRequest(requestId: string) {
  const pendingRequest = pendingPartyLeaderFollowRequests.get(requestId)
  if (!pendingRequest) {
    return
  }

  clearTimeout(pendingRequest.timeoutId)
  pendingPartyLeaderFollowRequests.delete(requestId)

  if (pendingPartyLeaderFollowRequestIdsByUser.get(pendingRequest.targetUserId) === requestId) {
    pendingPartyLeaderFollowRequestIdsByUser.delete(pendingRequest.targetUserId)
  }
}

function clearPendingPartyLeaderFollowRequestForUser(userId: string) {
  const requestId = pendingPartyLeaderFollowRequestIdsByUser.get(userId)
  if (requestId) {
    clearPendingPartyLeaderFollowRequest(requestId)
  }
}

function buildPartyLeaderFollowPromptPayload(
  pendingRequest: PendingPartyLeaderFollowRequest,
): PartyLeaderFollowPromptPayload {
  return {
    requestId: pendingRequest.requestId,
    partyId: pendingRequest.partyId,
    leaderUserId: pendingRequest.leaderUserId,
    leaderDisplayName: pendingRequest.leaderDisplayName,
    roomId: pendingRequest.roomId,
    roomName: pendingRequest.roomName,
    templateId: pendingRequest.templateId,
    spawnPosition: { ...pendingRequest.spawnPosition },
    expiresAt: new Date(pendingRequest.expiresAt).toISOString(),
  }
}

function emitRoomTransitionToUser(userId: string, payload: RoomTransitionRequestedPayload) {
  getSocketIdsForUser(userId).forEach((socketId) => {
    io.to(socketId).emit(serverEvents.roomTransitionRequested, payload)
  })
}

async function handlePartyLeaderFollowTimeout(requestId: string) {
  const pendingRequest = pendingPartyLeaderFollowRequests.get(requestId)
  if (!pendingRequest) {
    return
  }

  clearPendingPartyLeaderFollowRequest(requestId)

  const currentParty = await buildPartyForUser(pendingRequest.targetUserId)
  if (!currentParty || currentParty.partyId !== pendingRequest.partyId) {
    return
  }

  emitRoomTransitionToUser(pendingRequest.targetUserId, {
    roomId: pendingRequest.roomId,
    templateId: pendingRequest.templateId,
    spawnPosition: { ...pendingRequest.spawnPosition },
    transition: 'follow-leader',
  })
}

function requestPartyLeaderFollowForUser({
  partyId,
  leaderUserId,
  leaderDisplayName,
  targetUserId,
  roomId,
  roomName,
  templateId,
  spawnPosition,
}: {
  partyId: string
  leaderUserId: string
  leaderDisplayName: string
  targetUserId: string
  roomId: string
  roomName: string
  templateId: string
  spawnPosition: Position
}) {
  clearPendingPartyLeaderFollowRequestForUser(targetUserId)

  const requestId = randomUUID()
  const expiresAt = Date.now() + PARTY_LEADER_FOLLOW_TTL_MS
  const timeoutId = setTimeout(() => {
    void handlePartyLeaderFollowTimeout(requestId)
  }, PARTY_LEADER_FOLLOW_TTL_MS)

  const pendingRequest: PendingPartyLeaderFollowRequest = {
    requestId,
    partyId,
    leaderUserId,
    leaderDisplayName,
    targetUserId,
    roomId,
    roomName,
    templateId,
    spawnPosition: { ...spawnPosition },
    expiresAt,
    timeoutId,
  }

  pendingPartyLeaderFollowRequests.set(requestId, pendingRequest)
  pendingPartyLeaderFollowRequestIdsByUser.set(targetUserId, requestId)

  const payload = buildPartyLeaderFollowPromptPayload(pendingRequest)
  getSocketIdsForUser(targetUserId).forEach((socketId) => {
    io.to(socketId).emit(serverEvents.partyLeaderFollowRequested, payload)
  })
}

async function requestPartyLeaderFollowForPartyMembers(leaderUserId: string) {
  const party = await buildPartyForUser(leaderUserId)
  if (!party) {
    return
  }

  const leaderPresence = getPresenceForUser(leaderUserId)
  if (!leaderPresence) {
    return
  }

  const leaderRoom = rooms.get(leaderPresence.roomId)
  if (!leaderRoom) {
    return
  }

  const leaderDisplayName =
    party.members.find((member) => member.userId === party.leaderUserId)?.displayName ?? 'El lider del grupo'

  party.members
    .filter((member) => member.userId !== leaderUserId && member.isOnline)
    .forEach((member) => {
      const memberPresence = getPresenceForUser(member.userId)
      if (!memberPresence || memberPresence.roomId === leaderRoom.roomId) {
        clearPendingPartyLeaderFollowRequestForUser(member.userId)
        return
      }

      requestPartyLeaderFollowForUser({
        partyId: party.partyId,
        leaderUserId,
        leaderDisplayName,
        targetUserId: member.userId,
        roomId: leaderRoom.roomId,
        roomName: leaderRoom.name,
        templateId: leaderRoom.templateId,
        spawnPosition: { ...leaderPresence.position },
      })
    })
}

async function ensurePartyCanGatherInSharedRoom(leaderUserId: string) {
  const party = await buildPartyForUser(leaderUserId)
  if (!party || party.leaderUserId !== leaderUserId) {
    return
  }

  const leaderPresence = getPresenceForUser(leaderUserId)
  if (!leaderPresence) {
    return
  }

  const leaderRoom = rooms.get(leaderPresence.roomId)
  if (!leaderRoom) {
    return
  }

  const onlinePartyPresences = party.members
    .filter((member) => member.isOnline)
    .flatMap((member) => {
      const presence = getPresenceForUser(member.userId)
      return presence ? [{ userId: member.userId, presence }] : []
    })

  if (onlinePartyPresences.length <= 1) {
    return
  }

  const membersOutsideLeaderRoom = onlinePartyPresences.filter(
    ({ presence }) => presence.roomId !== leaderRoom.roomId,
  )

  if (membersOutsideLeaderRoom.length === 0) {
    return
  }

  if (getAvailableSlotsForRoom(leaderRoom) >= membersOutsideLeaderRoom.length) {
    await requestPartyLeaderFollowForPartyMembers(leaderUserId)
    return
  }

  const targetRoom = findOrCreateRoomForPartyPlacement(leaderRoom.templateId, onlinePartyPresences.length, [
    leaderRoom.roomId,
  ])

  if (!targetRoom) {
    emitActivityNoticeToUserIds(
      [leaderUserId],
      'Grupo actualizado',
      'No hay una sala con cupo suficiente para mover a todo el grupo.',
    )
    return
  }

  emitRoomTransitionToUser(leaderUserId, {
    roomId: targetRoom.roomId,
    templateId: targetRoom.templateId,
    spawnPosition: { ...leaderPresence.position },
    transition: 'teleport',
  })
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

function pruneSessionPresenceAcrossRooms(sessionId: string) {
  const affectedRoomIds: string[] = []

  rooms.forEach((room, roomId) => {
    const nextPlayers = room.players.filter((player) => player.sessionId !== sessionId)
    if (nextPlayers.length === room.players.length) {
      return
    }

    room.players = nextPlayers
    if (room.players.length === 0) {
      rooms.delete(roomId)
      return
    }

    affectedRoomIds.push(roomId)
  })

  affectedRoomIds.forEach((roomId) => {
    const room = rooms.get(roomId)
    if (room) {
      io.to(roomId).emit(serverEvents.roomState, room)
    }
  })
}

function buildPresence(
  profile: UserProfile,
  progress: PlayerProgress,
  sessionId: string,
  room: RoomState,
  spawnPosition: Position = room.template.world.spawn,
): Presence {
  return {
    userId: profile.userId,
    displayName: profile.displayName,
    sessionId,
    roomId: room.roomId,
    level: progress.level,
    position: { ...spawnPosition },
    direction: 'down',
    moving: false,
    skinId: profile.skinId,
    skinColors: { ...(profile.skinColors ?? {}) },
    partyId: null,
    partyLeaderUserId: null,
    partyLeaderDisplayName: null,
    partyLeaderSkinId: null,
    partyLeaderSkinColors: null,
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

async function removeSessionPresenceFromCurrentRoom(socket: Socket, session: SessionState) {
  if (!session.roomId) {
    return null
  }

  const room = rooms.get(session.roomId)
  if (!room) {
    session.roomId = null
    return null
  }

  const departingPlayer = room.players.find((presence) => presence.sessionId === socket.id) ?? null
  if (departingPlayer) {
    await gameRepository.savePlayerState(session.profile.userId, {
      roomId: room.roomId,
      position: clonePosition(departingPlayer.position),
    })
  }

  room.players = room.players.filter((presence) => presence.sessionId !== socket.id)
  socket.leave(room.roomId)
  io.to(room.roomId).emit(serverEvents.typingStateChanged, {
    roomId: room.roomId,
    userId: session.profile.userId,
    isTyping: false,
  })
  io.to(room.roomId).emit(serverEvents.playerLeft, {
    sessionId: socket.id,
    userId: session.profile.userId,
  })

  if (room.players.length === 0) {
    rooms.delete(room.roomId)
  }

  session.roomId = null
  return departingPlayer
}

async function joinSessionToRoom(
  socket: Socket,
  session: SessionState,
  room: RoomState,
  entryPosition?: Position,
) {
  pruneSessionPresenceAcrossRooms(socket.id)
  socket.join(room.roomId)
  session.roomId = room.roomId

  const persistedState = await gameRepository.getPlayerState(session.profile.userId)
  const preferredSpawnPosition = entryPosition
    ? clampPositionToRoom(room, entryPosition)
    : persistedState?.roomId === room.roomId && persistedState.position
      ? clampPositionToRoom(room, persistedState.position)
      : room.template.world.spawn

  const presence = buildPresence(session.profile, session.progress, socket.id, room, preferredSpawnPosition)
  const partyMarker = await buildPartyPresenceMarkerForUser(session.profile.userId)
  presence.partyId = partyMarker.partyId
  presence.partyLeaderUserId = partyMarker.partyLeaderUserId
  presence.partyLeaderDisplayName = partyMarker.partyLeaderDisplayName
  presence.partyLeaderSkinId = partyMarker.partyLeaderSkinId
  presence.partyLeaderSkinColors = partyMarker.partyLeaderSkinColors
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

  return presence
}

async function disconnectConflictingSessionsForUser(userId: string, currentSocketId: string) {
  const conflictingEntries = Array.from(sessions.entries()).filter(
    ([socketId, session]) => socketId !== currentSocketId && session.profile.userId === userId,
  )

  for (const [socketId, session] of conflictingEntries) {
    clearPendingPartyLeaderFollowRequestForUser(session.profile.userId)
    const conflictingSocket = io.sockets.sockets.get(socketId)
    if (conflictingSocket) {
      await removeSessionPresenceFromCurrentRoom(conflictingSocket, session)
      conflictingSocket.emit(serverEvents.serverError, {
        code: 'SESSION_REPLACED',
        message: 'Tu cuenta se abrio en otra ventana o pestaña.',
      })
      sessions.delete(socketId)
      conflictingSocket.disconnect(true)
    } else {
      sessions.delete(socketId)
    }

    pruneSessionPresenceAcrossRooms(socketId)
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
    await disconnectConflictingSessionsForUser(resolvedProfile.userId, socket.id)

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
      incomingFriendRequests: resolvedProfileResult.incomingFriendRequests,
      outgoingFriendRequestUserIds: resolvedProfileResult.outgoingFriendRequestUserIds,
      party: resolvedProfileResult.party
        ? {
            ...resolvedProfileResult.party,
            members: resolvedProfileResult.party.members.map((member) => ({
              ...member,
              isOnline: sessionsHasUser(member.userId),
            })),
          }
        : null,
      incomingPartyInvites: resolvedProfileResult.incomingPartyInvites,
      outgoingPartyInvites: resolvedProfileResult.outgoingPartyInvites,
    }

    socket.emit(serverEvents.connectionAccepted, connectionAcceptedPayload)
    void refreshSocialStateForAllSessions()
    void refreshPartyStateForAllSessions()
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

    const previousRoomId = session.roomId
    const transition = parsed.data.transition ?? 'direct'
    const requestedRoomId = parsed.data.roomId?.trim() || null
    const party = await buildPartyForUser(session.profile.userId)
    if (party && party.leaderUserId !== session.profile.userId && transition !== 'follow-leader') {
      const leaderPresence = getPresenceForUser(party.leaderUserId)
      const leaderRoomId = leaderPresence?.roomId ?? null
      const requestedDifferentRoomFromLeader = leaderRoomId !== null && leaderRoomId !== requestedRoomId
      const isSceneChange = previousRoomId !== null && previousRoomId !== requestedRoomId

      if (requestedDifferentRoomFromLeader || isSceneChange) {
        socket.emit(serverEvents.serverError, {
          code: 'PARTY_LEADER_TELEPORT_ONLY',
          message: 'Solo el lider del grupo se puede teletransportar.',
        })
        return
      }
    }

    const isAutoRoomAssignment = !requestedRoomId || requestedRoomId === parsed.data.templateId
    const requiredRoomCapacity =
      party && party.leaderUserId === session.profile.userId && transition !== 'follow-leader'
        ? Math.max(1, party.members.filter((member) => member.isOnline).length)
        : 1

    const room = isAutoRoomAssignment
      ? requiredRoomCapacity > 1
        ? findOrCreateRoomForPartyPlacement(parsed.data.templateId, requiredRoomCapacity)
        : findOrCreateRoomForDirectJoin(parsed.data.templateId)
      : getOrCreateRoom(requestedRoomId, parsed.data.templateId)

    if (!room) {
      socket.emit(serverEvents.serverError, {
        code: requiredRoomCapacity > DEFAULT_ROOM_CAPACITY ? 'ROOM_CAPACITY_EXCEEDED' : 'ROOM_TEMPLATE_INVALID',
        message:
          requiredRoomCapacity > DEFAULT_ROOM_CAPACITY
            ? 'El grupo supera el cupo maximo permitido para una sala.'
            : 'La plantilla de la sala no existe o no coincide con la ruta solicitada.',
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

    await removeSessionPresenceFromCurrentRoom(socket, session)
    await joinSessionToRoom(socket, session, room, parsed.data.spawnPosition)

    if (party?.leaderUserId === session.profile.userId && transition !== 'follow-leader') {
      await requestPartyLeaderFollowForPartyMembers(session.profile.userId)
    }
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

  socket.on(clientEvents.updateSkin, async (rawPayload) => {
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
    const party = await buildPartyForUser(session.profile.userId)
    const affectedUserIds = party?.members.map((member) => member.userId) ?? [session.profile.userId]
    await refreshRoomPresenceForUserIds(affectedUserIds)
    io.to(room.roomId).emit(serverEvents.playerMoved, player)
    io.to(room.roomId).emit(serverEvents.roomState, room)
  })

  socket.on(clientEvents.updateAudioSettings, (rawPayload, callback) => {
    const parsed = updateAudioSettingsSchema.safeParse(rawPayload)
    const session = sessions.get(socket.id)

    if (!parsed.success || !session) {
      callback?.({
        ok: false,
        message: 'No fue posible actualizar tus ajustes de audio.',
      })
      return
    }

    session.profile.audioSettings = { ...parsed.data.audioSettings }
    void gameRepository.savePlayerProfile(session.profile)

    callback?.({
      ok: true,
      profile: session.profile,
    })
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

  socket.on(clientEvents.requestPartyState, () => {
    void emitPartyStateToSocket(socket.id)
  })

  socket.on(clientEvents.addFriend, async (rawPayload, callback) => {
    const parsed = addFriendSchema.safeParse(rawPayload)
    const session = sessions.get(socket.id)

    if (!parsed.success || !session) {
      callback?.({
        ok: false,
        message: 'No fue posible enviar la solicitud.',
      })
      return
    }

    const result = await gameRepository.sendFriendRequest(session.profile.userId, parsed.data.friendUserId)

    if (!result.ok) {
      callback?.(result)
      return
    }

    await emitSocialStateToSocket(socket.id)

    const targetSocketId = Array.from(sessions.entries()).find(
      ([, currentSession]) => currentSession.profile.userId === parsed.data.friendUserId,
    )?.[0]

    if (targetSocketId) {
      if (result.request) {
        io.to(targetSocketId).emit(serverEvents.friendRequestReceived, result.request)
      }
      await emitSocialStateToSocket(targetSocketId)
    }

    await refreshSocialStateForAllSessions()

    callback?.({
      ok: true,
      request: result.request,
    })
  })

  socket.on(clientEvents.respondFriendRequest, async (rawPayload, callback) => {
    const parsed = respondFriendRequestSchema.safeParse(rawPayload)
    const session = sessions.get(socket.id)

    if (!parsed.success || !session) {
      callback?.({
        ok: false,
        message: 'No fue posible responder la solicitud.',
      })
      return
    }

    const result = await gameRepository.respondToFriendRequest(
      session.profile.userId,
      parsed.data.requestId,
      parsed.data.action,
    )

    if (!result.ok) {
      callback?.(result)
      return
    }

    await emitSocialStateToSocket(socket.id)

    if (result.requesterUserId) {
      const requesterSocketId = Array.from(sessions.entries()).find(
        ([, currentSession]) => currentSession.profile.userId === result.requesterUserId,
      )?.[0]

      if (requesterSocketId) {
        await emitSocialStateToSocket(requesterSocketId)
      }
    }

    await refreshSocialStateForAllSessions()
    callback?.({ ok: true })
  })

  socket.on(clientEvents.removeFriend, async (rawPayload, callback) => {
    const parsed = removeFriendSchema.safeParse(rawPayload)
    const session = sessions.get(socket.id)

    if (!parsed.success || !session) {
      callback?.({
        ok: false,
        message: 'No fue posible quitar la amistad.',
      })
      return
    }

    const result = await gameRepository.removeFriend(session.profile.userId, parsed.data.friendUserId)
    if (!result.ok) {
      callback?.(result)
      return
    }

    await emitSocialStateToSocket(socket.id)

    const targetSocketId = Array.from(sessions.entries()).find(
      ([, currentSession]) => currentSession.profile.userId === parsed.data.friendUserId,
    )?.[0]

    if (targetSocketId) {
      await emitSocialStateToSocket(targetSocketId)
    }

    await refreshSocialStateForAllSessions()
    callback?.({ ok: true })
  })

  socket.on(clientEvents.inviteToParty, async (rawPayload, callback) => {
    const parsed = inviteToPartySchema.safeParse(rawPayload)
    const session = sessions.get(socket.id)

    if (!parsed.success || !session) {
      callback?.({
        ok: false,
        message: 'No fue posible enviar la invitacion al grupo.',
      })
      return
    }

    const targetSocketIds = Array.from(sessions.entries())
      .filter(([, currentSession]) => currentSession.profile.userId === parsed.data.friendUserId)
      .map(([targetSocketId]) => targetSocketId)

    if (targetSocketIds.length === 0) {
      callback?.({
        ok: false,
        message: 'Ese jugador no se encuentra conectado.',
      })
      return
    }

    const result = await gameRepository.inviteToParty(session.profile.userId, parsed.data.friendUserId)
    if (!result.ok) {
      callback?.(result)
      return
    }

    await emitPartyStateToSocket(socket.id)

    await Promise.all(
      targetSocketIds.map(async (targetSocketId) => {
        if (result.invite) {
          io.to(targetSocketId).emit(serverEvents.partyInviteReceived, result.invite)
        }
        await emitPartyStateToSocket(targetSocketId)
      }),
    )

    await refreshPartyStateForAllSessions()
    callback?.({
      ok: true,
      invite: result.invite,
    })
  })

  socket.on(clientEvents.respondPartyInvite, async (rawPayload, callback) => {
    const parsed = respondPartyInviteSchema.safeParse(rawPayload)
    const session = sessions.get(socket.id)

    if (!parsed.success || !session) {
      callback?.({
        ok: false,
        message: 'No fue posible responder la invitacion al grupo.',
      })
      return
    }

    const result = await gameRepository.respondToPartyInvite(
      session.profile.userId,
      parsed.data.inviteId,
      parsed.data.action,
    )

    if (!result.ok) {
      callback?.(result)
      return
    }

    clearPendingPartyLeaderFollowRequestForUser(session.profile.userId)
    await refreshPartyStateForUserIds(result.affectedUserIds ?? [session.profile.userId])
    await refreshRoomPresenceForUserIds(result.affectedUserIds ?? [session.profile.userId])
    await refreshPartyStateForAllSessions()

    if (parsed.data.action === 'accept') {
      await ensurePartyCanGatherInSharedRoom(result.leaderUserId ?? session.profile.userId)
    }

    callback?.({ ok: true })
  })

  socket.on(clientEvents.respondPartyLeaderFollow, async (rawPayload, callback) => {
    const parsed = respondPartyLeaderFollowSchema.safeParse(rawPayload)
    const session = sessions.get(socket.id)

    if (!parsed.success || !session) {
      callback?.({
        ok: false,
        message: 'No fue posible responder al movimiento del lider.',
      })
      return
    }

    const pendingRequest = pendingPartyLeaderFollowRequests.get(parsed.data.requestId)
    if (!pendingRequest || pendingRequest.targetUserId !== session.profile.userId) {
      socket.emit(serverEvents.serverError, {
        code: 'PARTY_FOLLOW_REQUEST_EXPIRED',
        message: 'La solicitud para seguir al lider ya no esta disponible.',
      })
      callback?.({
        ok: false,
        message: 'La solicitud para seguir al lider ya no esta disponible.',
      })
      return
    }

    clearPendingPartyLeaderFollowRequest(parsed.data.requestId)

    const currentParty = await buildPartyForUser(session.profile.userId)
    if (!currentParty || currentParty.partyId !== pendingRequest.partyId) {
      callback?.({
        ok: false,
        message: 'Tu grupo cambio antes de responder al movimiento del lider.',
      })
      return
    }

    if (parsed.data.action === 'reject') {
      const result = await gameRepository.leaveParty(session.profile.userId)
      if (!result.ok) {
        callback?.(result)
        return
      }

      for (const userId of result.affectedUserIds ?? [session.profile.userId]) {
        clearPendingPartyLeaderFollowRequestForUser(userId)
      }
      await refreshPartyStateForUserIds(result.affectedUserIds ?? [session.profile.userId])
      await refreshRoomPresenceForUserIds(result.affectedUserIds ?? [session.profile.userId])
      await refreshPartyStateForAllSessions()
      emitActivityNoticeToUserIds(
        result.affectedUserIds ?? [session.profile.userId],
        'Grupo actualizado',
        `${session.profile.displayName} decidio no seguir al lider y salio del grupo.`,
      )
      callback?.({ ok: true })
      return
    }

    emitRoomTransitionToUser(session.profile.userId, {
      roomId: pendingRequest.roomId,
      templateId: pendingRequest.templateId,
      spawnPosition: { ...pendingRequest.spawnPosition },
      transition: 'follow-leader',
    })

    callback?.({ ok: true })
  })

  socket.on(clientEvents.leaveParty, async (rawPayload, callback) => {
    const parsed = leavePartySchema.safeParse(rawPayload)
    const session = sessions.get(socket.id)

    if (!parsed.success || !session) {
      callback?.({
        ok: false,
        message: 'No fue posible salir del grupo.',
      })
      return
    }

    const result = await gameRepository.leaveParty(session.profile.userId)
    if (!result.ok) {
      callback?.(result)
      return
    }

    for (const userId of result.affectedUserIds ?? [session.profile.userId]) {
      clearPendingPartyLeaderFollowRequestForUser(userId)
    }
    await refreshPartyStateForUserIds(result.affectedUserIds ?? [session.profile.userId])
    await refreshRoomPresenceForUserIds(result.affectedUserIds ?? [session.profile.userId])
    await refreshPartyStateForAllSessions()
    callback?.({ ok: true })
  })

  socket.on(clientEvents.promotePartyLeader, async (rawPayload, callback) => {
    const parsed = promotePartyLeaderSchema.safeParse(rawPayload)
    const session = sessions.get(socket.id)

    if (!parsed.success || !session) {
      callback?.({
        ok: false,
        message: 'No fue posible promover al nuevo lider.',
      })
      return
    }

    const result = await gameRepository.promotePartyLeader(session.profile.userId, parsed.data.nextLeaderUserId)
    if (!result.ok) {
      callback?.(result)
      return
    }

    for (const userId of result.affectedUserIds ?? [session.profile.userId]) {
      clearPendingPartyLeaderFollowRequestForUser(userId)
    }
    await refreshPartyStateForUserIds(result.affectedUserIds ?? [session.profile.userId])
    await refreshRoomPresenceForUserIds(result.affectedUserIds ?? [session.profile.userId])
    await refreshPartyStateForAllSessions()
    callback?.({ ok: true })
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

  socket.on('disconnect', async () => {
    const session = sessions.get(socket.id)
    if (!session) {
      return
    }

    await removeSessionPresenceFromCurrentRoom(socket, session)

    sessions.delete(socket.id)

    const userStillHasActiveSession = Array.from(sessions.values()).some(
      (currentSession) => currentSession.profile.userId === session.profile.userId,
    )

    if (!userStillHasActiveSession) {
      clearPendingPartyLeaderFollowRequestForUser(session.profile.userId)
      const partyLeaveResult = await gameRepository.leaveParty(session.profile.userId)
      if (partyLeaveResult.ok) {
        for (const userId of partyLeaveResult.affectedUserIds ?? [session.profile.userId]) {
          clearPendingPartyLeaderFollowRequestForUser(userId)
        }
        await refreshPartyStateForUserIds(partyLeaveResult.affectedUserIds ?? [session.profile.userId])
        await refreshRoomPresenceForUserIds(partyLeaveResult.affectedUserIds ?? [session.profile.userId])
      }
    }

    await refreshSocialStateForAllSessions()
  })
})

void initializeDatabase().finally(() => {
  httpServer.listen(port, '0.0.0.0', () => {
    console.log(`Social Sena game server listening on port ${port}`)
  })
})
