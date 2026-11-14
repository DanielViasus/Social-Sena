import { memo } from 'react'

interface EditorEnemyPlacementProps {
  // Centro del enemigo en pixeles del mapa.
  x: number
  y: number
  sheetUrl: string
  sheetWidth: number
  sheetHeight: number
  frameWidth: number
  frameHeight: number
  flippedX?: boolean
  label?: string
  // Zona de vigilancia: se dibuja translucida en rojo alrededor del enemigo.
  surveillanceArea?: { width: number; height: number; offsetX: number; offsetY: number } | null
  // Zona de interaccion: acompaña al enemigo y se dibuja en azul.
  interactionArea?: { width: number; height: number; offsetX: number; offsetY: number } | null
}

// Vista del enemigo dentro del editor de niveles: el primer frame de su hoja de sprites
// y su zona de vigilancia, para poder ajustarla desde el inspector.
function EditorEnemyPlacementComponent({
  x,
  y,
  sheetUrl,
  sheetWidth,
  sheetHeight,
  frameWidth,
  frameHeight,
  flippedX = false,
  label,
  surveillanceArea,
  interactionArea,
}: EditorEnemyPlacementProps) {
  return (
    <div className="editor-enemy-placement" style={{ left: `${x}px`, top: `${y}px` }}>
      {surveillanceArea ? (
        <div
          className="editor-enemy-surveillance-area"
          aria-hidden="true"
          style={{
            width: `${surveillanceArea.width}px`,
            height: `${surveillanceArea.height}px`,
            transform: `translate(-50%, -50%) translate(${flippedX ? -surveillanceArea.offsetX : surveillanceArea.offsetX}px, ${surveillanceArea.offsetY}px)`,
          }}
        />
      ) : null}
      {interactionArea ? (
        <div
          className="editor-enemy-interaction-area"
          aria-hidden="true"
          style={{
            width: `${interactionArea.width}px`,
            height: `${interactionArea.height}px`,
            transform: `translate(-50%, -50%) translate(${flippedX ? -interactionArea.offsetX : interactionArea.offsetX}px, ${interactionArea.offsetY}px)`,
          }}
        />
      ) : null}
      <div
        className="editor-enemy-sprite"
        style={{
          width: `${frameWidth}px`,
          height: `${frameHeight}px`,
          transform: `translate(-50%, -50%) scaleX(${flippedX ? -1 : 1})`,
        }}
      >
        <img
          src={sheetUrl}
          alt={label ?? ''}
          draggable={false}
          style={{ width: `${sheetWidth}px`, height: `${sheetHeight}px` }}
        />
      </div>
    </div>
  )
}

export const EditorEnemyPlacement = memo(EditorEnemyPlacementComponent)
