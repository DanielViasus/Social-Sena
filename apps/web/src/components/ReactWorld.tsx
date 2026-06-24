import { useEffect, useMemo, useRef, useState } from 'react'
import type {
  EnemyCombatEncounterStatePayload,
  Position,
  Presence,
  RoomEnemyTemplate,
  RoomInteractableTemplate,
  RoomNpcTemplate,
  RoomObjectTemplate,
  RoomState,
  RoomTeleportTemplate,
  RoomTemplate
} from '@social-sena/shared'
import { resolveAvatarPreset, resolveAvatarSheetUrl } from '../game/avatar/avatarSprites'
import { ObjectDecoration, getObjectPerspectiveY } from './world/ObjectDecoration'
import {
  WorldPlayer,
  getPlayerPerspectiveY,
  PLAYER_COLLIDER_HEIGHT,
  PLAYER_COLLIDER_WIDTH,
} from './world/WorldPlayer'
import {
  WorldNpc,
  type NpcInteractionState,
  type WorldNpcFrameDefinition,
  getNpcAreaBounds,
  getNpcPerspectiveY,
  getNpcWarningArea,
  getNpcInteractionArea,
} from './world/WorldNpc'
import {
  WorldTeleport,
  getTeleportAreaBounds,
  getTeleportInteractionArea,
  getTeleportPerspectiveY,
  getTeleportWarningArea,
} from './world/WorldTeleport'
import { WorldCombatEncounter } from './world/WorldCombatEncounter'
import {
  getEnemySpriteAsset,
  getNpcSpriteAsset,
  getRoomBackgroundAsset,
  getWorldSpriteAsset,
} from './world/worldAssetCatalog'
import { Enemigo } from './world/Enemigo'

interface ReactWorldProps {
  room: RoomState | null
  currentUserId: string
  template: RoomTemplate
  enemyCombatEncounters?: EnemyCombatEncounterStatePayload[]
  onNavigate: (target: Position) => void
  debugEnabled: boolean
  playerIdentityMode?: 'icons' | 'names'
  activeSpeechByUserId?: Record<string, string>
  typingByUserId?: Record<string, boolean>
  typingIndicatorText?: string
  onInteract?: (interactable: WorldInteractableTarget) => void
  onEnemyTouchInteract?: (enemyTemplate: RoomEnemyTemplate) => void
  onActiveInteractableChange?: (interactable: WorldInteractableTarget | null) => void
  navigationEnabled?: boolean
  interactionEnabled?: boolean
  blockedEnemyInteractionIds?: string[]
  suppressInteractionIconForId?: string | null
  pointerInteractionEnabled?: boolean
}

export interface CombatEncounterInteractable {
  entityType: 'enemy-combat'
  id: string
  encounterId: string
  label: string
}

export type WorldInteractableTarget = RoomInteractableTemplate | CombatEncounterInteractable

interface AnimatedPlayerPosition {
  x: number
  y: number
}

type FacingPose = 'front-right' | 'front-left' | 'back-right' | 'back-left'

interface WorldRuntimeState {
  now: number
  roomStartedAt: number
  cameraX: number
  cameraY: number
  playersBySession: Record<string, AnimatedPlayerPosition>
  facingBySession: Record<string, FacingPose>
  enemiesById: Record<string, AnimatedPlayerPosition>
  enemyFacingById: Record<string, FacingPose>
}

interface ViewportSize {
  width: number
  height: number
}

type RenderLayerItem =
  | {
      kind: 'object'
      key: string
      perspectiveY: number
      objectTemplate: RoomObjectTemplate
      spriteSrc?: string
    }
  | {
      kind: 'teleport'
      key: string
      perspectiveY: number
      teleportTemplate: RoomTeleportTemplate
      state: NpcInteractionState
      spriteSrc?: string
      hoverSpriteSrc?: string
      iconFrame: WorldNpcFrameDefinition | null
    }
  | {
      kind: 'player'
      key: string
      perspectiveY: number
      player: Presence
      animatedPosition: AnimatedPlayerPosition
      frame: ReturnType<typeof getAvatarFrame>
      isSelf: boolean
    }
  | {
      kind: 'npc'
      key: string
      perspectiveY: number
      npcTemplate: RoomNpcTemplate
      state: NpcInteractionState
      spriteFrame: WorldNpcFrameDefinition | null
      iconFrame: WorldNpcFrameDefinition | null
      flipX: boolean
    }
  | {
      kind: 'enemy'
      key: string
      perspectiveY: number
      enemyTemplate: RoomEnemyTemplate
      displayX: number
      displayY: number
      spriteFrame: WorldNpcFrameDefinition | null
      flipX: boolean
      showIcon: boolean
    }
  | {
      kind: 'combat'
      key: string
      perspectiveY: number
      encounterId: string
      label: string
      state: NpcInteractionState
      displayX: number
      displayY: number
      iconFrame: WorldNpcFrameDefinition | null
      interactive: boolean
      warningArea: {
        offsetX: number
        offsetY: number
        width: number
        height: number
      }
      interactionArea: {
        offsetX: number
        offsetY: number
        width: number
        height: number
      }
    }

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max)
}

function colorToCss(value: number | undefined, fallback: string) {
  if (typeof value !== 'number') {
    return fallback
  }

  return `#${value.toString(16).padStart(6, '0')}`
}

const COMBAT_WARNING_AREA = {
  offsetX: 0,
  offsetY: -8,
  width: 260,
  height: 220,
}

const COMBAT_INTERACTION_AREA = {
  offsetX: 0,
  offsetY: -8,
  width: 258,
  height: 222,
}

function getCombatEncounterAreaBounds(
  displayX: number,
  displayY: number,
  area: {
    offsetX: number
    offsetY: number
    width: number
    height: number
  },
) {
  return {
    left: displayX + area.offsetX - area.width / 2,
    right: displayX + area.offsetX + area.width / 2,
    top: displayY + area.offsetY - area.height / 2,
    bottom: displayY + area.offsetY + area.height / 2,
  }
}

function resolveFacingPoseFromVector(deltaX: number, deltaY: number): FacingPose {
  const isLeft = deltaX < 0
  const isBack = deltaY < 0 && Math.abs(deltaY) >= Math.abs(deltaX) * 0.65

  if (isBack) {
    return isLeft ? 'back-left' : 'back-right'
  }

  return isLeft ? 'front-left' : 'front-right'
}

function resolveFacingPose(player: Presence, fallback: FacingPose): FacingPose {
  if (player.moving && player.destination) {
    const deltaX = player.destination.x - player.position.x
    const deltaY = player.destination.y - player.position.y

    if (Math.abs(deltaX) >= 0.001 || Math.abs(deltaY) >= 0.001) {
      return resolveFacingPoseFromVector(deltaX, deltaY)
    }
  }

  return fallback
}

function resolveCameraPosition(
  playerPosition: Position,
  template: RoomTemplate,
  viewportSize: ViewportSize,
) {
  const targetCenterX = playerPosition.x + template.camera.offsetX
  const targetCenterY = playerPosition.y + template.camera.offsetY
  const unclampedCameraX = targetCenterX - viewportSize.width / 2
  const unclampedCameraY = targetCenterY - viewportSize.height / 2

  const maxCameraX = Math.max(0, template.world.width - viewportSize.width)
  const maxCameraY = Math.max(0, template.world.height - viewportSize.height)

  return {
    cameraX: template.camera.clampBorders ? clamp(unclampedCameraX, 0, maxCameraX) : unclampedCameraX,
    cameraY: template.camera.clampBorders ? clamp(unclampedCameraY, 0, maxCameraY) : unclampedCameraY,
  }
}

function getAnimatedNpcFrame(
  assetIds: string[] | undefined,
  spriteSheetAssetId: string | undefined,
  spriteSheetWidth: number | undefined,
  spriteSheetHeight: number | undefined,
  spriteFrameWidth: number | undefined,
  spriteFrameHeight: number | undefined,
  spriteFrames: { key: string; row: number; column: number }[] | undefined,
  now: number,
  frameDurationMs: number | undefined,
): WorldNpcFrameDefinition | null {
  const sheetUrl = spriteSheetAssetId ? getNpcSpriteAsset(spriteSheetAssetId) : null
  const sheetFrameDefinitions = spriteFrames ?? []

  if (
    sheetUrl &&
    typeof spriteSheetWidth === 'number' &&
    typeof spriteSheetHeight === 'number' &&
    typeof spriteFrameWidth === 'number' &&
    typeof spriteFrameHeight === 'number' &&
    sheetFrameDefinitions.length > 0
  ) {
    const frameDuration = Math.max(80, frameDurationMs ?? 180)
    const frameIndex = Math.floor(now / frameDuration) % sheetFrameDefinitions.length
    const frame = sheetFrameDefinitions[frameIndex]

    return {
      key: frame.key,
      sheetUrl,
      sheetWidth: spriteSheetWidth,
      sheetHeight: spriteSheetHeight,
      frameWidth: spriteFrameWidth,
      frameHeight: spriteFrameHeight,
      row: frame.row,
      column: frame.column,
    }
  }

  const frames = (assetIds ?? [])
    .map((assetId) => {
      const url = getNpcSpriteAsset(assetId)
      return url ? { key: assetId, url } : null
    })
    .filter((frame): frame is { key: string; url: string } => frame !== null)

  if (frames.length === 0) {
    return null
  }

  const frameDuration = Math.max(80, frameDurationMs ?? 180)
  const frameIndex = Math.floor(now / frameDuration) % frames.length
  return frames[frameIndex]
}

function getAnimatedEnemyFrame(
  enemyTemplate: RoomEnemyTemplate,
  now: number,
  facingPose: FacingPose,
  moving: boolean,
): WorldNpcFrameDefinition | null {
  const sheetUrl = getEnemySpriteAsset(enemyTemplate.spriteSheetAssetId)
  const sheetFrameDefinitions = enemyTemplate.spriteFrames ?? []

  if (
    sheetUrl &&
    typeof enemyTemplate.spriteSheetWidth === 'number' &&
    typeof enemyTemplate.spriteSheetHeight === 'number' &&
    typeof enemyTemplate.spriteFrameWidth === 'number' &&
    typeof enemyTemplate.spriteFrameHeight === 'number' &&
    sheetFrameDefinitions.length > 0
  ) {
    const useBack = facingPose === 'back-left' || facingPose === 'back-right'
    const targetRow = moving ? (useBack ? 3 : 1) : useBack ? 2 : 0
    const rowFrames = sheetFrameDefinitions
      .filter((frame) => frame.row === targetRow)
      .sort((leftFrame, rightFrame) => leftFrame.column - rightFrame.column)
    const frames = rowFrames.length > 0 ? rowFrames : sheetFrameDefinitions
    const frameDuration = Math.max(80, enemyTemplate.spriteFrameDurationMs ?? 180)
    const frameIndex = Math.floor(now / frameDuration) % frames.length
    const frame = frames[frameIndex]

    return {
      key: frame.key,
      sheetUrl,
      sheetWidth: enemyTemplate.spriteSheetWidth,
      sheetHeight: enemyTemplate.spriteSheetHeight,
      frameWidth: enemyTemplate.spriteFrameWidth,
      frameHeight: enemyTemplate.spriteFrameHeight,
      row: frame.row,
      column: frame.column,
    }
  }

  const spriteUrl = getWorldSpriteAsset(enemyTemplate.spriteAssetId)
  return spriteUrl
    ? {
        key: enemyTemplate.spriteAssetId ?? enemyTemplate.id,
        url: spriteUrl,
      }
    : null
}

function getPatrollingNpcPosition(
  npcTemplate: RoomNpcTemplate,
  now: number,
  roomStartedAt: number,
  world: RoomTemplate['world'],
) {
  const patrolArea = npcTemplate.patrolArea
  const patrolSpeedPxPerSecond = npcTemplate.patrolSpeedPxPerSecond ?? 64

  if (!patrolArea || patrolSpeedPxPerSecond <= 0) {
    return {
      x: npcTemplate.x,
      y: npcTemplate.y,
      flipX: false,
    }
  }

  const minX = npcTemplate.width / 2
  const maxX = world.width - npcTemplate.width / 2
  const minY = npcTemplate.height
  const maxY = world.height
  const patrolCenterX = npcTemplate.x + patrolArea.offsetX
  const patrolCenterY = npcTemplate.y + patrolArea.offsetY
  const left = clamp(patrolCenterX - patrolArea.width / 2, minX, maxX)
  const right = clamp(patrolCenterX + patrolArea.width / 2, minX, maxX)
  const top = clamp(patrolCenterY - patrolArea.height / 2, minY, maxY)
  const bottom = clamp(patrolCenterY + patrolArea.height / 2, minY, maxY)
  const initialX = clamp(npcTemplate.x, left, right)
  const initialY = clamp(npcTemplate.y, top, bottom)
  const rawRoute = [
    { x: initialX, y: initialY },
    { x: right, y: initialY },
    { x: right, y: bottom },
    { x: left, y: bottom },
    { x: left, y: top },
    { x: right, y: top },
    { x: initialX, y: top },
    { x: initialX, y: initialY },
  ]

  const patrolRoute = rawRoute.filter((point, index) => {
    if (index === 0) {
      return true
    }

    const previousPoint = rawRoute[index - 1]
    return point.x !== previousPoint.x || point.y !== previousPoint.y
  })

  if (patrolRoute.length < 2) {
    return {
      x: initialX,
      y: initialY,
      flipX: false,
    }
  }

  const segments = patrolRoute
    .slice(1)
    .map((point, index) => {
      const from = patrolRoute[index]
      const to = point
      const length = Math.hypot(to.x - from.x, to.y - from.y)

      return { from, to, length }
    })
    .filter((segment) => segment.length > 0.001)

  const totalDistance = segments.reduce((sum, segment) => sum + segment.length, 0)

  if (totalDistance <= 0.001) {
    return {
      x: initialX,
      y: initialY,
      flipX: false,
    }
  }

  let remainingDistance =
    (((now - roomStartedAt) / 1000) * patrolSpeedPxPerSecond) % totalDistance

  for (const segment of segments) {
    if (remainingDistance <= segment.length) {
      const travelRatio = segment.length <= 0.001 ? 0 : remainingDistance / segment.length
      const deltaX = segment.to.x - segment.from.x
      const deltaY = segment.to.y - segment.from.y

      return {
        x: segment.from.x + deltaX * travelRatio,
        y: segment.from.y + deltaY * travelRatio,
        flipX: deltaX < 0,
      }
    }

    remainingDistance -= segment.length
  }

  const lastSegment = segments[segments.length - 1]
  return {
    x: lastSegment.to.x,
    y: lastSegment.to.y,
    flipX: lastSegment.to.x - lastSegment.from.x < 0,
  }
}

function getAvatarFrame(player: Presence, now: number, facingPose: FacingPose) {
  const preset = resolveAvatarPreset(player.skinId)
  const sheetUrl = resolveAvatarSheetUrl(preset, player.skinColors)
  const useBack = facingPose === 'back-left' || facingPose === 'back-right'
  const flipX = facingPose === 'front-left' || facingPose === 'back-left'
  const frames = player.moving
    ? useBack && preset.walkBackFrames?.length
      ? preset.walkBackFrames
      : preset.walkFrames
    : useBack && preset.idleBackFrames?.length
      ? preset.idleBackFrames
      : preset.idleFrames
  const frameDuration = 192
  const frameIndex = Math.floor(now / frameDuration) % frames.length

  return {
    preset,
    sheetUrl,
    texture: frames[frameIndex],
    frameIndex,
    flipX,
  }
}

function getPlayerColliderBounds(position: Position) {
  return {
    left: position.x - PLAYER_COLLIDER_WIDTH / 2,
    right: position.x + PLAYER_COLLIDER_WIDTH / 2,
    top: position.y - PLAYER_COLLIDER_HEIGHT,
    bottom: position.y,
  }
}

function overlapsRect(
  a: { left: number; right: number; top: number; bottom: number },
  b: { left: number; right: number; top: number; bottom: number },
) {
  return !(a.right <= b.left || a.left >= b.right || a.bottom <= b.top || a.top >= b.bottom)
}

function expandBoundsForPlayer(bounds: { left: number; right: number; top: number; bottom: number }) {
  return {
    left: bounds.left - PLAYER_COLLIDER_WIDTH / 2,
    right: bounds.right + PLAYER_COLLIDER_WIDTH / 2,
    top: bounds.top,
    bottom: bounds.bottom + PLAYER_COLLIDER_HEIGHT,
  }
}

function segmentIntersectsExpandedBounds(
  from: Position,
  to: Position,
  bounds: { left: number; right: number; top: number; bottom: number },
) {
  const expanded = expandBoundsForPlayer(bounds)

  if (from.x >= expanded.left && from.x <= expanded.right && from.y >= expanded.top && from.y <= expanded.bottom) {
    return true
  }

  if (to.x >= expanded.left && to.x <= expanded.right && to.y >= expanded.top && to.y <= expanded.bottom) {
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

function getPerspectiveAwareRenderItems(
  template: RoomTemplate,
  teleportViews: Array<{
    teleportTemplate: RoomTeleportTemplate
    state: NpcInteractionState
    spriteSrc?: string
    hoverSpriteSrc?: string
    iconFrame: WorldNpcFrameDefinition | null
  }>,
  playerViews: Array<{
    player: Presence
    animatedPosition: AnimatedPlayerPosition
    frame: ReturnType<typeof getAvatarFrame>
    isSelf: boolean
  }>,
  npcViews: Array<{
    npcTemplate: RoomNpcTemplate
    state: NpcInteractionState
    spriteFrame: WorldNpcFrameDefinition | null
    iconFrame: WorldNpcFrameDefinition | null
    flipX: boolean
  }>,
  enemyViews: Array<{
    enemyTemplate: RoomEnemyTemplate
    displayX: number
    displayY: number
    spriteFrame: WorldNpcFrameDefinition | null
    flipX: boolean
    showIcon: boolean
  }>,
  combatViews: Array<{
    encounterId: string
    label: string
    displayX: number
    displayY: number
    state: NpcInteractionState
    iconFrame: WorldNpcFrameDefinition | null
    interactive: boolean
    warningArea: {
      offsetX: number
      offsetY: number
      width: number
      height: number
    }
    interactionArea: {
      offsetX: number
      offsetY: number
      width: number
      height: number
    }
  }>,
) {
  const objectItems: RenderLayerItem[] = template.objects.map((objectTemplate) => ({
    kind: 'object',
    key: objectTemplate.id,
    perspectiveY: getObjectPerspectiveY(objectTemplate),
    objectTemplate,
    spriteSrc: objectTemplate.spriteAssetId ? getWorldSpriteAsset(objectTemplate.spriteAssetId) : undefined,
  }))

  const teleportItems: RenderLayerItem[] = teleportViews.map(({ teleportTemplate, state, spriteSrc, hoverSpriteSrc, iconFrame }) => ({
    kind: 'teleport',
    key: teleportTemplate.id,
    perspectiveY: getTeleportPerspectiveY(teleportTemplate),
    teleportTemplate,
    state,
    spriteSrc,
    hoverSpriteSrc,
    iconFrame,
  }))

  const playerItems: RenderLayerItem[] = playerViews.map(({ player, animatedPosition, frame, isSelf }) => ({
    kind: 'player',
    key: player.sessionId,
    perspectiveY: getPlayerPerspectiveY(animatedPosition.y),
    player,
    animatedPosition,
    frame,
    isSelf,
  }))

  const npcItems: RenderLayerItem[] = npcViews.map(({ npcTemplate, state, spriteFrame, iconFrame, flipX }) => ({
    kind: 'npc',
    key: npcTemplate.id,
    perspectiveY: getNpcPerspectiveY(npcTemplate),
    npcTemplate,
    state,
    spriteFrame,
    iconFrame,
    flipX,
  }))

  const enemyItems: RenderLayerItem[] = enemyViews.map(({ enemyTemplate, displayX, displayY, spriteFrame, flipX, showIcon }) => ({
    kind: 'enemy',
    key: enemyTemplate.id,
    perspectiveY: displayY,
    enemyTemplate,
    displayX,
    displayY,
    spriteFrame,
    flipX,
    showIcon,
  }))

  const combatItems: RenderLayerItem[] = combatViews.map(({ encounterId, label, displayX, displayY, state, iconFrame, interactive, warningArea, interactionArea }) => ({
    kind: 'combat',
    key: encounterId,
    perspectiveY: displayY,
    encounterId,
    label,
    state,
    displayX,
    displayY,
    iconFrame,
    interactive,
    warningArea,
    interactionArea,
  }))

  const layerPriority: Record<RenderLayerItem['kind'], number> = {
    object: 0,
    teleport: 1,
    npc: 2,
    enemy: 3,
    combat: 4,
    player: 5,
  }

  return [...objectItems, ...teleportItems, ...npcItems, ...enemyItems, ...combatItems, ...playerItems].sort((left, right) => {
    if (left.perspectiveY !== right.perspectiveY) {
      return left.perspectiveY - right.perspectiveY
    }

    if (left.kind === right.kind) {
      return left.key.localeCompare(right.key)
    }

    return layerPriority[left.kind] - layerPriority[right.kind]
  })
}

function getNpcInteractionAnchor(npcTemplate: RoomNpcTemplate) {
  const interactionArea = getNpcInteractionArea(npcTemplate)
  return {
    x: npcTemplate.x + interactionArea.offsetX,
    y: npcTemplate.y + interactionArea.offsetY,
  }
}

function getTeleportInteractionAnchor(teleportTemplate: RoomTeleportTemplate) {
  const interactionArea = getTeleportInteractionArea(teleportTemplate)
  return {
    x: teleportTemplate.x + interactionArea.offsetX,
    y: teleportTemplate.y + interactionArea.offsetY,
  }
}

function getEnemyDirectInteractionBounds(enemyTemplate: RoomEnemyTemplate, displayX: number, displayY: number) {
  const width = enemyTemplate.ancho_area_interaccion_directa_ ?? 300
  const height = enemyTemplate.alto_area_interaccion_directa_ ?? 300

  return {
    left: displayX - width / 2,
    right: displayX + width / 2,
    top: displayY - height / 2,
    bottom: displayY + height / 2,
  }
}

function getEnemyViews(
  room: RoomState | null,
  enemyTemplates: RoomEnemyTemplate[] | undefined,
  now: number,
  enemiesById: Record<string, AnimatedPlayerPosition>,
  enemyFacingById: Record<string, FacingPose>,
) {
  if (!room) {
    return []
  }

  const enemyTemplateById = new Map((enemyTemplates ?? []).map((enemyTemplate) => [enemyTemplate.id, enemyTemplate] as const))

  return room.enemies
    .map((enemyState) => {
      const enemyTemplate = enemyTemplateById.get(enemyState.enemyId)
      if (!enemyTemplate) {
        return null
      }

      const animatedPosition = enemiesById[enemyState.enemyId] ?? {
        x: enemyState.x,
        y: enemyState.y,
      }
      const facingPose = enemyFacingById[enemyState.enemyId] ?? 'front-right'
      const moving =
        Math.hypot(enemyState.x - animatedPosition.x, enemyState.y - animatedPosition.y) > 0.45
      const flipX = facingPose === 'front-left' || facingPose === 'back-left'

      return {
        enemyTemplate,
        displayX: animatedPosition.x,
        displayY: animatedPosition.y,
        spriteFrame: getAnimatedEnemyFrame(enemyTemplate, now, facingPose, moving),
        flipX,
        showIcon: enemyState.mode === 'chase' && enemyState.targetUserId !== null,
      }
    })
    .filter(
      (enemyView): enemyView is {
        enemyTemplate: RoomEnemyTemplate
        displayX: number
        displayY: number
        spriteFrame: WorldNpcFrameDefinition | null
        flipX: boolean
        showIcon: boolean
      } =>
        enemyView !== null,
    )
}

function getEnemyCombatOverlayState(
  room: RoomState | null,
  encounters: EnemyCombatEncounterStatePayload[],
  animatedPlayersBySession: Record<string, AnimatedPlayerPosition>,
) {
  const hiddenPlayerUserIds = new Set<string>()
  const hiddenEnemyIds = new Set<string>()

  if (!room || encounters.length === 0) {
    return {
      hiddenPlayerUserIds,
      hiddenEnemyIds,
      combatViews: [] as Array<{
        encounter: EnemyCombatEncounterStatePayload
        displayX: number
        displayY: number
      }>,
    }
  }

  const playersByUserId = new Map(room.players.map((player) => [player.userId, player] as const))
  const combatViews = encounters.map((encounter) => {
    hiddenEnemyIds.add(encounter.enemyId)
    encounter.participants.forEach((participant) => {
      hiddenPlayerUserIds.add(participant.userId)
    })

    const anchorPlayer =
      encounter.participants
        .map((participant) => playersByUserId.get(participant.userId) ?? null)
        .find((player): player is Presence => player !== null) ?? null

    const anchorPosition = anchorPlayer
      ? animatedPlayersBySession[anchorPlayer.sessionId] ?? anchorPlayer.position
      : encounter.requestedByPosition

    return {
      encounter,
      displayX: anchorPosition.x,
      displayY: anchorPosition.y,
    }
  })

  return {
    hiddenPlayerUserIds,
    hiddenEnemyIds,
    combatViews,
  }
}

function ReactWorld({
  room,
  currentUserId,
  template,
  enemyCombatEncounters = [],
  onNavigate,
  debugEnabled,
  playerIdentityMode = 'icons',
  activeSpeechByUserId = {},
  typingByUserId = {},
  typingIndicatorText = '...',
  onInteract,
  onEnemyTouchInteract,
  onActiveInteractableChange,
  navigationEnabled = true,
  interactionEnabled = true,
  blockedEnemyInteractionIds = [],
  suppressInteractionIconForId = null,
  pointerInteractionEnabled = false,
}: ReactWorldProps) {
  const viewportRef = useRef<HTMLDivElement | null>(null)
  const roomRef = useRef(room)
  const touchNpcIdsRef = useRef<Set<string>>(new Set())
  const touchEnemyIdsRef = useRef<Set<string>>(new Set())
  const runtimeRef = useRef<WorldRuntimeState>({
    now: performance.now(),
    roomStartedAt: performance.now(),
    cameraX: 0,
    cameraY: 0,
    playersBySession: {},
    facingBySession: {},
    enemiesById: {},
    enemyFacingById: {},
  })
  const [viewportSize, setViewportSize] = useState({ width: 1600, height: 900 })
  const [runtime, setRuntime] = useState<WorldRuntimeState>(runtimeRef.current)

  useEffect(() => {
    roomRef.current = room
  }, [room])

  useEffect(() => {
    if (!viewportRef.current) {
      return
    }

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0]
      if (!entry) {
        return
      }

      setViewportSize({
        width: Math.max(320, Math.floor(entry.contentRect.width)),
        height: Math.max(320, Math.floor(entry.contentRect.height)),
      })
    })

    observer.observe(viewportRef.current)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    if (!room) {
      const emptyRuntime: WorldRuntimeState = {
        now: performance.now(),
        roomStartedAt: performance.now(),
        cameraX: 0,
        cameraY: 0,
        playersBySession: {},
        facingBySession: {},
        enemiesById: {},
        enemyFacingById: {},
      }

      runtimeRef.current = emptyRuntime
      setRuntime(emptyRuntime)
      return
    }

    const playersBySession = Object.fromEntries(
      room.players.map((player) => [player.sessionId, { x: player.position.x, y: player.position.y }] as const),
    )
    const facingBySession = Object.fromEntries(
      room.players.map((player) => [player.sessionId, resolveFacingPose(player, 'front-right')] as const),
    )
    const enemiesById = Object.fromEntries(
      room.enemies.map((enemyState) => [enemyState.enemyId, { x: enemyState.x, y: enemyState.y }] as const),
    )
    const enemyFacingById = Object.fromEntries(
      room.enemies.map((enemyState) => [enemyState.enemyId, 'front-right' satisfies FacingPose] as const),
    )
    const currentPlayer = room.players.find((player) => player.userId === currentUserId) ?? null
    const nextCamera = currentPlayer
      ? resolveCameraPosition(currentPlayer.position, template, viewportSize)
      : { cameraX: 0, cameraY: 0 }

    const nextRuntime: WorldRuntimeState = {
      now: performance.now(),
      roomStartedAt: performance.now(),
      cameraX: nextCamera.cameraX,
      cameraY: nextCamera.cameraY,
      playersBySession,
      facingBySession,
      enemiesById,
      enemyFacingById,
    }

    runtimeRef.current = nextRuntime
    setRuntime(nextRuntime)
  }, [room?.roomId, currentUserId, template, viewportSize])

  useEffect(() => {
    let frameId = 0
    let previousTime = performance.now()

    const tick = (now: number) => {
      const delta = now - previousTime
      previousTime = now

      const previousState = runtimeRef.current
      const nextPlayersBySession: Record<string, AnimatedPlayerPosition> = { ...previousState.playersBySession }
      const nextFacingBySession: Record<string, FacingPose> = { ...previousState.facingBySession }
      const nextEnemiesById: Record<string, AnimatedPlayerPosition> = { ...previousState.enemiesById }
      const nextEnemyFacingById: Record<string, FacingPose> = { ...previousState.enemyFacingById }
      const targetPlayers = roomRef.current?.players ?? []
      const targetEnemies = roomRef.current?.enemies ?? []
      const activeSessionIds = new Set(targetPlayers.map((player) => player.sessionId))
      const activeEnemyIds = new Set(targetEnemies.map((enemyState) => enemyState.enemyId))
      const playerLerp = 1 - Math.exp(-delta / 120)
      const enemyLerp = 1 - Math.exp(-delta / 140)

      Object.keys(nextPlayersBySession).forEach((sessionId) => {
        if (!activeSessionIds.has(sessionId)) {
          delete nextPlayersBySession[sessionId]
          delete nextFacingBySession[sessionId]
        }
      })

      Object.keys(nextEnemiesById).forEach((enemyId) => {
        if (!activeEnemyIds.has(enemyId)) {
          delete nextEnemiesById[enemyId]
          delete nextEnemyFacingById[enemyId]
        }
      })

      targetPlayers.forEach((player) => {
        const previousPosition = nextPlayersBySession[player.sessionId] ?? player.position
        nextPlayersBySession[player.sessionId] = {
          x: previousPosition.x + (player.position.x - previousPosition.x) * playerLerp,
          y: previousPosition.y + (player.position.y - previousPosition.y) * playerLerp,
        }

        const previousFacing = nextFacingBySession[player.sessionId] ?? 'front-right'
        nextFacingBySession[player.sessionId] = resolveFacingPose(player, previousFacing)
      })

      targetEnemies.forEach((enemyState) => {
        const previousPosition = nextEnemiesById[enemyState.enemyId] ?? {
          x: enemyState.x,
          y: enemyState.y,
        }
        const deltaX = enemyState.x - previousPosition.x
        const deltaY = enemyState.y - previousPosition.y

        nextEnemiesById[enemyState.enemyId] = {
          x: previousPosition.x + deltaX * enemyLerp,
          y: previousPosition.y + deltaY * enemyLerp,
        }

        const previousFacing = nextEnemyFacingById[enemyState.enemyId] ?? 'front-right'
        nextEnemyFacingById[enemyState.enemyId] =
          Math.hypot(deltaX, deltaY) > 0.45
            ? resolveFacingPoseFromVector(deltaX, deltaY)
            : previousFacing
      })

      const currentPlayer = targetPlayers.find((player) => player.userId === currentUserId)
      let nextCameraX = previousState.cameraX
      let nextCameraY = previousState.cameraY

      if (currentPlayer) {
        const animatedCurrentPlayer = nextPlayersBySession[currentPlayer.sessionId] ?? currentPlayer.position
        const nextCamera = resolveCameraPosition(animatedCurrentPlayer, template, viewportSize)
        const cameraLerp = 1 - Math.exp(-delta / template.camera.delayMs)

        nextCameraX = previousState.cameraX + (nextCamera.cameraX - previousState.cameraX) * cameraLerp
        nextCameraY = previousState.cameraY + (nextCamera.cameraY - previousState.cameraY) * cameraLerp
      }

      const nextState: WorldRuntimeState = {
        now,
        roomStartedAt: previousState.roomStartedAt,
        cameraX: nextCameraX,
        cameraY: nextCameraY,
        playersBySession: nextPlayersBySession,
        facingBySession: nextFacingBySession,
        enemiesById: nextEnemiesById,
        enemyFacingById: nextEnemyFacingById,
      }

      runtimeRef.current = nextState
      setRuntime(nextState)
      frameId = window.requestAnimationFrame(tick)
    }

    frameId = window.requestAnimationFrame(tick)
    return () => window.cancelAnimationFrame(frameId)
  }, [currentUserId, template, viewportSize.height, viewportSize.width])

  const playerViews = useMemo(() => {
    return (room?.players ?? []).map((player) => {
      const animatedPosition = runtime.playersBySession[player.sessionId] ?? player.position
      const facingPose = runtime.facingBySession[player.sessionId] ?? 'front-right'
      const frame = getAvatarFrame(player, runtime.now, facingPose)
      const isSelf = player.userId === currentUserId

      return {
        player,
        animatedPosition,
        frame,
        isSelf,
      }
    })
  }, [currentUserId, room?.players, runtime.facingBySession, runtime.now, runtime.playersBySession])

  const enemyCombatOverlayState = useMemo(
    () => getEnemyCombatOverlayState(room, enemyCombatEncounters, runtime.playersBySession),
    [enemyCombatEncounters, room, runtime.playersBySession],
  )

  const visiblePlayerViews = useMemo(
    () =>
      playerViews.filter((playerView) => !enemyCombatOverlayState.hiddenPlayerUserIds.has(playerView.player.userId)),
    [enemyCombatOverlayState.hiddenPlayerUserIds, playerViews],
  )

  const currentPlayerView = useMemo(
    () => visiblePlayerViews.find((playerView) => playerView.isSelf) ?? null,
    [visiblePlayerViews],
  )

  const currentPlayerBounds = useMemo(
    () => (currentPlayerView ? getPlayerColliderBounds(currentPlayerView.animatedPosition) : null),
    [currentPlayerView],
  )

  const combatViews = useMemo(() => {
    return enemyCombatOverlayState.combatViews.map(({ encounter, displayX, displayY }) => {
      const joinable =
        encounter.phase === 'lobby' &&
        !encounter.participants.some((participant) => participant.userId === currentUserId)
      const warningBounds = getCombatEncounterAreaBounds(displayX, displayY, COMBAT_WARNING_AREA)
      const interactionBounds = getCombatEncounterAreaBounds(displayX, displayY, COMBAT_INTERACTION_AREA)
      const state: NpcInteractionState =
        joinable && currentPlayerBounds && overlapsRect(currentPlayerBounds, interactionBounds)
          ? 'interaction'
          : joinable && currentPlayerBounds && overlapsRect(currentPlayerBounds, warningBounds)
            ? 'warning'
            : 'out'
      const iconFrame = joinable
        ? getAnimatedNpcFrame(
            state === 'interaction' ? ['npc-interaction-e-0', 'npc-interaction-e-1'] : ['npc-alert-0', 'npc-alert-1', 'npc-alert-2', 'npc-alert-3'],
            undefined,
            undefined,
            undefined,
            undefined,
            undefined,
            undefined,
            runtime.now,
            400,
          )
        : null

      return {
        encounterId: encounter.encounterId,
        label: encounter.enemyLabel || 'Combate',
        displayX,
        displayY,
        state,
        iconFrame,
        interactive: pointerInteractionEnabled && interactionEnabled && state === 'interaction',
        warningArea: COMBAT_WARNING_AREA,
        interactionArea: COMBAT_INTERACTION_AREA,
      }
    })
  }, [
    currentPlayerBounds,
    currentUserId,
    enemyCombatOverlayState.combatViews,
    interactionEnabled,
    pointerInteractionEnabled,
    runtime.now,
  ])

  const npcViews = useMemo(() => {
    return (template.npcs ?? []).map((npcTemplate) => {
      const patrolPosition = getPatrollingNpcPosition(
        npcTemplate,
        runtime.now,
        runtime.roomStartedAt,
        template.world,
      )
      const resolvedNpcTemplate =
        npcTemplate.patrolArea || npcTemplate.patrolSpeedPxPerSecond
          ? {
              ...npcTemplate,
              x: patrolPosition.x,
              y: patrolPosition.y,
            }
          : npcTemplate
      const warningBounds = getNpcAreaBounds(resolvedNpcTemplate, getNpcWarningArea(resolvedNpcTemplate))
      const interactionBounds = getNpcAreaBounds(resolvedNpcTemplate, getNpcInteractionArea(resolvedNpcTemplate))
      const state: NpcInteractionState =
        currentPlayerBounds && overlapsRect(currentPlayerBounds, interactionBounds)
          ? 'interaction'
          : currentPlayerBounds && overlapsRect(currentPlayerBounds, warningBounds)
            ? 'warning'
            : 'out'

      const spriteFrame = getAnimatedNpcFrame(
        npcTemplate.spriteAssetIds,
        npcTemplate.spriteSheetAssetId,
        npcTemplate.spriteSheetWidth,
        npcTemplate.spriteSheetHeight,
        npcTemplate.spriteFrameWidth,
        npcTemplate.spriteFrameHeight,
        npcTemplate.spriteFrames,
        runtime.now,
        npcTemplate.spriteFrameDurationMs,
      )
      const iconFrame = getAnimatedNpcFrame(
        state === 'interaction' ? npcTemplate.iconInteractionAssetIds : npcTemplate.iconWarningAssetIds,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        runtime.now,
        npcTemplate.iconFrameDurationMs,
      )
      const flipX =
        npcTemplate.patrolArea || npcTemplate.patrolSpeedPxPerSecond
          ? patrolPosition.flipX
          : state !== 'out' && currentPlayerView
            ? resolvedNpcTemplate.x > currentPlayerView.animatedPosition.x
            : false

      return {
        npcTemplate: resolvedNpcTemplate,
        state,
        spriteFrame,
        iconFrame,
        flipX,
      }
    })
  }, [currentPlayerBounds, currentPlayerView, runtime.now, runtime.roomStartedAt, template.npcs, template.world])

  const teleportViews = useMemo(() => {
    return (template.teleports ?? []).map((teleportTemplate) => {
      const warningBounds = getTeleportAreaBounds(teleportTemplate, getTeleportWarningArea(teleportTemplate))
      const interactionBounds = getTeleportAreaBounds(teleportTemplate, getTeleportInteractionArea(teleportTemplate))
      const state: NpcInteractionState =
        currentPlayerBounds && overlapsRect(currentPlayerBounds, interactionBounds)
          ? 'interaction'
          : currentPlayerBounds && overlapsRect(currentPlayerBounds, warningBounds)
            ? 'warning'
            : 'out'

      const iconFrame = getAnimatedNpcFrame(
        state === 'interaction' ? teleportTemplate.iconInteractionAssetIds : teleportTemplate.iconWarningAssetIds,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        runtime.now,
        teleportTemplate.iconFrameDurationMs,
      )

      return {
        teleportTemplate,
        state,
        spriteSrc: teleportTemplate.spriteAssetId ? getWorldSpriteAsset(teleportTemplate.spriteAssetId) : undefined,
        hoverSpriteSrc: teleportTemplate.spriteHoverAssetId
          ? getWorldSpriteAsset(teleportTemplate.spriteHoverAssetId)
          : undefined,
        iconFrame,
      }
    })
  }, [currentPlayerBounds, runtime.now, template.teleports])

  const enemyViews = useMemo(() => {
    return getEnemyViews(
      room,
      template.enemies,
      runtime.now,
      runtime.enemiesById,
      runtime.enemyFacingById,
    ).filter(
      (enemyView) => !enemyCombatOverlayState.hiddenEnemyIds.has(enemyView.enemyTemplate.id),
    )
  }, [
    enemyCombatOverlayState.hiddenEnemyIds,
    room,
    runtime.enemyFacingById,
    runtime.enemiesById,
    runtime.now,
    template.enemies,
  ])
  const blockedEnemyInteractionIdSet = useMemo(
    () => new Set(blockedEnemyInteractionIds),
    [blockedEnemyInteractionIds],
  )

  const activeInteractable = useMemo(() => {
    if (!currentPlayerView) {
      return null
    }

    const interactableCandidates = [
      ...npcViews
        .filter((npcView) => npcView.state === 'interaction' && npcView.npcTemplate.interactionMode !== 'touch')
        .map((npcView) => ({
          template: npcView.npcTemplate as WorldInteractableTarget,
          anchor: getNpcInteractionAnchor(npcView.npcTemplate),
        })),
      ...teleportViews
        .filter((teleportView) => teleportView.state === 'interaction')
        .map((teleportView) => ({
          template: teleportView.teleportTemplate as WorldInteractableTarget,
          anchor: getTeleportInteractionAnchor(teleportView.teleportTemplate),
        })),
      ...combatViews
        .filter((combatView) => combatView.state === 'interaction')
        .map((combatView) => ({
          template: {
            entityType: 'enemy-combat',
            id: combatView.encounterId,
            encounterId: combatView.encounterId,
            label: combatView.label,
          } satisfies CombatEncounterInteractable,
          anchor: {
            x: combatView.displayX,
            y: combatView.displayY,
          },
        })),
    ]

    return (
      interactableCandidates.sort((left, right) => {
        const leftDistance = Math.hypot(
          currentPlayerView.animatedPosition.x - left.anchor.x,
          currentPlayerView.animatedPosition.y - left.anchor.y,
        )
        const rightDistance = Math.hypot(
          currentPlayerView.animatedPosition.x - right.anchor.x,
          currentPlayerView.animatedPosition.y - right.anchor.y,
        )
        return leftDistance - rightDistance
      })[0] ?? null
    )
  }, [combatViews, currentPlayerView, npcViews, teleportViews])

  useEffect(() => {
    onActiveInteractableChange?.(activeInteractable?.template ?? null)
  }, [activeInteractable, onActiveInteractableChange])

  useEffect(() => {
    const nextTouchedNpcIds = new Set<string>()

    npcViews.forEach((npcView) => {
      if (npcView.npcTemplate.interactionMode === 'touch' && npcView.state === 'interaction') {
        nextTouchedNpcIds.add(npcView.npcTemplate.id)

        if (interactionEnabled && onInteract && !touchNpcIdsRef.current.has(npcView.npcTemplate.id)) {
          onInteract(npcView.npcTemplate)
        }
      }
    })

    touchNpcIdsRef.current = nextTouchedNpcIds
  }, [interactionEnabled, npcViews, onInteract])

  useEffect(() => {
    const nextTouchedEnemyIds = new Set<string>()

    if (!currentPlayerBounds) {
      touchEnemyIdsRef.current = nextTouchedEnemyIds
      return
    }

    let didTriggerTouchInteraction = false

    enemyViews.forEach((enemyView) => {
      const enemyId = enemyView.enemyTemplate.id

      if (blockedEnemyInteractionIdSet.has(enemyId)) {
        return
      }

      const directInteractionBounds = getEnemyDirectInteractionBounds(
        enemyView.enemyTemplate,
        enemyView.displayX,
        enemyView.displayY,
      )

      if (!overlapsRect(currentPlayerBounds, directInteractionBounds)) {
        return
      }

      nextTouchedEnemyIds.add(enemyId)

      if (
        interactionEnabled &&
        onEnemyTouchInteract &&
        !didTriggerTouchInteraction &&
        !touchEnemyIdsRef.current.has(enemyId)
      ) {
        didTriggerTouchInteraction = true
        onEnemyTouchInteract(enemyView.enemyTemplate)
      }
    })

    touchEnemyIdsRef.current = nextTouchedEnemyIds
  }, [blockedEnemyInteractionIdSet, currentPlayerBounds, enemyViews, interactionEnabled, onEnemyTouchInteract])

  useEffect(() => {
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

      if (isTyping || !interactionEnabled || !activeInteractable) {
        return
      }

      event.preventDefault()

      if (onInteract) {
        onInteract(activeInteractable.template)
        return
      }

      console.info('[WORLD] Interaccion activada', {
        interactableId: activeInteractable.template.id,
        interactionId:
          'interactionId' in activeInteractable.template ? activeInteractable.template.interactionId ?? null : null,
      })
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [activeInteractable, interactionEnabled, onInteract])

  const renderItems = useMemo(
    () =>
      getPerspectiveAwareRenderItems(
        template,
        teleportViews,
        visiblePlayerViews,
        npcViews,
        enemyViews,
        combatViews,
      ),
    [combatViews, enemyViews, npcViews, template, teleportViews, visiblePlayerViews],
  )
  const backgroundAsset = getRoomBackgroundAsset(template.id)

  const handleWorldPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!navigationEnabled) {
      return
    }

    const rect = event.currentTarget.getBoundingClientRect()
    const worldX = runtime.cameraX + (event.clientX - rect.left)
    const worldY = runtime.cameraY + (event.clientY - rect.top)
    const target = {
      x: clamp(worldX, 32, template.world.width - 32),
      y: clamp(worldY, 24, template.world.height - 20),
    }

    onNavigate(target)
  }

  return (
    <div ref={viewportRef} className="react-world-viewport" onPointerDown={handleWorldPointerDown}>
      <div
        className="react-world-surface"
        style={{
          width: `${template.world.width}px`,
          height: `${template.world.height}px`,
          backgroundColor: colorToCss(template.world.backgroundColor, '#dfe8d2'),
          transform: `translate(${-runtime.cameraX}px, ${-runtime.cameraY}px)`,
        }}
      >
        {backgroundAsset ? (
          <img
            className="react-world-background"
            src={backgroundAsset}
            alt=""
            draggable={false}
          />
        ) : null}

        {debugEnabled ? (
          <svg className="react-world-routes" width={template.world.width} height={template.world.height}>
            {(room?.players ?? []).map((player) => {
              if (!player.route || player.route.waypoints.length < 2) {
                return null
              }

              const points = [player.position, ...player.route.waypoints]
              const color = player.userId === currentUserId ? '#ff8d3a' : '#2574ff'
              const radius = player.userId === currentUserId ? 12 : 8
              const opacity = player.userId === currentUserId ? 0.85 : 0.45
              const pathDefinition = points.map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x} ${point.y}`).join(' ')
              const target = points[points.length - 1]

              return (
                <g key={`${player.sessionId}-route`}>
                  <path
                    d={pathDefinition}
                    fill="none"
                    stroke={color}
                    strokeWidth={player.userId === currentUserId ? 4 : 2}
                    strokeOpacity={opacity}
                    strokeLinejoin="round"
                    strokeLinecap="round"
                  />
                  <circle
                    cx={target.x}
                    cy={target.y}
                    r={radius}
                    fill={color}
                    fillOpacity={player.userId === currentUserId ? 0.22 : 0.12}
                  />
                </g>
              )
            })}
          </svg>
        ) : null}

        {renderItems.map((item, index) => {
          if (item.kind === 'object') {
            return (
              <div key={item.key} style={{ position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 20 + index }}>
                <ObjectDecoration objectTemplate={item.objectTemplate} spriteSrc={item.spriteSrc} debugEnabled={debugEnabled} />
              </div>
            )
          }

          if (item.kind === 'teleport') {
            const teleportAllowsPointerInteraction =
              pointerInteractionEnabled && interactionEnabled && item.state === 'interaction'

            return (
              <div
                key={item.key}
                style={{
                  position: 'absolute',
                  inset: 0,
                  pointerEvents: teleportAllowsPointerInteraction ? 'auto' : 'none',
                  zIndex: 20 + index,
                }}
              >
                <WorldTeleport
                  teleportTemplate={item.teleportTemplate}
                  debugEnabled={debugEnabled}
                  state={item.state}
                  spriteSrc={item.spriteSrc}
                  hoverSpriteSrc={item.hoverSpriteSrc}
                  iconFrame={item.iconFrame}
                  hideIcon={suppressInteractionIconForId === item.teleportTemplate.id}
                  interactive={teleportAllowsPointerInteraction}
                  onInteractClick={
                    teleportAllowsPointerInteraction && onInteract
                      ? () => onInteract(item.teleportTemplate)
                      : undefined
                  }
                />
              </div>
            )
          }

          if (item.kind === 'npc') {
            const npcAllowsPointerInteraction =
              pointerInteractionEnabled && interactionEnabled && item.state === 'interaction'

            return (
              <div
                key={item.key}
                style={{
                  position: 'absolute',
                  inset: 0,
                  pointerEvents: npcAllowsPointerInteraction ? 'auto' : 'none',
                  zIndex: 20 + index,
                }}
              >
                <WorldNpc
                  npcTemplate={item.npcTemplate}
                  debugEnabled={debugEnabled}
                  state={item.state}
                  spriteFrame={item.spriteFrame}
                  iconFrame={item.iconFrame}
                  flipX={item.flipX}
                  hideIcon={suppressInteractionIconForId === item.npcTemplate.id}
                  interactive={npcAllowsPointerInteraction}
                  onInteractClick={
                    npcAllowsPointerInteraction && onInteract
                      ? () => onInteract(item.npcTemplate)
                      : undefined
                  }
                />
              </div>
            )
          }

          if (item.kind === 'enemy') {
            return (
              <div
                key={item.key}
                style={{
                  position: 'absolute',
                  inset: 0,
                  pointerEvents: 'none',
                  zIndex: 20 + index,
                }}
              >
                <Enemigo
                  enemyTemplate={item.enemyTemplate}
                  debugEnabled={debugEnabled}
                  displayX={item.displayX}
                  displayY={item.displayY}
                  spriteFrame={item.spriteFrame}
                  flipX={item.flipX}
                  showIcon={item.showIcon}
                />
              </div>
            )
          }

          if (item.kind === 'combat') {
            return (
              <div
                key={item.key}
                style={{
                  position: 'absolute',
                  inset: 0,
                  pointerEvents: item.interactive ? 'auto' : 'none',
                  zIndex: 20 + index,
                }}
              >
                <WorldCombatEncounter
                  displayX={item.displayX}
                  displayY={item.displayY}
                  state={item.state}
                  iconFrame={item.iconFrame}
                  interactive={item.interactive}
                  debugEnabled={debugEnabled}
                  warningArea={item.warningArea}
                  interactionArea={item.interactionArea}
                  onInteractClick={
                    item.interactive && onInteract
                      ? () =>
                          onInteract({
                            entityType: 'enemy-combat',
                            id: item.encounterId,
                            encounterId: item.encounterId,
                            label: item.label,
                          })
                      : undefined
                  }
                />
              </div>
            )
          }

          return (
            <div key={item.key} style={{ position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 20 + index }}>
              <WorldPlayer
                player={item.player}
                displayX={item.animatedPosition.x}
                displayY={item.animatedPosition.y}
                isSelf={item.isSelf}
                playerIdentityMode={playerIdentityMode}
                speechText={activeSpeechByUserId[item.player.userId] ?? null}
                isTyping={Boolean(typingByUserId[item.player.userId])}
                typingIndicatorText={typingIndicatorText}
                frame={item.frame}
                debugEnabled={debugEnabled}
              />
            </div>
          )
        })}
      </div>
    </div>
  )
}

export default ReactWorld
