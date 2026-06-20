import type { RoomEnemyTemplate } from '@social-sena/shared'
import { getWorldSpriteAsset } from './worldAssetCatalog'

interface EnemigoProps {
  enemyTemplate: RoomEnemyTemplate
  debugEnabled: boolean
  displayX: number
  displayY: number
}

export function Enemigo({ enemyTemplate, debugEnabled, displayX, displayY }: EnemigoProps) {
  const spriteSrc = getWorldSpriteAsset(enemyTemplate.spriteAssetId)
  const enemyOffsetX = displayX - enemyTemplate.posicion_relativa_X
  const enemyOffsetY = displayY - enemyTemplate.posicion_relativa_Y
  const directInteractionWidth = enemyTemplate.ancho_area_interaccion_directa_ ?? 300
  const directInteractionHeight = enemyTemplate.alto_area_interaccion_directa_ ?? 300

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

      {spriteSrc ? (
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
