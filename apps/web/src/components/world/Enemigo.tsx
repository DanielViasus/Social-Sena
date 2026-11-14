import type { PlayerFacing, RoomEnemyTemplate } from '@social-sena/shared'
import { memo, type Ref } from 'react'
import type { WorldNpcFrameDefinition } from './WorldNpc'
import { getEnemyOverlayAsset, getEnemySpriteAsset, getWorldSpriteAsset } from './worldAssetCatalog'

// Frame animado del enemigo segun hacia donde mira y si se esta moviendo.
// Filas de la hoja: 0 idle de frente, 1 caminata de frente, 2 idle de espaldas, 3 caminata de espaldas.
// eslint-disable-next-line react-refresh/only-export-components -- Helper de animacion compartido.
export function getAnimatedEnemyFrame(
  enemyTemplate: RoomEnemyTemplate,
  now: number,
  facingPose: PlayerFacing,
  moving: boolean,
): WorldNpcFrameDefinition | null {
  const sheetUrl = getEnemySpriteAsset(enemyTemplate.spriteSheetAssetId)
  const sheetFrameDefinitions = enemyTemplate.spriteFrames ?? []

  if (
    sheetUrl &&
    typeof enemyTemplate.spriteSheetWidth === 'number' &&
    typeof enemyTemplate.spriteSheetHeight === 'number' &&
    typeof enemyTemplate.spriteFrameWidth === 'number' &&
    typeof enemyTemplate.spriteFrameHeight === 'number' &&
    sheetFrameDefinitions.length > 0
  ) {
    const useBack = facingPose === 'back-left' || facingPose === 'back-right'
    const targetRow = moving ? (useBack ? 3 : 1) : useBack ? 2 : 0
    const rowFrames = sheetFrameDefinitions
      .filter((frame) => frame.row === targetRow)
      .sort((leftFrame, rightFrame) => leftFrame.column - rightFrame.column)
    const frames = rowFrames.length > 0 ? rowFrames : sheetFrameDefinitions
    const frameDuration = Math.max(80, enemyTemplate.spriteFrameDurationMs ?? 180)
    const frameIndex = Math.floor(now / frameDuration) % frames.length
    const frame = frames[frameIndex]

    return {
      key: frame.key,
      sheetUrl,
      sheetWidth: enemyTemplate.spriteSheetWidth,
      sheetHeight: enemyTemplate.spriteSheetHeight,
      frameWidth: enemyTemplate.spriteFrameWidth,
      frameHeight: enemyTemplate.spriteFrameHeight,
      row: frame.row,
      column: frame.column,
    }
  }

  const spriteUrl = getWorldSpriteAsset(enemyTemplate.spriteAssetId)
  return spriteUrl
    ? {
        key: enemyTemplate.spriteAssetId ?? enemyTemplate.id,
        url: spriteUrl,
      }
    : null
}


interface EnemigoProps {
  enemyTemplate: RoomEnemyTemplate
  debugEnabled: boolean
  displayX: number
  displayY: number
  spriteFrame?: WorldNpcFrameDefinition | null
  // Icono de alerta animado que se muestra cuando el enemigo detecta al jugador.
  iconFrame?: WorldNpcFrameDefinition | null
  flipX?: boolean
  showIcon?: boolean
  motionElementRef?: Ref<HTMLDivElement>
}

function EnemigoComponent({
  enemyTemplate,
  debugEnabled,
  displayX,
  displayY,
  spriteFrame,
  iconFrame,
  flipX = false,
  showIcon = false,
  motionElementRef,
}: EnemigoProps) {
  const spriteSrc = getWorldSpriteAsset(enemyTemplate.spriteAssetId)
  const iconSrc = iconFrame?.url ?? getEnemyOverlayAsset(enemyTemplate.iconAssetId)
  const enemyOffsetX = displayX - enemyTemplate.posicion_relativa_X
  const enemyOffsetY = displayY - enemyTemplate.posicion_relativa_Y
  const interactionArea = enemyTemplate.interactionArea ?? {
    width: enemyTemplate.ancho_area_interaccion_directa_ ?? 300,
    height: enemyTemplate.alto_area_interaccion_directa_ ?? 300,
    offsetX: 0,
    offsetY: 0,
  }
  const iconWidth = enemyTemplate.iconWidth ?? 128
  const iconHeight = enemyTemplate.iconHeight ?? 128
  const iconOffsetX = enemyTemplate.iconOffsetX ?? 0
  const iconOffsetY = enemyTemplate.iconOffsetY ?? -128

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
          {enemyTemplate.surveillanceArea ? (
            <div
              className="debug-enemy-surveillance-area"
              style={{
                left: `${enemyTemplate.surveillanceArea.offsetX}px`,
                top: `${enemyTemplate.surveillanceArea.offsetY}px`,
                width: `${enemyTemplate.surveillanceArea.width}px`,
                height: `${enemyTemplate.surveillanceArea.height}px`,
              }}
            />
          ) : null}
          <div
            className="debug-enemy-direct-interaction"
            style={{
              left: `${enemyOffsetX + interactionArea.offsetX}px`,
              top: `${enemyOffsetY + interactionArea.offsetY}px`,
              width: `${interactionArea.width}px`,
              height: `${interactionArea.height}px`,
            }}
          />
        </>
      ) : null}

      <div
        ref={motionElementRef}
        className="world-enemy-motion"
        style={{
          left: '0px',
          top: '0px',
          transform: `translate3d(${enemyOffsetX}px, ${enemyOffsetY}px, 0)`,
        }}
      >
        {showIcon ? (
          iconSrc ? (
            <img
              key={iconFrame?.key ?? enemyTemplate.iconAssetId}
              src={iconSrc}
              alt=""
              aria-hidden="true"
              draggable={false}
              className="react-world-enemy-icon"
              style={{
                left: `${iconOffsetX}px`,
                top: `${iconOffsetY}px`,
                width: `${iconWidth}px`,
                height: `${iconHeight}px`,
              }}
            />
          ) : (
            <div
              className="react-world-enemy-icon react-world-enemy-icon-placeholder"
              aria-hidden="true"
              style={{
                left: `${iconOffsetX}px`,
                top: `${iconOffsetY}px`,
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
              left: '0px',
              top: '0px',
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
              left: '0px',
              top: '0px',
              width: '128px',
              height: '128px',
              transform: flipX ? 'translate(-50%, -50%) scaleX(-1)' : 'translate(-50%, -50%) scaleX(1)',
            }}
          />
        ) : (
          <div
            className="react-world-enemy-placeholder"
            style={{
              left: '0px',
              top: '0px',
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
          left: '0px',
          top: '0px',
            width: '128px',
            height: '128px',
            transform: flipX ? 'translate(-50%, -50%) scaleX(-1)' : 'translate(-50%, -50%) scaleX(1)',
          }}
        />
      ) : (
        <div
          className="react-world-enemy-placeholder"
          style={{
          left: '0px',
          top: '0px',
            width: '128px',
            height: '128px',
          }}
        />
        )}
      </div>
    </div>
  )
}

export const Enemigo = memo(
  EnemigoComponent,
  (previous, next) =>
    previous.enemyTemplate === next.enemyTemplate
    && previous.debugEnabled === next.debugEnabled
    && previous.spriteFrame?.key === next.spriteFrame?.key
    && previous.flipX === next.flipX
    && previous.showIcon === next.showIcon,
)
