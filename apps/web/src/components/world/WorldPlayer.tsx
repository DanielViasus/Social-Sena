import type { Presence } from '@social-sena/shared'
import type { AvatarPreset, AvatarTextureDefinition } from '../../game/avatar/avatarSprites'

interface WorldPlayerProps {
  player: Presence
  displayX: number
  displayY: number
  isSelf: boolean
  frame: {
    preset: AvatarPreset
    texture: AvatarTextureDefinition
    flipX: boolean
  }
  debugEnabled: boolean
}

export const PLAYER_VISUAL_WIDTH = 128
export const PLAYER_VISUAL_HEIGHT = 128
export const PLAYER_COLLIDER_WIDTH = 68
export const PLAYER_COLLIDER_HEIGHT = 24

export function getPlayerPerspectiveY(positionY: number) {
  return positionY
}

export function WorldPlayer({ player, displayX, displayY, isSelf, frame, debugEnabled }: WorldPlayerProps) {
  return (
    <div
      className="react-world-avatar"
      style={{
        left: `${displayX}px`,
        top: `${displayY}px`,
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
          transform: frame.flipX ? 'translateX(-50%) scaleX(-1)' : 'translateX(-50%) scaleX(1)',
        }}
      />
      <div className={`react-world-avatar-label ${isSelf ? 'is-self' : ''}`}>{player.displayName}</div>

      {debugEnabled ? (
        <>
          <div
            className={`debug-player-total ${isSelf ? 'is-self' : 'is-other'}`}
            style={{
              left: '0px',
              top: `${-PLAYER_VISUAL_HEIGHT / 2}px`,
              width: `${PLAYER_VISUAL_WIDTH}px`,
              height: `${PLAYER_VISUAL_HEIGHT}px`,
            }}
          />
          <div
            className="debug-player-collider"
            style={{
              left: '0px',
              top: `${-PLAYER_COLLIDER_HEIGHT / 2}px`,
              width: `${PLAYER_COLLIDER_WIDTH}px`,
              height: `${PLAYER_COLLIDER_HEIGHT}px`,
            }}
          />
        </>
      ) : null}
    </div>
  )
}
