import type { Presence } from '@social-sena/shared'
import type { CSSProperties } from 'react'
import {
  resolveAvatarPreset,
  resolveAvatarPrimaryColor,
  type AvatarPreset,
  type AvatarTextureDefinition,
} from '../../game/avatar/avatarSprites'
import { createAvatarBubblePalette } from '../../game/avatar/avatarUiColors'

interface WorldPlayerProps {
  player: Presence
  displayX: number
  displayY: number
  isSelf: boolean
  playerIdentityMode: 'icons' | 'names'
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

function getLeaderInitials(displayName: string | null) {
  if (!displayName) {
    return null
  }

  const words = displayName
    .trim()
    .split(/\s+/)
    .filter((word) => word.length > 0)

  if (words.length === 0) {
    return null
  }

  if (words.length === 1) {
    return words[0].slice(0, 2).toUpperCase()
  }

  return `${words[0][0] ?? ''}${words[1][0] ?? ''}`.toUpperCase()
}
export function WorldPlayer({
  player,
  displayX,
  displayY,
  isSelf,
  playerIdentityMode,
  speechText,
  isTyping = false,
  typingIndicatorText = '...',
  frame,
  debugEnabled,
}: WorldPlayerProps) {
  const isSpeechActive = Boolean(speechText) || isTyping
  const labelText = isTyping ? typingIndicatorText : speechText || player.displayName
  const leaderPrimaryColor =
    player.partyLeaderSkinId && player.partyLeaderSkinColors
      ? resolveAvatarPrimaryColor(
          resolveAvatarPreset(player.partyLeaderSkinId),
          player.partyLeaderSkinColors,
        )
      : '#D9D9D9'
  const isGroupedPlayer = Boolean(player.partyId)
  const playerPrimaryColor = resolveAvatarPrimaryColor(
    resolveAvatarPreset(player.skinId),
    player.skinColors,
  )
  const speechBubblePalette = createAvatarBubblePalette(playerPrimaryColor)
  const leaderPalette = createAvatarBubblePalette(leaderPrimaryColor)
  const speechPalette = isGroupedPlayer ? leaderPalette : speechBubblePalette
  const leaderInitials = isGroupedPlayer ? getLeaderInitials(player.partyLeaderDisplayName) : null
  const identityDisplayMode = isSpeechActive
    ? 'speech'
    : playerIdentityMode === 'names'
      ? 'names'
      : isGroupedPlayer && leaderInitials
        ? 'badge'
        : 'hidden'
  const labelStyle: CSSProperties = isSpeechActive
    ? {
        backgroundColor: speechPalette.fill,
        borderColor: speechPalette.border,
        boxShadow: `0 10px 24px ${speechPalette.shadow}`,
        color: speechPalette.ink,
      }
    : isGroupedPlayer
      ? {
          backgroundColor: leaderPalette.fill,
          borderColor: leaderPalette.border,
          color: leaderPalette.ink,
        }
      : {
          borderColor: leaderPrimaryColor,
        }
  const leaderBadgeStyle: CSSProperties | undefined = leaderInitials
    ? {
        backgroundColor: leaderPrimaryColor,
        borderColor: leaderPalette.border,
        color: '#fffaf0',
      }
    : undefined

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
      <div className="react-world-avatar-label-group">
        <div
          className={`react-world-avatar-label-group-shell is-${identityDisplayMode}`}
          data-has-group-badge={leaderInitials ? 'true' : 'false'}
        >
          <div
            className={`react-world-avatar-label ${isSelf ? 'is-self' : ''} ${isSpeechActive ? 'is-speech' : ''} ${isTyping ? 'is-typing' : ''} ${leaderInitials ? 'has-group-badge' : ''}`}
            style={labelStyle}
          >
            <span className="react-world-avatar-label-text">{labelText}</span>
          </div>
          {leaderInitials ? (
            <div className="react-world-avatar-group-badge" style={leaderBadgeStyle}>
              {leaderInitials}
            </div>
          ) : null}
        </div>
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
