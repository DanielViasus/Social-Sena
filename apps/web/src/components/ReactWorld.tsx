import { useEffect, useMemo, useRef, useState } from 'react'
import type { Position, Presence, RoomObjectTemplate, RoomState, RoomTemplate } from '@social-sena/shared'
import { resolveAvatarPreset } from '../game/avatar/avatarSprites'

interface ReactWorldProps {
  room: RoomState | null
  currentUserId: string
  template: RoomTemplate
  onNavigate: (target: Position) => void
  debugEnabled: boolean
}

interface AnimatedPlayerPosition {
  x: number
  y: number
}

interface WorldRuntimeState {
  now: number
  cameraX: number
  cameraY: number
  playersBySession: Record<string, AnimatedPlayerPosition>
}

const PLAYER_FOOT_WIDTH = 30
const PLAYER_FOOT_HEIGHT = 14

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max)
}

function colorToCss(value: number | undefined, fallback: string) {
  if (typeof value !== 'number') {
    return fallback
  }

  return `#${value.toString(16).padStart(6, '0')}`
}

function getObjectSortY(objectTemplate: RoomObjectTemplate) {
  if (typeof objectTemplate.depthOffsetY === 'number') {
    return objectTemplate.y + objectTemplate.depthOffsetY
  }

  if (objectTemplate.collider) {
    return objectTemplate.y + objectTemplate.collider.offsetY + objectTemplate.collider.height / 2
  }

  return objectTemplate.y + objectTemplate.height / 2
}

function getAvatarFrame(player: Presence, now: number) {
  const preset = resolveAvatarPreset(player.skinId)
  const routeStart = player.route?.start ?? player.position
  const routeTarget = player.route?.target ?? player.destination ?? player.position
  const deltaX = routeTarget.x - routeStart.x
  const deltaY = routeTarget.y - routeStart.y
  const useBackWalk = player.moving && deltaY < 0 && Math.abs(deltaY) >= Math.abs(deltaX) * 0.65
  const flipX = deltaX < 0
  const frames = player.moving
    ? useBackWalk && preset.walkBackFrames?.length
      ? preset.walkBackFrames
      : preset.walkFrames
    : preset.idleFrames
  const frameDuration = 200
  const frameIndex = Math.floor(now / frameDuration) % frames.length

  return {
    preset,
    texture: frames[frameIndex],
    frameIndex,
    flipX,
  }
}

function ReactWorld({ room, currentUserId, template, onNavigate, debugEnabled }: ReactWorldProps) {
  const viewportRef = useRef<HTMLDivElement | null>(null)
  const runtimeRef = useRef<WorldRuntimeState>({
    now: performance.now(),
    cameraX: 0,
    cameraY: 0,
    playersBySession: {},
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
      const targetPlayers = room?.players ?? []
      const activeSessionIds = new Set(targetPlayers.map((player) => player.sessionId))
      const playerLerp = 1 - Math.exp(-delta / 120)

      Object.keys(nextPlayersBySession).forEach((sessionId) => {
        if (!activeSessionIds.has(sessionId)) {
          delete nextPlayersBySession[sessionId]
        }
      })

      targetPlayers.forEach((player) => {
        const previousPosition = nextPlayersBySession[player.sessionId] ?? player.position
        nextPlayersBySession[player.sessionId] = {
          x: previousPosition.x + (player.position.x - previousPosition.x) * playerLerp,
          y: previousPosition.y + (player.position.y - previousPosition.y) * playerLerp,
        }
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
      const frame = getAvatarFrame(player, runtime.now)
      const isSelf = player.userId === currentUserId

      return {
        player,
        animatedPosition,
        frame,
        isSelf,
      }
    })
  }, [currentUserId, room?.players, runtime.now, runtime.playersBySession])

  const handleWorldPointerDown = (event: React.MouseEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect()
    const worldX = runtime.cameraX + (event.clientX - rect.left)
    const worldY = runtime.cameraY + (event.clientY - rect.top)

    onNavigate({
      x: clamp(worldX, 32, template.world.width - 32),
      y: clamp(worldY, 24, template.world.height - 20),
    })
  }

  return (
    <div ref={viewportRef} className="react-world-viewport" onMouseDown={handleWorldPointerDown}>
      <div
        className="react-world-surface"
        style={{
          width: `${template.world.width}px`,
          height: `${template.world.height}px`,
          backgroundColor: colorToCss(template.world.backgroundColor, '#dfe8d2'),
          transform: `translate3d(${-runtime.cameraX}px, ${-runtime.cameraY}px, 0)`,
        }}
      >
        {template.id === 'Room_1909' ? (
          <>
            <div className="plaza-ring plaza-ring-outer" />
            <div className="plaza-ring plaza-ring-inner" />
            <div className="plaza-axis plaza-axis-vertical" />
            <div className="plaza-axis plaza-axis-horizontal" />
            <div className="plaza-ellipse" />
          </>
        ) : null}

        {debugEnabled ? (
          <svg className="react-world-routes" width={template.world.width} height={template.world.height}>
            {(room?.players ?? []).map((player) => {
              if (!player.route || player.route.waypoints.length < 2) {
                return null
              }

              const [start, target] = player.route.waypoints
              const color = player.userId === currentUserId ? '#ff8d3a' : '#2574ff'
              const radius = player.userId === currentUserId ? 12 : 8
              const opacity = player.userId === currentUserId ? 0.85 : 0.45

              return (
                <g key={`${player.sessionId}-route`}>
                  <line
                    x1={start.x}
                    y1={start.y}
                    x2={target.x}
                    y2={target.y}
                    stroke={color}
                    strokeWidth={player.userId === currentUserId ? 4 : 2}
                    strokeOpacity={opacity}
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

        {template.objects.map((objectTemplate) => {
          const sortY = getObjectSortY(objectTemplate)
          const hasVisual = (objectTemplate.opacity ?? (objectTemplate.blocksMovement ? 0.9 : 0.72)) > 0.02 || objectTemplate.label
          const collider = objectTemplate.collider ?? {
            offsetX: 0,
            offsetY: 0,
            width: objectTemplate.width,
            height: objectTemplate.height,
          }

          return (
            <div key={objectTemplate.id} style={{ position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: Math.round(80 + sortY) }}>
              {hasVisual ? (
                <>
                  <div
                    className="react-world-object-shadow"
                    style={{
                      left: `${objectTemplate.x}px`,
                      top: `${sortY + 6}px`,
                      width: `${Math.max(56, objectTemplate.width * 0.65)}px`,
                    }}
                  />
                  <div
                    className={`react-world-object react-world-object-${objectTemplate.kind}`}
                    style={{
                      left: `${objectTemplate.x}px`,
                      top: `${objectTemplate.y}px`,
                      width: `${objectTemplate.width}px`,
                      height: `${objectTemplate.height}px`,
                      background: colorToCss(objectTemplate.fillColor, '#17304a'),
                      borderColor: colorToCss(objectTemplate.strokeColor, '#ffffff'),
                      opacity: objectTemplate.opacity ?? (objectTemplate.blocksMovement ? 0.9 : 0.72),
                    }}
                  >
                    {objectTemplate.id === 'fountain-core' ? <div className="react-world-fountain-water" /> : null}
                  </div>
                  {objectTemplate.label ? (
                    <div
                      className="react-world-object-label"
                      style={{
                        left: `${objectTemplate.x}px`,
                        top: `${objectTemplate.y - objectTemplate.height / 2 - 26}px`,
                      }}
                    >
                      {objectTemplate.label}
                    </div>
                  ) : null}
                </>
              ) : null}

              {debugEnabled ? (
                <div
                  className={`react-world-debug-collider ${objectTemplate.blocksMovement ? 'is-blocking' : 'is-passable'}`}
                  style={{
                    left: `${objectTemplate.x + collider.offsetX - collider.width / 2}px`,
                    top: `${objectTemplate.y + collider.offsetY - collider.height / 2}px`,
                    width: `${collider.width}px`,
                    height: `${collider.height}px`,
                  }}
                >
                  <span
                    className="react-world-debug-dot"
                    style={{ left: `${collider.width / 2 - 4}px`, top: `${collider.height / 2 - 4}px` }}
                  />
                </div>
              ) : null}
            </div>
          )
        })}

        {playerViews.map(({ player, animatedPosition, frame, isSelf }) => (
          <div
            key={player.sessionId}
            className="react-world-avatar"
            style={{
              left: `${animatedPosition.x}px`,
              top: `${animatedPosition.y}px`,
              zIndex: Math.round(100 + animatedPosition.y),
            }}
          >
            <div className={`react-world-avatar-glow ${isSelf ? 'is-self' : ''}`} />
            <img
              src={frame.texture.url}
              alt={player.displayName}
              draggable={false}
              className="react-world-avatar-sprite"
              style={{
                width: `${32 * frame.preset.scale}px`,
                height: `${32 * frame.preset.scale}px`,
                transform: frame.flipX ? 'scaleX(-1)' : 'scaleX(1)',
              }}
            />
            <div className={`react-world-avatar-label ${isSelf ? 'is-self' : ''}`}>{player.displayName}</div>
            {debugEnabled ? (
              <div
                className={`react-world-debug-player ${isSelf ? 'is-self' : 'is-other'}`}
                style={{
                  left: `${-PLAYER_FOOT_WIDTH / 2}px`,
                  top: `${-PLAYER_FOOT_HEIGHT}px`,
                  width: `${PLAYER_FOOT_WIDTH}px`,
                  height: `${PLAYER_FOOT_HEIGHT}px`,
                }}
              >
                <span className="react-world-debug-dot" style={{ left: `${PLAYER_FOOT_WIDTH / 2 - 4}px`, top: `${PLAYER_FOOT_HEIGHT / 2 - 4}px` }} />
              </div>
            ) : null}
          </div>
        ))}
      </div>
    </div>
  )
}

export default ReactWorld
