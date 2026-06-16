import type { Presence } from '@social-sena/shared'
import {
  resolveAvatarPreset,
  resolveAvatarPrimaryColor,
  type AvatarPreset,
  type AvatarTextureDefinition,
} from '../../game/avatar/avatarSprites'

interface WorldPlayerProps {
  player: Presence
  displayX: number
  displayY: number
  isSelf: boolean
  speechText?: string | null
  isTyping?: boolean
  typingIndicatorText?: string
  frame: {
    preset: AvatarPreset
    texture: AvatarTextureDefinition
    sheetUrl: string
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

export function WorldPlayer({
  player,
  displayX,
  displayY,
  isSelf,
  speechText,
  isTyping = false,
  typingIndicatorText = '...',
  frame,
  debugEnabled,
}: WorldPlayerProps) {
  const isSpeechActive = Boolean(speechText) || isTyping
  const labelText = isTyping ? typingIndicatorText : speechText || player.displayName
  const partyBorderColor =
    player.partyLeaderSkinId && player.partyLeaderSkinColors
      ? resolveAvatarPrimaryColor(
          resolveAvatarPreset(player.partyLeaderSkinId),
          player.partyLeaderSkinColors,
        )
      : '#D9D9D9'

  return (
    <div
      className="react-world-avatar"
      style={{
        left: `${displayX}px`,
        top: `${displayY}px`,
      }}
    >
      <div className={`react-world-avatar-glow ${isSelf ? 'is-self' : ''}`} />
      <div
        className="react-world-avatar-sprite"
        style={{
          width: `${frame.preset.frameWidth}px`,
          height: `${frame.preset.frameHeight}px`,
          transform: frame.flipX ? 'translateX(-50%) scaleX(-1)' : 'translateX(-50%) scaleX(1)',
        }}
      >
        <img
          src={frame.sheetUrl}
          alt={player.displayName}
          draggable={false}
          className="react-world-avatar-spritesheet"
          style={{
            width: `${frame.preset.sheetWidth}px`,
            height: `${frame.preset.sheetHeight}px`,
            left: `${-frame.texture.column * frame.preset.frameWidth}px`,
            top: `${-frame.texture.row * frame.preset.frameHeight}px`,
          }}
        />
      </div>
      <div
        className={`react-world-avatar-label ${isSelf ? 'is-self' : ''} ${isSpeechActive ? 'is-speech' : ''} ${isTyping ? 'is-typing' : ''}`}
        style={{
          borderColor: partyBorderColor,
        }}
      >
        {labelText}
      </div>

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
