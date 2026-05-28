import type {
  RoomColliderTemplate,
  RoomInteractionAreaTemplate,
  RoomNpcTemplate,
  RoomZIndexReferenceTemplate,
} from '@social-sena/shared'

export interface WorldNpcFrameDefinition {
  key: string
  url?: string
  sheetUrl?: string
  sheetWidth?: number
  sheetHeight?: number
  frameWidth?: number
  frameHeight?: number
  row?: number
  column?: number
}

export type NpcInteractionState = 'out' | 'warning' | 'interaction'

interface WorldNpcProps {
  npcTemplate: RoomNpcTemplate
  debugEnabled: boolean
  state: NpcInteractionState
  spriteFrame?: WorldNpcFrameDefinition | null
  iconFrame?: WorldNpcFrameDefinition | null
  flipX?: boolean
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

export function getNpcCollider(npcTemplate: RoomNpcTemplate): RoomColliderTemplate {
  return (
    npcTemplate.collider ?? {
      offsetX: 0,
      offsetY: -12,
      width: 68,
      height: 24,
    }
  )
}

export function getNpcZIndexRef(npcTemplate: RoomNpcTemplate, collider = getNpcCollider(npcTemplate)): RoomZIndexReferenceTemplate {
  return (
    npcTemplate.zIndexRef ?? {
      offsetX: collider.offsetX,
      offsetY: collider.offsetY,
      width: collider.width,
      thickness: 2,
    }
  )
}

export function getNpcWarningArea(npcTemplate: RoomNpcTemplate): RoomInteractionAreaTemplate {
  return (
    npcTemplate.warningArea ?? {
      offsetX: 0,
      offsetY: -64,
      width: 240,
      height: 220,
    }
  )
}

export function getNpcInteractionArea(npcTemplate: RoomNpcTemplate): RoomInteractionAreaTemplate {
  return (
    npcTemplate.interactionArea ?? {
      offsetX: 0,
      offsetY: -48,
      width: 160,
      height: 120,
    }
  )
}

export function getNpcPerspectiveY(npcTemplate: RoomNpcTemplate) {
  return npcTemplate.y + getNpcZIndexRef(npcTemplate).offsetY
}

export function getNpcAreaBounds(
  npcTemplate: RoomNpcTemplate,
  area: RoomInteractionAreaTemplate,
) {
  return {
    left: npcTemplate.x + area.offsetX - area.width / 2,
    right: npcTemplate.x + area.offsetX + area.width / 2,
    top: npcTemplate.y + area.offsetY - area.height / 2,
    bottom: npcTemplate.y + area.offsetY + area.height / 2,
  }
}

export function WorldNpc({
  npcTemplate,
  debugEnabled,
  state,
  spriteFrame,
  iconFrame,
  flipX = false,
  hideIcon = false,
  interactive = false,
  onInteractClick,
}: WorldNpcProps) {
  const collider = getNpcCollider(npcTemplate)
  const zIndexRef = getNpcZIndexRef(npcTemplate, collider)
  const warningArea = getNpcWarningArea(npcTemplate)
  const interactionArea = getNpcInteractionArea(npcTemplate)
  const iconWidth = npcTemplate.iconWidth ?? 56
  const iconHeight = npcTemplate.iconHeight ?? 56
  const iconOffsetX = npcTemplate.iconOffsetX ?? 0
  const iconOffsetY = npcTemplate.iconOffsetY ?? -144
  const shouldShowIcon = !hideIcon && state !== 'out'
  const npcFill = colorToCss(npcTemplate.fillColor, '#51e052')
  const iconFill =
    state === 'interaction'
      ? colorToCss(npcTemplate.iconInteractionFillColor, '#6354ff')
      : colorToCss(npcTemplate.iconWarningFillColor, '#e85050')
  const npcBounds = {
    left: -npcTemplate.width / 2,
    right: npcTemplate.width / 2,
    top: -npcTemplate.height,
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
    left: Math.min(npcBounds.left, iconBounds?.left ?? npcBounds.left),
    right: Math.max(npcBounds.right, iconBounds?.right ?? npcBounds.right),
    top: Math.min(npcBounds.top, iconBounds?.top ?? npcBounds.top),
    bottom: Math.max(npcBounds.bottom, iconBounds?.bottom ?? npcBounds.bottom),
  }
  const hitCenterX = (hitBounds.left + hitBounds.right) / 2
  const hitCenterY = (hitBounds.top + hitBounds.bottom) / 2
  const hitWidth = hitBounds.right - hitBounds.left
  const hitHeight = hitBounds.bottom - hitBounds.top

  return (
    <div
      className={`world-npc ${interactive ? 'is-interactive' : ''}`}
      style={{ left: `${npcTemplate.x}px`, top: `${npcTemplate.y}px` }}
    >
      {interactive ? (
        <button
          type="button"
          className="world-npc-hitbox"
          aria-label={`Interactuar con ${npcTemplate.label || npcTemplate.id}`}
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

      {spriteFrame ? (
        spriteFrame.sheetUrl &&
        typeof spriteFrame.sheetWidth === 'number' &&
        typeof spriteFrame.sheetHeight === 'number' &&
        typeof spriteFrame.frameWidth === 'number' &&
        typeof spriteFrame.frameHeight === 'number' &&
        typeof spriteFrame.row === 'number' &&
        typeof spriteFrame.column === 'number' ? (
          <div
            className="react-world-npc-sprite"
            style={{
              width: `${spriteFrame.frameWidth}px`,
              height: `${spriteFrame.frameHeight}px`,
              transform: flipX ? 'translateX(-50%) scaleX(-1)' : 'translateX(-50%) scaleX(1)',
            }}
          >
            <img
              src={spriteFrame.sheetUrl}
              alt={npcTemplate.label ?? npcTemplate.id}
              draggable={false}
              className="react-world-npc-spritesheet"
              style={{
                width: `${spriteFrame.sheetWidth}px`,
                height: `${spriteFrame.sheetHeight}px`,
                left: `${-spriteFrame.column * spriteFrame.frameWidth}px`,
                top: `${-spriteFrame.row * spriteFrame.frameHeight}px`,
              }}
            />
          </div>
        ) : (
          <img
            src={spriteFrame.url}
            alt={npcTemplate.label ?? npcTemplate.id}
            draggable={false}
            className="react-world-npc-sprite"
            style={{
              width: `${npcTemplate.width}px`,
              height: `${npcTemplate.height}px`,
              transform: flipX ? 'translateX(-50%) scaleX(-1)' : 'translateX(-50%) scaleX(1)',
            }}
          />
        )
      ) : (
        <div
          className="react-world-npc-fallback"
          style={{
            width: `${npcTemplate.width}px`,
            height: `${npcTemplate.height}px`,
            background: npcFill,
            opacity: npcTemplate.opacity ?? 1,
            transform: flipX ? 'translateX(-50%) scaleX(-1)' : 'translateX(-50%) scaleX(1)',
          }}
        />
      )}

      {npcTemplate.label ? <div className="react-world-npc-label">{npcTemplate.label}</div> : null}

      {shouldShowIcon ? (
        iconFrame ? (
          <img
            src={iconFrame.url}
            alt={state === 'interaction' ? 'Interaccion NPC' : 'Warning NPC'}
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
            className="debug-npc-total"
            style={{
              left: '0px',
              top: `${-npcTemplate.height / 2}px`,
              width: `${npcTemplate.width}px`,
              height: `${npcTemplate.height}px`,
            }}
          />
          <div
            className="debug-npc-collider"
            style={{
              left: `${collider.offsetX}px`,
              top: `${collider.offsetY}px`,
              width: `${collider.width}px`,
              height: `${collider.height}px`,
            }}
          />
          <div
            className="debug-npc-zref"
            style={{
              left: `${zIndexRef.offsetX}px`,
              top: `${zIndexRef.offsetY}px`,
              width: `${zIndexRef.width}px`,
              height: `${zIndexRef.thickness ?? 2}px`,
            }}
          />
          <div
            className="debug-npc-warning"
            style={{
              left: `${warningArea.offsetX}px`,
              top: `${warningArea.offsetY}px`,
              width: `${warningArea.width}px`,
              height: `${warningArea.height}px`,
            }}
          />
          <div
            className="debug-npc-interaction"
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
