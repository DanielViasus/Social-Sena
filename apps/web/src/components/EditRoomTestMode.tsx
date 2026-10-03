import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type {
  Direction,
  Position,
  Presence,
  RoomObjectTemplate,
  RoomState,
  RoomTemplate,
  UserProfile,
} from '@social-sena/shared'
import ReactWorld from './ReactWorld'
import { getObjectColliderBoundsList } from './world/ObjectDecoration'
import { PLAYER_COLLIDER_HEIGHT, PLAYER_COLLIDER_WIDTH } from './world/WorldPlayer'

const TEST_ROOM_ID = 'edit-room-local-test'
const TEST_SESSION_ID = 'edit-room-local-player'
const PLAYER_SPEED_PX_PER_SECOND = 280

interface EditRoomTestModeProps {
  template: RoomTemplate
  profile: UserProfile
  debugEnabled: boolean
  resolveObjectSpriteSrc: (objectTemplate: RoomObjectTemplate) => string | undefined
}

interface Bounds {
  left: number
  right: number
  top: number
  bottom: number
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}

function createPlayer(profile: UserProfile, spawn: Position): Presence {
  return {
    userId: profile.userId,
    displayName: profile.displayName,
    sessionId: TEST_SESSION_ID,
    roomId: TEST_ROOM_ID,
    level: 1,
    position: spawn,
    direction: 'down',
    moving: false,
    skinId: profile.skinId,
    skinColors: profile.skinColors,
    partyId: null,
    partyLeaderUserId: null,
    partyLeaderDisplayName: null,
    partyLeaderSkinId: null,
    partyLeaderSkinColors: null,
    animation: 'idle',
    destination: null,
    route: null,
  }
}

function getPlayerBounds(position: Position): Bounds {
  return {
    left: position.x - PLAYER_COLLIDER_WIDTH / 2,
    right: position.x + PLAYER_COLLIDER_WIDTH / 2,
    top: position.y - PLAYER_COLLIDER_HEIGHT,
    bottom: position.y,
  }
}

function overlaps(first: Bounds, second: Bounds) {
  return first.left < second.right
    && first.right > second.left
    && first.top < second.bottom
    && first.bottom > second.top
}

function resolveDirection(deltaX: number, deltaY: number, fallback: Direction): Direction {
  if (Math.abs(deltaX) > Math.abs(deltaY)) {
    return deltaX < 0 ? 'left' : 'right'
  }

  if (Math.abs(deltaY) > 0.001) {
    return deltaY < 0 ? 'up' : 'down'
  }

  return fallback
}

export default function EditRoomTestMode({
  template,
  profile,
  debugEnabled,
  resolveObjectSpriteSrc,
}: EditRoomTestModeProps) {
  const [player, setPlayer] = useState(() => createPlayer(profile, template.world.spawn))
  const playerRef = useRef(player)
  const pressedKeysRef = useRef(new Set<string>())
  const navigationTargetRef = useRef<Position | null>(null)
  const colliders = useMemo(
    () => template.objects.flatMap(getObjectColliderBoundsList),
    [template.objects],
  )

  useEffect(() => {
    playerRef.current = player
  }, [player])

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      if (target?.matches('input, textarea, select, [contenteditable="true"]')) {
        return
      }

      const movementKeys = ['arrowup', 'arrowdown', 'arrowleft', 'arrowright', 'w', 'a', 's', 'd']
      const key = event.key.toLocaleLowerCase()
      if (!movementKeys.includes(key)) {
        return
      }

      event.preventDefault()
      navigationTargetRef.current = null
      pressedKeysRef.current.add(key)
    }

    const handleKeyUp = (event: KeyboardEvent) => {
      pressedKeysRef.current.delete(event.key.toLocaleLowerCase())
    }

    const releaseKeys = () => pressedKeysRef.current.clear()
    window.addEventListener('keydown', handleKeyDown)
    window.addEventListener('keyup', handleKeyUp)
    window.addEventListener('blur', releaseKeys)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
      window.removeEventListener('keyup', handleKeyUp)
      window.removeEventListener('blur', releaseKeys)
    }
  }, [])

  useEffect(() => {
    let animationFrame = 0
    let previousTime = performance.now()

    const canOccupy = (position: Position) => {
      const bounds = getPlayerBounds(position)
      if (
        bounds.left < 0
        || bounds.right > template.world.width
        || bounds.top < 0
        || bounds.bottom > template.world.height
      ) {
        return false
      }

      return !colliders.some((collider) => overlaps(bounds, collider))
    }

    const tick = (now: number) => {
      const deltaSeconds = Math.min(0.05, Math.max(0, (now - previousTime) / 1000))
      previousTime = now
      const currentPlayer = playerRef.current
      const keys = pressedKeysRef.current
      let directionX = Number(keys.has('arrowright') || keys.has('d'))
        - Number(keys.has('arrowleft') || keys.has('a'))
      let directionY = Number(keys.has('arrowdown') || keys.has('s'))
        - Number(keys.has('arrowup') || keys.has('w'))
      const keyboardIsActive = directionX !== 0 || directionY !== 0
      const navigationTarget = navigationTargetRef.current

      if (!keyboardIsActive && navigationTarget) {
        const targetDeltaX = navigationTarget.x - currentPlayer.position.x
        const targetDeltaY = navigationTarget.y - currentPlayer.position.y
        const targetDistance = Math.hypot(targetDeltaX, targetDeltaY)

        if (targetDistance <= 5) {
          navigationTargetRef.current = null
        } else {
          directionX = targetDeltaX / targetDistance
          directionY = targetDeltaY / targetDistance
        }
      }

      const directionLength = Math.hypot(directionX, directionY)
      const isMoving = directionLength > 0.001
      if (isMoving) {
        directionX /= directionLength
        directionY /= directionLength
      }

      const travelDistance = PLAYER_SPEED_PX_PER_SECOND * deltaSeconds
      const deltaX = directionX * travelDistance
      const deltaY = directionY * travelDistance
      let nextPosition = currentPlayer.position

      if (isMoving) {
        const nextX = {
          x: clamp(currentPlayer.position.x + deltaX, PLAYER_COLLIDER_WIDTH / 2, template.world.width - PLAYER_COLLIDER_WIDTH / 2),
          y: currentPlayer.position.y,
        }
        if (canOccupy(nextX)) {
          nextPosition = nextX
        }

        const nextY = {
          x: nextPosition.x,
          y: clamp(currentPlayer.position.y + deltaY, PLAYER_COLLIDER_HEIGHT, template.world.height),
        }
        if (canOccupy(nextY)) {
          nextPosition = nextY
        }
      }

      const didMove = nextPosition.x !== currentPlayer.position.x || nextPosition.y !== currentPlayer.position.y
      if (navigationTarget && isMoving && !didMove) {
        navigationTargetRef.current = null
      }

      const nextPlayer: Presence = {
        ...currentPlayer,
        position: nextPosition,
        direction: isMoving
          ? resolveDirection(directionX, directionY, currentPlayer.direction)
          : currentPlayer.direction,
        moving: didMove,
        animation: didMove ? 'walk' : 'idle',
        destination: didMove
          ? navigationTargetRef.current ?? {
              x: nextPosition.x + directionX * 32,
              y: nextPosition.y + directionY * 32,
            }
          : null,
      }

      playerRef.current = nextPlayer
      if (didMove || currentPlayer.moving) {
        setPlayer(nextPlayer)
      }
      animationFrame = window.requestAnimationFrame(tick)
    }

    animationFrame = window.requestAnimationFrame(tick)
    return () => window.cancelAnimationFrame(animationFrame)
  }, [colliders, template.world.height, template.world.width])

  const room = useMemo<RoomState>(() => ({
    roomId: TEST_ROOM_ID,
    templateId: template.id,
    name: 'Prueba local del editor',
    maxUsers: 1,
    template,
    players: [player],
    enemies: [],
  }), [player, template])

  const handleNavigate = useCallback((target: Position) => {
    navigationTargetRef.current = target
  }, [])

  return (
    <main className="edit-room-test-mode" aria-label="Modo de prueba de la sala">
      <ReactWorld
        room={room}
        currentUserId={profile.userId}
        template={template}
        onNavigate={handleNavigate}
        debugEnabled={debugEnabled}
        playerIdentityMode="names"
        navigationEnabled
        interactionEnabled={false}
        pointerInteractionEnabled={false}
        resolveObjectSpriteSrc={resolveObjectSpriteSrc}
        centerWorldWhenSmaller
        cameraVerticalMargin={300}
      />
      <div className="edit-room-test-hint" role="status">
        Modo Test · WASD/Flechas o clic para moverte · T para volver
      </div>
    </main>
  )
}
