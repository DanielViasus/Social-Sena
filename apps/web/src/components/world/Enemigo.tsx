import type { RoomEnemyTemplate } from '@social-sena/shared'
import type { WorldNpcFrameDefinition } from './WorldNpc'
import { getEnemyOverlayAsset, getWorldSpriteAsset } from './worldAssetCatalog'

interface EnemigoProps {
  enemyTemplate: RoomEnemyTemplate
  debugEnabled: boolean
  displayX: number
  displayY: number
  spriteFrame?: WorldNpcFrameDefinition | null
  flipX?: boolean
  showIcon?: boolean
}

export function Enemigo({
  enemyTemplate,
  debugEnabled,
  displayX,
  displayY,
  spriteFrame,
  flipX = false,
  showIcon = false,
}: EnemigoProps) {
  const spriteSrc = getWorldSpriteAsset(enemyTemplate.spriteAssetId)
  const iconSrc = getEnemyOverlayAsset(enemyTemplate.iconAssetId)
  const enemyOffsetX = displayX - enemyTemplate.posicion_relativa_X
  const enemyOffsetY = displayY - enemyTemplate.posicion_relativa_Y
  const directInteractionWidth = enemyTemplate.ancho_area_interaccion_directa_ ?? 300
  const directInteractionHeight = enemyTemplate.alto_area_interaccion_directa_ ?? 300
  const iconWidth = enemyTemplate.iconWidth ?? 64
  const iconHeight = enemyTemplate.iconHeight ?? 64
  const iconOffsetX = enemyTemplate.iconOffsetX ?? 0
  const iconOffsetY = enemyTemplate.iconOffsetY ?? -110

  return (
    <div
      className="world-enemy"
      style={{
        left: `${enemyTemplate.posicion_relativa_X}px`,
        top: `${enemyTemplate.posicion_relativa_Y}px`,
      }}
    >
      {debugEnabled ? (
        <>
          <div
            className="debug-enemy-patrol-area"
            style={{
              width: `${enemyTemplate.ancho_de_patrullaje_}px`,
              height: `${enemyTemplate.alto_de_patrullaje_}px`,
            }}
          />
          <div
            className="debug-enemy-direct-interaction"
            style={{
              left: `${enemyOffsetX}px`,
              top: `${enemyOffsetY}px`,
              width: `${directInteractionWidth}px`,
              height: `${directInteractionHeight}px`,
            }}
          />
        </>
      ) : null}

      {showIcon ? (
        iconSrc ? (
          <img
            src={iconSrc}
            alt=""
            aria-hidden="true"
            draggable={false}
            className="react-world-enemy-icon"
            style={{
              left: `${enemyOffsetX + iconOffsetX}px`,
              top: `${enemyOffsetY + iconOffsetY}px`,
              width: `${iconWidth}px`,
              height: `${iconHeight}px`,
            }}
          />
        ) : (
          <div
            className="react-world-enemy-icon react-world-enemy-icon-placeholder"
            aria-hidden="true"
            style={{
              left: `${enemyOffsetX + iconOffsetX}px`,
              top: `${enemyOffsetY + iconOffsetY}px`,
              width: `${iconWidth}px`,
              height: `${iconHeight}px`,
            }}
          />
        )
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
            className="react-world-enemy-sprite"
            style={{
              left: `${enemyOffsetX}px`,
              top: `${enemyOffsetY}px`,
              width: `${spriteFrame.frameWidth}px`,
              height: `${spriteFrame.frameHeight}px`,
              overflow: 'hidden',
              transform: flipX ? 'translate(-50%, -50%) scaleX(-1)' : 'translate(-50%, -50%) scaleX(1)',
            }}
          >
            <img
              src={spriteFrame.sheetUrl}
              alt={enemyTemplate.label ?? enemyTemplate.id}
              draggable={false}
              className="react-world-enemy-spritesheet"
              style={{
                width: `${spriteFrame.sheetWidth}px`,
                height: `${spriteFrame.sheetHeight}px`,
                left: `${-spriteFrame.column * spriteFrame.frameWidth}px`,
                top: `${-spriteFrame.row * spriteFrame.frameHeight}px`,
              }}
            />
          </div>
        ) : spriteFrame.url ? (
          <img
            src={spriteFrame.url}
            alt={enemyTemplate.label ?? enemyTemplate.id}
            draggable={false}
            className="react-world-enemy-sprite"
            style={{
              left: `${enemyOffsetX}px`,
              top: `${enemyOffsetY}px`,
              width: '128px',
              height: '128px',
              transform: flipX ? 'translate(-50%, -50%) scaleX(-1)' : 'translate(-50%, -50%) scaleX(1)',
            }}
          />
        ) : (
          <div
            className="react-world-enemy-placeholder"
            style={{
              left: `${enemyOffsetX}px`,
              top: `${enemyOffsetY}px`,
              width: '128px',
              height: '128px',
            }}
          />
        )
      ) : spriteSrc ? (
        <img
          src={spriteSrc}
          alt={enemyTemplate.id}
          draggable={false}
          className="react-world-enemy-sprite"
          style={{
            left: `${enemyOffsetX}px`,
            top: `${enemyOffsetY}px`,
            width: '128px',
            height: '128px',
            transform: flipX ? 'translate(-50%, -50%) scaleX(-1)' : 'translate(-50%, -50%) scaleX(1)',
          }}
        />
      ) : (
        <div
          className="react-world-enemy-placeholder"
          style={{
            left: `${enemyOffsetX}px`,
            top: `${enemyOffsetY}px`,
            width: '128px',
            height: '128px',
          }}
        />
      )}
    </div>
  )
}
