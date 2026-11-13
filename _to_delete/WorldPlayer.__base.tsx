import type { Presence } from '@social-sena/shared'
import { memo, type CSSProperties, type Ref } from 'react'
import {
  resolveAvatarPreset,
  resolveAvatarPrimaryColor,
} from '../../game/avatar/avatarSprites'
import { LayeredAvatar } from './LayeredAvatar'
import { avatarAnimations, chapFrontEquipment, chapBackEquipment, type AvatarView } from '../../game/avatar/layeredAvatar'
import { createAvatarBubblePalette } from '../../game/avatar/avatarUiColors'

interface WorldPlayerProps {
  player: Presence
  displayX: number
  displayY: number
  isSelf: boolean
  moving: boolean
  view: AvatarView
  flipX: boolean
  playerIdentityMode: 'icons' | 'names'
  speechText?: string | null
  isTyping?: boolean
  typingIndicatorText?: string
  debugEnabled: boolean
  motionElementRef?: Ref<HTMLDivElement>
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
function WorldPlayerComponent({
  player,
  displayX,
  displayY,
  isSelf,
  moving,
  flipX,
  view,
  playerIdentityMode,
  speechText,
  isTyping = false,
  typingIndicatorText = '...',
  debugEnabled,
  motionElementRef,
}: WorldPlayerProps) {
  const animationName = moving ? (view === 'b' ? 'walkBack' : 'walkFront') : 'idle'
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
          borderColor: '#8D96A8',
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
      ref={motionElementRef}
      className="react-world-avatar"
      style={{
        left: '0px',
        top: '0px',
        transform: `translate3d(${displayX}px, ${displayY}px, 0)`,
      }}
    >
      <div className={`react-world-avatar-glow ${isSelf ? 'is-self' : ''}`} />
      <LayeredAvatar view={view} flipX={flipX} equipment={view === 'b' ? chapBackEquipment : chapFrontEquipment} animationName={animationName} animation={avatarAnimations[animationName]} displayName={player.displayName} />
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

export const WorldPlayer = memo(
  WorldPlayerComponent,
  (previous, next) =>
    previous.player === next.player
    && previous.moving === next.moving
    && previous.view === next.view
    && previous.flipX === next.flipX
    && previous.isSelf === next.isSelf
    && previous.playerIdentityMode === next.playerIdentityMode
    && previous.speechText === next.speechText
    && previous.isTyping === next.isTyping
    && previous.typingIndicatorText === next.typingIndicatorText
    && previous.debugEnabled === next.debugEnabled,
)
