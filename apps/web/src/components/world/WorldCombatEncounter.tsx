import type { RoomInteractionAreaTemplate } from '@social-sena/shared'
import type { NpcInteractionState, WorldNpcFrameDefinition } from './WorldNpc'

interface WorldCombatEncounterProps {
  displayX: number
  displayY: number
  state: NpcInteractionState
  iconFrame?: WorldNpcFrameDefinition | null
  interactive?: boolean
  onInteractClick?: () => void
  debugEnabled?: boolean
  warningArea?: RoomInteractionAreaTemplate
  interactionArea?: RoomInteractionAreaTemplate
}

function colorToCss(value: number | undefined, fallback: string) {
  if (typeof value !== 'number') {
    return fallback
  }

  return `#${value.toString(16).padStart(6, '0')}`
}

export function WorldCombatEncounter({
  displayX,
  displayY,
  state,
  iconFrame,
  interactive = false,
  onInteractClick,
  debugEnabled = false,
  warningArea,
  interactionArea,
}: WorldCombatEncounterProps) {
  const iconWidth = 128
  const iconHeight = 128
  const iconOffsetX = 0
  const iconOffsetY = -156
  const shouldShowIcon = state !== 'out'
  const iconFill =
    state === 'interaction'
      ? colorToCss(0x6354ff, '#6354ff')
      : colorToCss(0xe85050, '#e85050')
  const combatBounds = {
    left: -68,
    right: 68,
    top: -68,
    bottom: 68,
  }
  const iconBounds = shouldShowIcon
    ? {
        left: iconOffsetX - iconWidth / 2,
        right: iconOffsetX + iconWidth / 2,
        top: iconOffsetY - iconHeight / 2,
        bottom: iconOffsetY + iconHeight / 2,
      }
    : null
  const hitBounds = {
    left: Math.min(combatBounds.left, iconBounds?.left ?? combatBounds.left),
    right: Math.max(combatBounds.right, iconBounds?.right ?? combatBounds.right),
    top: Math.min(combatBounds.top, iconBounds?.top ?? combatBounds.top),
    bottom: Math.max(combatBounds.bottom, iconBounds?.bottom ?? combatBounds.bottom),
  }
  const hitCenterX = (hitBounds.left + hitBounds.right) / 2
  const hitCenterY = (hitBounds.top + hitBounds.bottom) / 2
  const hitWidth = hitBounds.right - hitBounds.left
  const hitHeight = hitBounds.bottom - hitBounds.top

  return (
    <div
      className={`world-combat ${interactive ? 'is-interactive' : ''}`}
      style={{ left: `${displayX}px`, top: `${displayY}px` }}
    >
      {interactive ? (
        <button
          type="button"
          className="world-combat-hitbox"
          aria-label="Unirse al combate"
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => {
            event.stopPropagation()
            onInteractClick?.()
          }}
          style={{
            left: `${hitCenterX}px`,
            top: `${hitCenterY}px`,
            width: `${hitWidth}px`,
            height: `${hitHeight}px`,
          }}
        />
      ) : null}

      <div className="react-world-combat-placeholder" />

      {shouldShowIcon ? (
        iconFrame ? (
          <img
            src={iconFrame.url}
            alt={state === 'interaction' ? 'Interaccion combate' : 'Warning combate'}
            draggable={false}
            className="react-world-npc-icon"
            style={{
              left: `${iconOffsetX}px`,
              top: `${iconOffsetY}px`,
              width: `${iconWidth}px`,
              height: `${iconHeight}px`,
            }}
          />
        ) : (
          <div
            className="react-world-npc-icon react-world-npc-icon-fallback"
            style={{
              left: `${iconOffsetX}px`,
              top: `${iconOffsetY}px`,
              width: `${iconWidth}px`,
              height: `${iconHeight}px`,
              background: iconFill,
            }}
          />
        )
      ) : null}

      {debugEnabled && warningArea ? (
        <div
          className="debug-combat-warning"
          style={{
            left: `${warningArea.offsetX}px`,
            top: `${warningArea.offsetY}px`,
            width: `${warningArea.width}px`,
            height: `${warningArea.height}px`,
          }}
        />
      ) : null}

      {debugEnabled && interactionArea ? (
        <div
          className="debug-combat-interaction"
          style={{
            left: `${interactionArea.offsetX}px`,
            top: `${interactionArea.offsetY}px`,
            width: `${interactionArea.width}px`,
            height: `${interactionArea.height}px`,
          }}
        />
      ) : null}
    </div>
  )
}
