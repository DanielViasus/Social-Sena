function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max)
}

function normalizeHexColor(color: string) {
  const hex = color.trim().replace('#', '')
  if (hex.length === 3) {
    return hex
      .split('')
      .map((channel) => `${channel}${channel}`)
      .join('')
  }

  return hex.padEnd(6, '0').slice(0, 6)
}

function parseHexColor(color: string) {
  const normalized = normalizeHexColor(color)
  return {
    r: Number.parseInt(normalized.slice(0, 2), 16),
    g: Number.parseInt(normalized.slice(2, 4), 16),
    b: Number.parseInt(normalized.slice(4, 6), 16),
  }
}

export function mixHexColor(color: string, target: string, weight: number) {
  const amount = clamp(weight, 0, 1)
  const base = parseHexColor(color)
  const tint = parseHexColor(target)
  const toHex = (channel: number) =>
    Math.round(channel)
      .toString(16)
      .padStart(2, '0')

  return `#${toHex(base.r + (tint.r - base.r) * amount)}${toHex(base.g + (tint.g - base.g) * amount)}${toHex(base.b + (tint.b - base.b) * amount)}`
}

export function withAlpha(color: string, alpha: number) {
  const { r, g, b } = parseHexColor(color)
  return `rgba(${r}, ${g}, ${b}, ${clamp(alpha, 0, 1)})`
}

export function createAvatarBubblePalette(primaryColor: string) {
  const border = mixHexColor(primaryColor, '#000000', 0.22)

  return {
    fill: mixHexColor(primaryColor, '#FFFFFF', 0.78),
    border,
    outline: primaryColor,
    shadow: withAlpha(border, 0.24),
    title: border,
    ink: '#102033',
  }
}
