import { memo, useEffect, useMemo, useRef, useState } from 'react'

// Transicion de entrada al combate: se crea un recuadro negro en el centro de la pantalla
// y desde ahi van apareciendo los demas en espiral hasta cubrirla por completo.
const SPIRAL_DURATION_MS = 800
const TILE_SIZE_PX = 96
const TILE_GROW_MS = 140
const HOLD_MS = 280
const FADE_MS = 240

interface CombatTransitionProps {
  // Se llama cuando la animacion termina, para poder quitarla del arbol.
  onComplete?: () => void
  // Con false la pantalla queda cubierta: lo que viene detras toma el relevo sin parpadeo.
  fadeOut?: boolean
}

interface SpiralTile {
  key: string
  left: number
  top: number
  delayMs: number
}

// Recorrido en espiral desde la celda central hacia afuera.
function createSpiralCells(columns: number, rows: number) {
  const cells: Array<{ column: number; row: number }> = []
  const total = columns * rows
  const directions = [
    [1, 0],
    [0, 1],
    [-1, 0],
    [0, -1],
  ] as const
  let column = Math.floor((columns - 1) / 2)
  let row = Math.floor((rows - 1) / 2)
  let direction = 0
  let stepLength = 1

  const pushCell = () => {
    if (column >= 0 && column < columns && row >= 0 && row < rows) {
      cells.push({ column, row })
    }
  }

  pushCell()
  while (cells.length < total && stepLength <= columns + rows + 2) {
    for (let turn = 0; turn < 2; turn += 1) {
      const [deltaColumn, deltaRow] = directions[direction]
      for (let step = 0; step < stepLength; step += 1) {
        column += deltaColumn
        row += deltaRow
        pushCell()
      }
      direction = (direction + 1) % directions.length
    }
    stepLength += 1
  }

  return cells
}

function CombatTransitionComponent({ onComplete, fadeOut = true }: CombatTransitionProps) {
  const [viewport, setViewport] = useState(() => ({
    width: window.innerWidth,
    height: window.innerHeight,
  }))
  const [phase, setPhase] = useState<'spiral' | 'fade'>('spiral')

  useEffect(() => {
    const handleResize = () => {
      setViewport({ width: window.innerWidth, height: window.innerHeight })
    }
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [])

  // El aviso de fin se guarda en una referencia para que los tiempos no se reinicien
  // cada vez que el padre vuelve a dibujarse.
  const onCompleteRef = useRef(onComplete)
  useEffect(() => {
    onCompleteRef.current = onComplete
  }, [onComplete])

  useEffect(() => {
    const fadeTimer = fadeOut
      ? window.setTimeout(() => setPhase('fade'), SPIRAL_DURATION_MS + HOLD_MS)
      : null
    const endTimer = window.setTimeout(
      () => onCompleteRef.current?.(),
      SPIRAL_DURATION_MS + HOLD_MS + (fadeOut ? FADE_MS : 0),
    )

    return () => {
      if (fadeTimer !== null) window.clearTimeout(fadeTimer)
      window.clearTimeout(endTimer)
    }
  }, [fadeOut])

  const tiles = useMemo<SpiralTile[]>(() => {
    // Una fila y una columna de sobra para poder centrar el primer recuadro sin dejar huecos.
    const columns = Math.max(1, Math.ceil(viewport.width / TILE_SIZE_PX) + 1)
    const rows = Math.max(1, Math.ceil(viewport.height / TILE_SIZE_PX) + 1)
    const cells = createSpiralCells(columns, rows)
    // El ultimo recuadro termina de crecer justo a los 800 ms.
    const availableMs = Math.max(0, SPIRAL_DURATION_MS - TILE_GROW_MS)
    const stepMs = cells.length > 1 ? availableMs / (cells.length - 1) : 0
    // La cuadricula se corre para que la celda inicial quede en el centro exacto de la pantalla.
    const centerColumn = Math.floor((columns - 1) / 2)
    const centerRow = Math.floor((rows - 1) / 2)
    const offsetX = viewport.width / 2 - (centerColumn + 0.5) * TILE_SIZE_PX
    const offsetY = viewport.height / 2 - (centerRow + 0.5) * TILE_SIZE_PX

    return cells.map((cell, index) => ({
      key: `${cell.column}-${cell.row}`,
      left: offsetX + cell.column * TILE_SIZE_PX,
      top: offsetY + cell.row * TILE_SIZE_PX,
      delayMs: Math.round(index * stepMs),
    }))
  }, [viewport.height, viewport.width])

  return (
    <div
      className={`combat-transition${phase === 'fade' ? ' is-fading' : ''}`}
      role="presentation"
      aria-hidden="true"
      style={{ '--combat-transition-fade-ms': `${FADE_MS}ms` } as React.CSSProperties}
    >
      {tiles.map((tile) => (
        <span
          key={tile.key}
          className="combat-transition-tile"
          style={{
            left: `${tile.left}px`,
            top: `${tile.top}px`,
            width: `${TILE_SIZE_PX}px`,
            height: `${TILE_SIZE_PX}px`,
            animationDelay: `${tile.delayMs}ms`,
            animationDuration: `${TILE_GROW_MS}ms`,
          }}
        />
      ))}
    </div>
  )
}

// Son cientos de recuadros: no se vuelven a reconciliar cuando el mundo se redibuja.
export const CombatTransition = memo(CombatTransitionComponent)
