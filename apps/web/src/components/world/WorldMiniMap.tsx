import { memo, useId, useMemo } from 'react'
import type { Position, RoomTemplate } from '@social-sena/shared'
import { getObjectColliderBoundsList } from './ObjectDecoration'

interface WorldMiniMapMarker extends Position {
  id: string
}

interface WorldMiniMapPlayerMarker extends WorldMiniMapMarker {
  isSelf: boolean
}

interface WorldMiniMapProps {
  template: RoomTemplate
  players: WorldMiniMapPlayerMarker[]
  enemies: WorldMiniMapMarker[]
  npcs: WorldMiniMapMarker[]
  camera: {
    x: number
    y: number
    width: number
    height: number
  }
}

interface MiniMapBounds {
  left: number
  right: number
  top: number
  bottom: number
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value))
}

function colorToCss(value: number | undefined, fallback: string) {
  if (typeof value !== 'number') {
    return fallback
  }

  return `#${value.toString(16).padStart(6, '0')}`
}

function getVisualBounds(x: number, y: number, width: number, height: number): MiniMapBounds {
  return {
    left: x - width / 2,
    right: x + width / 2,
    top: y - height / 2,
    bottom: y + height / 2,
  }
}

function boundsToPath(bounds: MiniMapBounds) {
  const width = Math.max(0, bounds.right - bounds.left)
  const height = Math.max(0, bounds.bottom - bounds.top)
  return `M${bounds.left} ${bounds.top}h${width}v${height}h-${width}Z`
}

function createBoundsPath(bounds: MiniMapBounds[]) {
  return bounds.map(boundsToPath).join('')
}

function WorldMiniMap({ template, players, enemies, npcs, camera }: WorldMiniMapProps) {
  const rawClipId = useId()
  const clipId = `world-minimap-${rawClipId.replace(/:/g, '')}`
  const { width: worldWidth, height: worldHeight } = template.world
  const minimumWorldDimension = Math.min(worldWidth, worldHeight)
  const markerRadius = clamp(minimumWorldDimension * 0.012, 18, 46)
  const markerStrokeWidth = clamp(minimumWorldDimension * 0.003, 5, 12)

  const geometry = useMemo(() => {
    const wallBounds: MiniMapBounds[] = []
    const doorBounds: MiniMapBounds[] = []
    const obstacleBounds: MiniMapBounds[] = []

    template.objects.forEach((objectTemplate) => {
      if (objectTemplate.kind === 'floor' || objectTemplate.kind === 'zone') {
        return
      }

      const colliderBounds = getObjectColliderBoundsList(objectTemplate)
      const resolvedBounds = colliderBounds.length > 0
        ? colliderBounds
        : [getVisualBounds(
            objectTemplate.x,
            objectTemplate.y,
            objectTemplate.width,
            objectTemplate.height,
          )]

      if (objectTemplate.kind === 'wall') {
        wallBounds.push(...resolvedBounds)
        return
      }

      if (objectTemplate.kind === 'door') {
        doorBounds.push(...resolvedBounds)
        return
      }

      if (colliderBounds.length > 0) {
        obstacleBounds.push(...colliderBounds)
      }
    })

    const spawnPositions = [
      template.world.spawn,
      ...(template.world.entrySpawns ?? []).map((entrySpawn) => entrySpawn.position),
    ].filter((position, index, positions) => (
      positions.findIndex((candidate) => candidate.x === position.x && candidate.y === position.y) === index
    ))

    return {
      wallPath: createBoundsPath(wallBounds),
      doorPath: createBoundsPath(doorBounds),
      obstaclePath: createBoundsPath(obstacleBounds),
      spawnPositions,
    }
  }, [template.objects, template.world.entrySpawns, template.world.spawn])

  const cameraViewport = {
    x: clamp(camera.x, 0, worldWidth),
    y: clamp(camera.y, 0, worldHeight),
    width: Math.min(camera.width, worldWidth),
    height: Math.min(camera.height, worldHeight),
  }
  cameraViewport.x = Math.min(cameraViewport.x, worldWidth - cameraViewport.width)
  cameraViewport.y = Math.min(cameraViewport.y, worldHeight - cameraViewport.height)

  const selfPlayer = players.find((player) => player.isSelf) ?? null
  const otherPlayers = players.filter((player) => !player.isSelf)
  const portalSize = markerRadius * 2.1
  const spawnSize = markerRadius * 1.6

  return (
    <aside
      className="world-minimap"
      role="img"
      aria-label={`Minimapa de ${template.name}`}
      onPointerDown={(event) => event.stopPropagation()}
    >
      <svg
        className="world-minimap-svg"
        viewBox={`0 0 ${worldWidth} ${worldHeight}`}
        preserveAspectRatio="xMidYMid meet"
        aria-hidden="true"
      >
        <defs>
          <clipPath id={clipId}>
            <rect width={worldWidth} height={worldHeight} />
          </clipPath>
        </defs>

        <g clipPath={`url(#${clipId})`}>
          <rect
            width={worldWidth}
            height={worldHeight}
            fill={colorToCss(template.world.backgroundColor, '#85937d')}
            className="world-minimap-ground"
          />

          {geometry.obstaclePath ? (
            <path d={geometry.obstaclePath} className="world-minimap-obstacles" />
          ) : null}
          {geometry.wallPath ? (
            <path d={geometry.wallPath} className="world-minimap-walls" />
          ) : null}
          {geometry.doorPath ? (
            <path d={geometry.doorPath} className="world-minimap-doors" />
          ) : null}

          <rect
            x={cameraViewport.x}
            y={cameraViewport.y}
            width={cameraViewport.width}
            height={cameraViewport.height}
            className="world-minimap-camera"
            vectorEffect="non-scaling-stroke"
          />

          {geometry.spawnPositions.map((position, index) => (
            <g
              key={`spawn-${position.x}-${position.y}-${index}`}
              className="world-minimap-spawn"
              transform={`translate(${position.x} ${position.y})`}
            >
              <path
                d={`M${-spawnSize} 0H${spawnSize}M0 ${-spawnSize}V${spawnSize}`}
                vectorEffect="non-scaling-stroke"
              />
              <circle r={spawnSize * 0.72} vectorEffect="non-scaling-stroke" />
            </g>
          ))}

          {(template.teleports ?? []).map((teleport) => (
            <rect
              key={teleport.id}
              x={teleport.x - portalSize / 2}
              y={teleport.y - portalSize / 2}
              width={portalSize}
              height={portalSize}
              className="world-minimap-portal"
              transform={`rotate(45 ${teleport.x} ${teleport.y})`}
              vectorEffect="non-scaling-stroke"
            />
          ))}

          {npcs.map((npc) => (
            <circle
              key={npc.id}
              cx={npc.x}
              cy={npc.y}
              r={markerRadius * 0.68}
              className="world-minimap-npc"
            />
          ))}

          {enemies.map((enemy) => (
            <circle
              key={enemy.id}
              cx={enemy.x}
              cy={enemy.y}
              r={markerRadius * 0.82}
              className="world-minimap-enemy"
              strokeWidth={markerStrokeWidth}
            />
          ))}

          {otherPlayers.map((player) => (
            <circle
              key={player.id}
              cx={player.x}
              cy={player.y}
              r={markerRadius}
              className="world-minimap-player"
              strokeWidth={markerStrokeWidth}
            />
          ))}

          {selfPlayer ? (
            <g transform={`translate(${selfPlayer.x} ${selfPlayer.y})`} className="world-minimap-self-player">
              <circle r={markerRadius * 1.65} strokeWidth={markerStrokeWidth} />
              <circle r={markerRadius * 0.82} />
            </g>
          ) : null}
        </g>

        <rect
          x={markerStrokeWidth / 2}
          y={markerStrokeWidth / 2}
          width={Math.max(0, worldWidth - markerStrokeWidth)}
          height={Math.max(0, worldHeight - markerStrokeWidth)}
          className="world-minimap-world-border"
          strokeWidth={markerStrokeWidth}
          vectorEffect="non-scaling-stroke"
        />
      </svg>
    </aside>
  )
}

export default memo(WorldMiniMap)
