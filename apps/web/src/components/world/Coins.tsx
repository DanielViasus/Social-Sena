import { memo, type CSSProperties } from 'react'

interface CoinAnimationDefinition {
  sheetWidth: number
  sheetHeight: number
  frameWidth: number
  frameHeight: number
  frameCount: number
  columns: number
  rows: number
  frameDurationMs: number
}

interface CoinsProps {
  spriteSrc: string
  label?: string
  opacity?: number
  flippedX?: boolean
  animation: CoinAnimationDefinition
}

export const Coins = memo(function Coins({
  spriteSrc,
  label = 'Moneda',
  opacity = 1,
  flippedX = false,
  animation,
}: CoinsProps) {
  const animationWidth = animation.columns * animation.frameWidth
  const animationHeight = animation.rows * animation.frameHeight
  const rowDurationMs = animation.columns * animation.frameDurationMs
  const totalDurationMs = animation.frameCount * animation.frameDurationMs
  const coinStyle = {
    '--coin-columns': animation.columns,
    '--coin-rows': animation.rows,
    '--coin-animation-width': `${animationWidth}px`,
    '--coin-animation-height': `${animationHeight}px`,
    '--coin-row-duration': `${rowDurationMs}ms`,
    '--coin-total-duration': `${totalDurationMs}ms`,
    width: `${animation.frameWidth}px`,
    height: `${animation.frameHeight}px`,
    backgroundImage: `url(${JSON.stringify(spriteSrc)})`,
    backgroundSize: `${animation.sheetWidth}px ${animation.sheetHeight}px`,
    opacity,
  } as CSSProperties

  return (
    <span
      className={`world-coins${flippedX ? ' is-flipped' : ''}`}
      role="img"
      aria-label={label}
      style={coinStyle}
    />
  )
})
