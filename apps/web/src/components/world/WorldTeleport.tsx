import type {
  RoomColliderTemplate,
  RoomInteractionAreaTemplate,
  RoomTeleportTemplate,
  RoomZIndexReferenceTemplate,
} from '@social-sena/shared'
import type { NpcInteractionState, WorldNpcFrameDefinition } from './WorldNpc'

interface WorldTeleportProps {
  teleportTemplate: RoomTeleportTemplate
  debugEnabled: boolean
  state: NpcInteractionState
  spriteSrc?: string
  iconFrame?: WorldNpcFrameDefinition | null
  hideIcon?: boolean
  interactive?: boolean
  onInteractClick?: () => void
}

function colorToCss(value: number | undefined, fallback: string) {
  if (typeof value !== 'number') {
    return fallback
  }

  return `#${value.toString(16).padStart(6, '0')}`
}

export function getTeleportCollider(teleportTemplate: RoomTeleportTemplate): RoomColliderTemplate {
  return (
    teleportTemplate.collider ?? {
      offsetX: 0,
      offsetY: -Math.max(12, teleportTemplate.height * 0.2),
      width: Math.max(48, teleportTemplate.width * 0.45),
      height: Math.max(24, teleportTemplate.height * 0.18),
    }
  )
}

export function getTeleportZIndexRef(
  teleportTemplate: RoomTeleportTemplate,
  collider = getTeleportCollider(teleportTemplate),
): RoomZIndexReferenceTemplate {
  return (
    teleportTemplate.zIndexRef ?? {
      offsetX: collider.offsetX,
      offsetY: collider.offsetY,
      width: collider.width,
      thickness: 2,
    }
  )
}

export function getTeleportWarningArea(teleportTemplate: RoomTeleportTemplate): RoomInteractionAreaTemplate {
  return (
    teleportTemplate.warningArea ?? {
      offsetX: 0,
      offsetY: Math.max(teleportTemplate.height * 0.4, 72),
      width: Math.max(teleportTemplate.width + 120, 240),
      height: Math.max(teleportTemplate.height + 80, 220),
    }
  )
}

export function getTeleportInteractionArea(teleportTemplate: RoomTeleportTemplate): RoomInteractionAreaTemplate {
  return (
    teleportTemplate.interactionArea ?? {
      offsetX: 0,
      offsetY: Math.max(teleportTemplate.height * 0.38, 56),
      width: Math.max(teleportTemplate.width + 64, 160),
      height: Math.max(teleportTemplate.height + 32, 120),
    }
  )
}

export function getTeleportPerspectiveY(teleportTemplate: RoomTeleportTemplate) {
  return teleportTemplate.y + getTeleportZIndexRef(teleportTemplate).offsetY
}

export function getTeleportAreaBounds(
  teleportTemplate: RoomTeleportTemplate,
  area: RoomInteractionAreaTemplate,
) {
  return {
    left: teleportTemplate.x + area.offsetX - area.width / 2,
    right: teleportTemplate.x + area.offsetX + area.width / 2,
    top: teleportTemplate.y + area.offsetY - area.height / 2,
    bottom: teleportTemplate.y + area.offsetY + area.height / 2,
  }
}

export function WorldTeleport({
  teleportTemplate,
  debugEnabled,
  state,
  spriteSrc,
  iconFrame,
  hideIcon = false,
  interactive = false,
  onInteractClick,
}: WorldTeleportProps) {
  const collider = getTeleportCollider(teleportTemplate)
  const zIndexRef = getTeleportZIndexRef(teleportTemplate, collider)
  const warningArea = getTeleportWarningArea(teleportTemplate)
  const interactionArea = getTeleportInteractionArea(teleportTemplate)
  const iconWidth = teleportTemplate.iconWidth ?? 56
  const iconHeight = teleportTemplate.iconHeight ?? 56
  const iconOffsetX = teleportTemplate.iconOffsetX ?? 0
  const iconOffsetY = teleportTemplate.iconOffsetY ?? -(teleportTemplate.height + 42)
  const shouldShowIcon = !hideIcon && state !== 'out'
  const teleportFill = colorToCss(teleportTemplate.fillColor, '#6f93b5')
  const teleportStroke = colorToCss(teleportTemplate.strokeColor, '#d7edf9')
  const iconFill =
    state === 'interaction'
      ? colorToCss(teleportTemplate.iconInteractionFillColor, '#6354ff')
      : colorToCss(teleportTemplate.iconWarningFillColor, '#e85050')
  const visualBounds = {
    left: -teleportTemplate.width / 2,
    right: teleportTemplate.width / 2,
    top: -teleportTemplate.height,
    bottom: 0,
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
    left: Math.min(visualBounds.left, iconBounds?.left ?? visualBounds.left),
    right: Math.max(visualBounds.right, iconBounds?.right ?? visualBounds.right),
    top: Math.min(visualBounds.top, iconBounds?.top ?? visualBounds.top),
    bottom: Math.max(visualBounds.bottom, iconBounds?.bottom ?? visualBounds.bottom),
  }
  const hitCenterX = (hitBounds.left + hitBounds.right) / 2
  const hitCenterY = (hitBounds.top + hitBounds.bottom) / 2
  const hitWidth = hitBounds.right - hitBounds.left
  const hitHeight = hitBounds.bottom - hitBounds.top

  return (
    <div
      className={`world-teleport ${interactive ? 'is-interactive' : ''}`}
      style={{ left: `${teleportTemplate.x}px`, top: `${teleportTemplate.y}px` }}
    >
      {interactive ? (
        <button
          type="button"
          className="world-teleport-hitbox"
          aria-label={`Usar ${teleportTemplate.label || teleportTemplate.id}`}
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

      {spriteSrc ? (
        <img
          src={spriteSrc}
          alt={teleportTemplate.label ?? teleportTemplate.id}
          draggable={false}
          className="react-world-teleport-sprite"
          style={{
            width: `${teleportTemplate.width}px`,
            height: `${teleportTemplate.height}px`,
            opacity: teleportTemplate.opacity ?? 1,
          }}
        />
      ) : (
        <div
          className="react-world-teleport-fallback"
          style={{
            width: `${teleportTemplate.width}px`,
            height: `${teleportTemplate.height}px`,
            background: teleportFill,
            borderColor: teleportStroke,
            opacity: teleportTemplate.opacity ?? 0.65,
          }}
        />
      )}

      {teleportTemplate.label ? <div className="react-world-teleport-label">{teleportTemplate.label}</div> : null}

      {shouldShowIcon ? (
        iconFrame ? (
          <img
            src={iconFrame.url}
            alt={state === 'interaction' ? 'Interaccion TP' : 'Warning TP'}
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

      {debugEnabled ? (
        <>
          <div
            className="debug-teleport-total"
            style={{
              left: '0px',
              top: `${-teleportTemplate.height / 2}px`,
              width: `${teleportTemplate.width}px`,
              height: `${teleportTemplate.height}px`,
            }}
          />
          <div
            className="debug-teleport-collider"
            style={{
              left: `${collider.offsetX}px`,
              top: `${collider.offsetY}px`,
              width: `${collider.width}px`,
              height: `${collider.height}px`,
            }}
          />
          <div
            className="debug-teleport-zref"
            style={{
              left: `${zIndexRef.offsetX}px`,
              top: `${zIndexRef.offsetY}px`,
              width: `${zIndexRef.width}px`,
              height: `${zIndexRef.thickness ?? 2}px`,
            }}
          />
          <div
            className="debug-teleport-warning"
            style={{
              left: `${warningArea.offsetX}px`,
              top: `${warningArea.offsetY}px`,
              width: `${warningArea.width}px`,
              height: `${warningArea.height}px`,
            }}
          />
          <div
            className="debug-teleport-interaction"
            style={{
              left: `${interactionArea.offsetX}px`,
              top: `${interactionArea.offsetY}px`,
              width: `${interactionArea.width}px`,
              height: `${interactionArea.height}px`,
            }}
          />
        </>
      ) : null}
    </div>
  )
}
