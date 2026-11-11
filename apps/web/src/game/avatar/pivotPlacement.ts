export const PIVOT_GRID_SIZE = 1

export function snapPivotCoordinate(value: number) {
  return Math.round(value / PIVOT_GRID_SIZE) * PIVOT_GRID_SIZE || 0
}

// Map a viewport click onto a transformed image, preserving its visible pose
// when the rotation origin changes. The renderer projects onto a 2D plane.
export function placeImagePivot(
  layer: { x: number; y: number; pivotX: number; pivotY: number },
  point: { x: number; y: number },
  matrix: { a: number; b: number; c: number; d: number },
  size = 128,
) {
  const { a, b, c, d } = matrix
  const determinant = a * d - b * c
  if (Math.abs(determinant) < 0.000001) return null
  const oldX = size / 2 + layer.pivotX
  const oldY = size / 2 + layer.pivotY
  const dx = point.x - layer.x - oldX
  const dy = point.y - layer.y - oldY
  const localX = size / 2 + snapPivotCoordinate(oldX + (d * dx - c * dy) / determinant - size / 2)
  const localY = size / 2 + snapPivotCoordinate(oldY + (-b * dx + a * dy) / determinant - size / 2)
  const deltaX = oldX - localX
  const deltaY = oldY - localY
  const round = (value: number) => Math.round(value * 1000) / 1000
  return {
    pivotX: round(localX - size / 2),
    pivotY: round(localY - size / 2),
    x: round(layer.x + deltaX - (a * deltaX + c * deltaY)),
    y: round(layer.y + deltaY - (b * deltaX + d * deltaY)),
  }
}
