export function getScrubbedValue(startValue: number, startX: number, currentX: number) {
  return Math.round((startValue + currentX - startX) * 1000) / 1000
}
