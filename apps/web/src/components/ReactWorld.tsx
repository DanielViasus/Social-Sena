import { useEffect, useMemo, useRef, useState } from 'react'
import type {
  Position,
  Presence,
  RoomNpcTemplate,
  RoomObjectTemplate,
  RoomState,
  RoomTemplate
} from '@social-sena/shared'
import { resolveAvatarPreset } from '../game/avatar/avatarSprites'
import bkGarden from '../assets/Places/bk_garden.svg'
import plazaSeparator1 from '../assets/Decoration/Plaza/Separador_Plaza_1.svg'
import plazaSeparator2 from '../assets/Decoration/Plaza/Separador_Plaza_2.svg'
import plazaSeparator3 from '../assets/Decoration/Plaza/Separador_Plaza_3.svg'
import plazaSeparator4 from '../assets/Decoration/Plaza/Separador_Plaza_4.svg'
import npcMagoFrame0 from '../assets/npc/mago/NPC_MAGO_FRAME_0.svg'
import npcMagoFrame1 from '../assets/npc/mago/NPC_MAGO_FRAME_1.svg'
import npcMagoFrame2 from '../assets/npc/mago/NPC_MAGO_FRAME_2.svg'
import npcMagoFrame3 from '../assets/npc/mago/NPC_MAGO_FRAME_3.svg'
import npcAlert0 from '../assets/npc/icons/alert/ALERT_0.svg'
import npcAlert1 from '../assets/npc/icons/alert/ALERT_1.svg'
import npcAlert2 from '../assets/npc/icons/alert/ALERT_2.svg'
import npcAlert3 from '../assets/npc/icons/alert/ALERT_3.svg'
import npcInteractionE0 from '../assets/npc/icons/interaction/INTERACTION_E_0.svg'
import npcInteractionE1 from '../assets/npc/icons/interaction/INTERACTION_E_1.svg'
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

interface ReactWorldProps {
  room: RoomState | null
  currentUserId: string
  template: RoomTemplate
  onNavigate: (target: Position) => void
  debugEnabled: boolean
  onNpcInteract?: (npc: RoomNpcTemplate) => void
  onActiveInteractableNpcChange?: (npc: RoomNpcTemplate | null) => void
  navigationEnabled?: boolean
  npcInteractionEnabled?: boolean
  suppressNpcIconForId?: string | null
  pointerNpcInteractionEnabled?: boolean
}

interface AnimatedPlayerPosition {
  x: number
  y: number
}

type FacingPose = 'front-right' | 'front-left' | 'back-right' | 'back-left'

interface WorldRuntimeState {
  now: number
  cameraX: number
  cameraY: number
  playersBySession: Record<string, AnimatedPlayerPosition>
  facingBySession: Record<string, FacingPose>
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

const ROOM_OBJECT_SPRITES: Record<string, string> = {
  'plaza-separator-1': plazaSeparator1,
  'plaza-separator-2': plazaSeparator2,
  'plaza-separator-3': plazaSeparator3,
  'plaza-separator-4': plazaSeparator4,
}

const CROCK_PRESET = resolveAvatarPreset('crock')
const NPC_SPRITES: Record<string, string> = Object.fromEntries(
  [
    ...CROCK_PRESET.idleFrames,
    ...(CROCK_PRESET.idleBackFrames ?? []),
    ...CROCK_PRESET.walkFrames,
    ...(CROCK_PRESET.walkBackFrames ?? []),
  ].map((frame) => [frame.key, frame.url]),
)

NPC_SPRITES['npc-mago-frame-0'] = npcMagoFrame0
NPC_SPRITES['npc-mago-frame-1'] = npcMagoFrame1
NPC_SPRITES['npc-mago-frame-2'] = npcMagoFrame2
NPC_SPRITES['npc-mago-frame-3'] = npcMagoFrame3
NPC_SPRITES['npc-alert-0'] = npcAlert0
NPC_SPRITES['npc-alert-1'] = npcAlert1
NPC_SPRITES['npc-alert-2'] = npcAlert2
NPC_SPRITES['npc-alert-3'] = npcAlert3
NPC_SPRITES['npc-interaction-e-0'] = npcInteractionE0
NPC_SPRITES['npc-interaction-e-1'] = npcInteractionE1

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max)
}

function colorToCss(value: number | undefined, fallback: string) {
  if (typeof value !== 'number') {
    return fallback
  }

  return `#${value.toString(16).padStart(6, '0')}`
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

function getAnimatedNpcFrame(
  assetIds: string[] | undefined,
  now: number,
  frameDurationMs: number | undefined,
): WorldNpcFrameDefinition | null {
  const frames = (assetIds ?? [])
    .map((assetId) => {
      const url = NPC_SPRITES[assetId]
      return url ? { key: assetId, url } : null
    })
    .filter((frame): frame is WorldNpcFrameDefinition => Boolean(frame))

  if (frames.length === 0) {
    return null
  }

  const frameDuration = Math.max(80, frameDurationMs ?? 180)
  const frameIndex = Math.floor(now / frameDuration) % frames.length
  return frames[frameIndex]
}

function getAvatarFrame(player: Presence, now: number, facingPose: FacingPose) {
  const preset = resolveAvatarPreset(player.skinId)
  const useBack = facingPose === 'back-left' || facingPose === 'back-right'
  const flipX = facingPose === 'front-left' || facingPose === 'back-left'
  const frames = player.moving
    ? useBack && preset.walkBackFrames?.length
      ? preset.walkBackFrames
      : preset.walkFrames
    : useBack && preset.idleBackFrames?.length
      ? preset.idleBackFrames
      : preset.idleFrames
  const frameDuration = 160
  const frameIndex = Math.floor(now / frameDuration) % frames.length

  return {
    preset,
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
) {
  const objectItems: RenderLayerItem[] = template.objects.map((objectTemplate) => ({
    kind: 'object',
    key: objectTemplate.id,
    perspectiveY: getObjectPerspectiveY(objectTemplate),
    objectTemplate,
    spriteSrc: objectTemplate.spriteAssetId ? ROOM_OBJECT_SPRITES[objectTemplate.spriteAssetId] : undefined,
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

  const layerPriority: Record<RenderLayerItem['kind'], number> = {
    object: 0,
    npc: 1,
    player: 2,
  }

  return [...objectItems, ...npcItems, ...playerItems].sort((left, right) => {
    if (left.perspectiveY !== right.perspectiveY) {
      return left.perspectiveY - right.perspectiveY
    }

    if (left.kind === right.kind) {
      return left.key.localeCompare(right.key)
    }

    return layerPriority[left.kind] - layerPriority[right.kind]
  })
}

function ReactWorld({
  room,
  currentUserId,
  template,
  onNavigate,
  debugEnabled,
  onNpcInteract,
  onActiveInteractableNpcChange,
  navigationEnabled = true,
  npcInteractionEnabled = true,
  suppressNpcIconForId = null,
  pointerNpcInteractionEnabled = false,
}: ReactWorldProps) {
  const viewportRef = useRef<HTMLDivElement | null>(null)
  const runtimeRef = useRef<WorldRuntimeState>({
    now: performance.now(),
    cameraX: 0,
    cameraY: 0,
    playersBySession: {},
    facingBySession: {},
  })
  const [viewportSize, setViewportSize] = useState({ width: 1600, height: 900 })
  const [runtime, setRuntime] = useState<WorldRuntimeState>(runtimeRef.current)

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
    let frameId = 0
    let previousTime = performance.now()

    const tick = (now: number) => {
      const delta = now - previousTime
      previousTime = now

      const previousState = runtimeRef.current
      const nextPlayersBySession: Record<string, AnimatedPlayerPosition> = { ...previousState.playersBySession }
      const nextFacingBySession: Record<string, FacingPose> = { ...previousState.facingBySession }
      const targetPlayers = room?.players ?? []
      const activeSessionIds = new Set(targetPlayers.map((player) => player.sessionId))
      const playerLerp = 1 - Math.exp(-delta / 120)

      Object.keys(nextPlayersBySession).forEach((sessionId) => {
        if (!activeSessionIds.has(sessionId)) {
          delete nextPlayersBySession[sessionId]
          delete nextFacingBySession[sessionId]
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

      const currentPlayer = targetPlayers.find((player) => player.userId === currentUserId)
      let nextCameraX = previousState.cameraX
      let nextCameraY = previousState.cameraY

      if (currentPlayer) {
        const animatedCurrentPlayer = nextPlayersBySession[currentPlayer.sessionId] ?? currentPlayer.position
        const targetCenterX = animatedCurrentPlayer.x + template.camera.offsetX
        const targetCenterY = animatedCurrentPlayer.y + template.camera.offsetY
        const unclampedCameraX = targetCenterX - viewportSize.width / 2
        const unclampedCameraY = targetCenterY - viewportSize.height / 2

        const maxCameraX = Math.max(0, template.world.width - viewportSize.width)
        const maxCameraY = Math.max(0, template.world.height - viewportSize.height)
        const desiredCameraX = template.camera.clampBorders ? clamp(unclampedCameraX, 0, maxCameraX) : unclampedCameraX
        const desiredCameraY = template.camera.clampBorders ? clamp(unclampedCameraY, 0, maxCameraY) : unclampedCameraY
        const cameraLerp = 1 - Math.exp(-delta / template.camera.delayMs)

        nextCameraX = previousState.cameraX + (desiredCameraX - previousState.cameraX) * cameraLerp
        nextCameraY = previousState.cameraY + (desiredCameraY - previousState.cameraY) * cameraLerp
      }

      const nextState: WorldRuntimeState = {
        now,
        cameraX: nextCameraX,
        cameraY: nextCameraY,
        playersBySession: nextPlayersBySession,
        facingBySession: nextFacingBySession,
      }

      runtimeRef.current = nextState
      setRuntime(nextState)
      frameId = window.requestAnimationFrame(tick)
    }

    frameId = window.requestAnimationFrame(tick)
    return () => window.cancelAnimationFrame(frameId)
  }, [currentUserId, room, template, viewportSize.height, viewportSize.width])

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

  const currentPlayerView = useMemo(
    () => playerViews.find((playerView) => playerView.isSelf) ?? null,
    [playerViews],
  )

  const currentPlayerBounds = useMemo(
    () => (currentPlayerView ? getPlayerColliderBounds(currentPlayerView.animatedPosition) : null),
    [currentPlayerView],
  )

  const npcViews = useMemo(() => {
    return (template.npcs ?? []).map((npcTemplate) => {
      const warningBounds = getNpcAreaBounds(npcTemplate, getNpcWarningArea(npcTemplate))
      const interactionBounds = getNpcAreaBounds(npcTemplate, getNpcInteractionArea(npcTemplate))
      const state: NpcInteractionState =
        currentPlayerBounds && overlapsRect(currentPlayerBounds, interactionBounds)
          ? 'interaction'
          : currentPlayerBounds && overlapsRect(currentPlayerBounds, warningBounds)
            ? 'warning'
            : 'out'

      const spriteFrame = getAnimatedNpcFrame(
        npcTemplate.spriteAssetIds,
        runtime.now,
        npcTemplate.spriteFrameDurationMs,
      )
      const iconFrame = getAnimatedNpcFrame(
        state === 'interaction' ? npcTemplate.iconInteractionAssetIds : npcTemplate.iconWarningAssetIds,
        runtime.now,
        npcTemplate.iconFrameDurationMs,
      )
      const flipX =
        state !== 'out' && currentPlayerView
          ? npcTemplate.x > currentPlayerView.animatedPosition.x
          : false

      return {
        npcTemplate,
        state,
        spriteFrame,
        iconFrame,
        flipX,
      }
    })
  }, [currentPlayerBounds, runtime.now, template.npcs])

  const activeInteractableNpc = useMemo(() => {
    if (!currentPlayerView) {
      return null
    }

    return npcViews
      .filter((npcView) => npcView.state === 'interaction')
      .sort((left, right) => {
        const leftDistance = Math.hypot(
          currentPlayerView.animatedPosition.x - left.npcTemplate.x,
          currentPlayerView.animatedPosition.y - left.npcTemplate.y,
        )
        const rightDistance = Math.hypot(
          currentPlayerView.animatedPosition.x - right.npcTemplate.x,
          currentPlayerView.animatedPosition.y - right.npcTemplate.y,
        )
        return leftDistance - rightDistance
      })[0] ?? null
  }, [currentPlayerView, npcViews])

  useEffect(() => {
    onActiveInteractableNpcChange?.(activeInteractableNpc?.npcTemplate ?? null)
  }, [activeInteractableNpc, onActiveInteractableNpcChange])

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

      if (isTyping || !npcInteractionEnabled || !activeInteractableNpc) {
        return
      }

      event.preventDefault()

      if (onNpcInteract) {
        onNpcInteract(activeInteractableNpc.npcTemplate)
        return
      }

      console.info('[NPC] Interaccion activada', {
        npcId: activeInteractableNpc.npcTemplate.id,
        interactionId: activeInteractableNpc.npcTemplate.interactionId ?? null,
      })
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [activeInteractableNpc, npcInteractionEnabled, onNpcInteract])

  const renderItems = useMemo(
    () => getPerspectiveAwareRenderItems(template, playerViews, npcViews),
    [template, playerViews, npcViews],
  )

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
          backgroundImage: template.id === 'Room_1909' ? `url(${bkGarden})` : undefined,
          backgroundSize: template.id === 'Room_1909' ? '100% 100%' : undefined,
          backgroundRepeat: template.id === 'Room_1909' ? 'no-repeat' : undefined,
          backgroundPosition: template.id === 'Room_1909' ? 'center center' : undefined,
          transform: `translate3d(${-runtime.cameraX}px, ${-runtime.cameraY}px, 0)`,
        }}
      >
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

          if (item.kind === 'npc') {
            const npcAllowsPointerInteraction =
              pointerNpcInteractionEnabled && npcInteractionEnabled && item.state === 'interaction'

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
                  hideIcon={suppressNpcIconForId === item.npcTemplate.id}
                  interactive={npcAllowsPointerInteraction}
                  onInteractClick={
                    npcAllowsPointerInteraction && onNpcInteract
                      ? () => onNpcInteract(item.npcTemplate)
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
