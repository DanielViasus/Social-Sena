import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  interactWithRoomObject,
  PLAYER_REACH_THRESHOLD,
  PLAYER_SPEED,
  type Direction,
  type PlayerFacing,
  type Position,
  type Presence,
  type RoomObjectTemplate,
  type RoomState,
  type RoomTemplate,
  type UserProfile,
} from '@social-sena/shared'
import { navigateInApp } from '../hooks/usePathname'
import { createUiSoundController } from '../audio/chiptuneSounds'
import { isCoinAssetId } from './coinAssetCatalog'
import ReactWorld, { type WorldInteractableTarget } from './ReactWorld'
import { getObjectNavigationBoundsList } from './world/ObjectDecoration'
import { PLAYER_COLLIDER_HEIGHT, PLAYER_COLLIDER_WIDTH } from './world/WorldPlayer'

const TEST_ROOM_ID = 'edit-room-local-test'
const TEST_SESSION_ID = 'edit-room-local-player'
const TEST_MOVEMENT_TICK_MS = 1000 / 20

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
    facing: 'front-right',
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

function getObjectVisualBounds(objectTemplate: RoomObjectTemplate): Bounds {
  return {
    left: objectTemplate.x - objectTemplate.width / 2,
    right: objectTemplate.x + objectTemplate.width / 2,
    top: objectTemplate.y - objectTemplate.height / 2,
    bottom: objectTemplate.y + objectTemplate.height / 2,
  }
}

function overlaps(first: Bounds, second: Bounds) {
  return first.left < second.right
    && first.right > second.left
    && first.top < second.bottom
    && first.bottom > second.top
}

function segmentIntersectsPlayerBounds(from: Position, to: Position, bounds: Bounds) {
  const expandedBounds = {
    left: bounds.left - PLAYER_COLLIDER_WIDTH / 2,
    right: bounds.right + PLAYER_COLLIDER_WIDTH / 2,
    top: bounds.top,
    bottom: bounds.bottom + PLAYER_COLLIDER_HEIGHT,
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
      if (ratio > exit) return false
      entry = Math.max(entry, ratio)
    } else {
      if (ratio < entry) return false
      exit = Math.min(exit, ratio)
    }
    return true
  }

  return updateInterval(-deltaX, from.x - expandedBounds.left)
    && updateInterval(deltaX, expandedBounds.right - from.x)
    && updateInterval(-deltaY, from.y - expandedBounds.top)
    && updateInterval(deltaY, expandedBounds.bottom - from.y)
    && entry <= exit
    && exit > 0.0001
    && entry < 0.9999
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

function resolveFacing(
  deltaX: number,
  deltaY: number,
  fallback: PlayerFacing = 'front-right',
): PlayerFacing {
  if (Math.abs(deltaX) < 0.001 && Math.abs(deltaY) < 0.001) {
    return fallback
  }

  const wasFacingLeft = fallback === 'front-left' || fallback === 'back-left'
  const isLeft = Math.abs(deltaX) < 0.001 ? wasFacingLeft : deltaX < 0
  const isBack = deltaY < 0 && Math.abs(deltaY) >= Math.abs(deltaX) * 0.65

  if (isBack) {
    return isLeft ? 'back-left' : 'back-right'
  }

  return isLeft ? 'front-left' : 'front-right'
}

export default function EditRoomTestMode({
  template,
  profile,
  debugEnabled,
  resolveObjectSpriteSrc,
}: EditRoomTestModeProps) {
  const [runtimeTemplate, setRuntimeTemplate] = useState(template)
  const [player, setPlayer] = useState(() => createPlayer(profile, template.world.spawn))
  const playerRef = useRef(player)
  const pressedKeysRef = useRef(new Set<string>())
  const navigationTargetRef = useRef<Position | null>(null)
  const collectedObjectIdsRef = useRef(new Set<string>())
  const [uiSoundController] = useState(createUiSoundController)
  const colliders = useMemo(
    () => runtimeTemplate.objects.flatMap(getObjectNavigationBoundsList),
    [runtimeTemplate.objects],
  )
  const collectibleObjects = useMemo(
    () => runtimeTemplate.objects.filter((objectTemplate) => objectTemplate.collectible === true),
    [runtimeTemplate.objects],
  )

  useEffect(() => {
    uiSoundController.updateSettings({
      sfxEnabled: profile.audioSettings.sfxEnabled,
      sfxVolume: profile.audioSettings.sfxVolume,
    })
  }, [profile.audioSettings.sfxEnabled, profile.audioSettings.sfxVolume, uiSoundController])

  useEffect(() => {
    const unlockAudio = () => {
      void uiSoundController.unlock()
    }

    window.addEventListener('pointerdown', unlockAudio, { passive: true })
    window.addEventListener('keydown', unlockAudio)
    return () => {
      window.removeEventListener('pointerdown', unlockAudio)
      window.removeEventListener('keydown', unlockAudio)
      void uiSoundController.close()
    }
  }, [uiSoundController])

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
    let previousTime = performance.now()

    const canOccupy = (position: Position) => {
      const bounds = getPlayerBounds(position)
      if (
        bounds.left < 0
        || bounds.right > runtimeTemplate.world.width
        || bounds.top < 0
        || bounds.bottom > runtimeTemplate.world.height
      ) {
        return false
      }

      return !colliders.some((collider) => overlaps(bounds, collider))
    }

    const canTraverse = (from: Position, to: Position) => (
      canOccupy(to)
      && !colliders.some((collider) => segmentIntersectsPlayerBounds(from, to, collider))
    )

    const tick = () => {
      const now = performance.now()
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

        if (targetDistance <= PLAYER_REACH_THRESHOLD) {
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

      const travelDistance = PLAYER_SPEED * deltaSeconds
      const deltaX = directionX * travelDistance
      const deltaY = directionY * travelDistance
      let nextPosition = currentPlayer.position

      if (isMoving) {
        const combinedPosition = {
          x: clamp(currentPlayer.position.x + deltaX, PLAYER_COLLIDER_WIDTH / 2, runtimeTemplate.world.width - PLAYER_COLLIDER_WIDTH / 2),
          y: clamp(currentPlayer.position.y + deltaY, PLAYER_COLLIDER_HEIGHT, runtimeTemplate.world.height - 20),
        }
        const xOnlyPosition = {
          x: combinedPosition.x,
          y: currentPlayer.position.y,
        }
        const yOnlyPosition = {
          x: currentPlayer.position.x,
          y: combinedPosition.y,
        }

        if (canTraverse(currentPlayer.position, combinedPosition)) {
          nextPosition = combinedPosition
        } else if (Math.abs(deltaX) > 0.001 && canTraverse(currentPlayer.position, xOnlyPosition)) {
          nextPosition = xOnlyPosition
        } else if (Math.abs(deltaY) > 0.001 && canTraverse(currentPlayer.position, yOnlyPosition)) {
          nextPosition = yOnlyPosition
        }
      }

      const didMove = nextPosition.x !== currentPlayer.position.x || nextPosition.y !== currentPlayer.position.y
      if (navigationTarget && isMoving && !didMove) {
        navigationTargetRef.current = null
      }

      const playerBounds = getPlayerBounds(nextPosition)
      const collectedObjects = collectibleObjects
        .filter((objectTemplate) => (
          !collectedObjectIdsRef.current.has(objectTemplate.id)
          && overlaps(playerBounds, getObjectVisualBounds(objectTemplate))
        ))
      const collectedObjectIds = collectedObjects
        .map((objectTemplate) => objectTemplate.id)

      if (collectedObjectIds.length > 0) {
        if (collectedObjects.some((objectTemplate) => isCoinAssetId(objectTemplate.spriteAssetId))) {
          void uiSoundController.play('coin-pickup')
        }
        collectedObjectIds.forEach((objectId) => collectedObjectIdsRef.current.add(objectId))
        const collectedObjectIdSet = new Set(collectedObjectIds)
        setRuntimeTemplate((currentTemplate) => {
          const nextObjects = currentTemplate.objects.filter(
            (objectTemplate) => !collectedObjectIdSet.has(objectTemplate.id),
          )

          return nextObjects.length === currentTemplate.objects.length
            ? currentTemplate
            : { ...currentTemplate, objects: nextObjects }
        })
      }

      const nextPlayer: Presence = {
        ...currentPlayer,
        position: nextPosition,
        direction: isMoving
          ? resolveDirection(directionX, directionY, currentPlayer.direction)
          : currentPlayer.direction,
        facing: isMoving
          ? resolveFacing(directionX, directionY, currentPlayer.facing)
          : currentPlayer.facing,
        moving: didMove,
        animation: didMove ? 'walk' : 'idle',
        destination: didMove && !keyboardIsActive
          ? navigationTargetRef.current
          : null,
        route: null,
      }

      playerRef.current = nextPlayer
      if (
        didMove
        || currentPlayer.moving
        || nextPlayer.direction !== currentPlayer.direction
        || nextPlayer.facing !== currentPlayer.facing
      ) {
        setPlayer(nextPlayer)
      }
    }

    const movementInterval = window.setInterval(tick, TEST_MOVEMENT_TICK_MS)
    return () => window.clearInterval(movementInterval)
  }, [collectibleObjects, colliders, runtimeTemplate.world.height, runtimeTemplate.world.width, uiSoundController])

  const room = useMemo<RoomState>(() => ({
    roomId: TEST_ROOM_ID,
    templateId: runtimeTemplate.id,
    name: 'Prueba local del editor',
    maxUsers: 1,
    template: runtimeTemplate,
    players: [player],
    enemies: [],
  }), [player, runtimeTemplate])

  const handleNavigate = useCallback((target: Position) => {
    navigationTargetRef.current = target
  }, [])

  const handleInteract = useCallback((interactable: WorldInteractableTarget) => {
    if (interactable.entityType === 'teleport') {
      const targetRoutePath = interactable.teleportTarget.routePath
      if (typeof targetRoutePath === 'string') {
        navigateInApp(targetRoutePath)
        return
      }
    }

    if (interactable.entityType !== 'object') {
      return
    }

    setRuntimeTemplate((currentTemplate) => (
      interactWithRoomObject(currentTemplate, interactable.id)?.template ?? currentTemplate
    ))
  }, [])

  return (
    <main className="edit-room-test-mode" aria-label="Modo de prueba de la sala">
      <ReactWorld
        room={room}
        currentUserId={profile.userId}
        template={runtimeTemplate}
        onNavigate={handleNavigate}
        onInteract={handleInteract}
        debugEnabled={debugEnabled}
        playerIdentityMode="names"
        navigationEnabled
        interactionEnabled
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
