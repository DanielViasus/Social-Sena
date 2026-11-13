export const AVATAR_PARTS = [
  'piernaIzquierda', 'piernaDerecha', 'manoIzquierda', 'cuerpo', 'manoDerecha', 'cabeza',
] as const

export type AvatarPart = typeof AVATAR_PARTS[number]

// Animations may also use shadow (`..._sombra.svg`) and accessory (`..._accesorios.svg`) layers. They are not a body part, so
// the legacy avatar animations and equipment keep working with AVATAR_PARTS only.
export const ACCESSORY_PART = 'accesorios' as const
export const SHADOW_PART = 'sombra' as const
export const ANIMATION_PARTS = [...AVATAR_PARTS, SHADOW_PART, ACCESSORY_PART] as const
export type AnimationPart = typeof ANIMATION_PARTS[number]
export type AvatarView = 'f' | 'b'

export interface SkinLayerAsset {
  tier: number
  coinCost: number
  view: AvatarView
  skin: string
  part: AnimationPart
  url: string
}

// The filename describes the piece; its price is metadata only for now.
export function parseSkinLayerAsset(path: string, url: string): SkinLayerAsset | null {
  const filename = path.split('/').pop() ?? ''
  const match = /^sk_(\d+)_(\d+)_(f|b)_([^_]+)_([^_.]+)\.svg$/.exec(filename)
  if (!match || !(ANIMATION_PARTS as readonly string[]).includes(match[5])) return null
  return {
    tier: Number(match[1]),
    coinCost: Number(match[2]),
    view: match[3] as AvatarView,
    skin: match[4],
    part: match[5] as AnimationPart,
    url,
  }
}

const imageUrls = import.meta.glob<string>('../../assets/characters/**/sk_*.svg', {
  eager: true, query: '?url', import: 'default',
})

export const skinLayerAssets = Object.entries(imageUrls).flatMap(([path, url]) => {
  const asset = parseSkinLayerAsset(path, url)
  return asset ? [asset] : []
})

export interface AvatarLayerPose {
  visible?: boolean // Defaults to visible; false omits the layer from this frame.
  x: number
  y: number
  rotation: number // Degrees in the 2D plane, around the center of the 128 × 128 canvas.
  order: number // Zero is the backmost layer.
}

export interface AvatarAnimationFrame {
  durationMs: number
  layers: Record<'sombra' | AvatarPart, AvatarLayerPose>
}

export interface AvatarAnimation {
  frames: AvatarAnimationFrame[] // The cycle supports any number of frames.
}

const idleFrame0: AvatarAnimationFrame = {
  durationMs: 85,
  layers: {
    sombra: { x: 0, y: 0, rotation: 0, order: 0 },
    piernaIzquierda: { x: 0, y: 0, rotation: 0, order: 1 },
    piernaDerecha: { x: 0, y: 0, rotation: 0, order: 2 },
    manoIzquierda: { x: 0, y: 0, rotation: 0, order: 3 },
    cuerpo: { x: 0, y: 0, rotation: 0, order: 4 },
    manoDerecha: { x: 0, y: 0, rotation: 0, order: 5 },
    cabeza: { x: 0, y: 0, rotation: 0, order: 6 },
  },
}

const idleFrame1: AvatarAnimationFrame = {
  durationMs: idleFrame0.durationMs,
  layers: {
    ...idleFrame0.layers,
    cabeza: { ...idleFrame0.layers.cabeza, y: 4 },
  },
}

const idleFrame2: AvatarAnimationFrame = {
  durationMs: idleFrame0.durationMs,
  layers: {
    ...idleFrame1.layers,
    manoIzquierda: { ...idleFrame1.layers.manoIzquierda, y: 4 },
    manoDerecha: { ...idleFrame1.layers.manoDerecha, y: 4 },
  },
}

const idleFrame3: AvatarAnimationFrame = {
  durationMs: idleFrame0.durationMs,
  layers: {
    ...idleFrame2.layers,
    cabeza: { ...idleFrame2.layers.cabeza, y: 0 },
  },
}

function createMidpointFrame(
  from: AvatarAnimationFrame,
  to: AvatarAnimationFrame,
): AvatarAnimationFrame {
  const layers = { ...from.layers }
  for (const part of ['sombra', ...AVATAR_PARTS] as const) {
    const start = from.layers[part]
    const end = to.layers[part]
    layers[part] = {
      x: (start.x + end.x) / 2,
      y: (start.y + end.y) / 2,
      rotation: (start.rotation + end.rotation) / 2,
      // Draw order stays discrete until the next authored pose.
      order: start.order,
    }
  }
  return { durationMs: from.durationMs, layers }
}

const idleBaseFrames = [idleFrame0, idleFrame1, idleFrame2, idleFrame3]

const walkFrontFrame0: AvatarAnimationFrame = {
  durationMs: 85,
  layers: {
    ...Object.fromEntries(
      Object.entries(idleFrame0.layers).map(([part, pose]) => [part, { ...pose }]),
    ) as AvatarAnimationFrame['layers'],
    manoDerecha: { ...idleFrame0.layers.manoDerecha, order: 9 },
  },
}

const walkFrontFrame1: AvatarAnimationFrame = {
  durationMs: walkFrontFrame0.durationMs,
  layers: {
    ...Object.fromEntries(
      Object.entries(walkFrontFrame0.layers).map(([part, pose]) => [
        part, { ...pose, y: pose.y - 4 },
      ]),
    ) as AvatarAnimationFrame['layers'],
    manoDerecha: {
      ...walkFrontFrame0.layers.manoDerecha,
      y: -8,
    },
    manoIzquierda: {
      ...walkFrontFrame0.layers.manoIzquierda,
      x: 6,
      y: -12,
    },
    piernaIzquierda: {
      ...walkFrontFrame0.layers.piernaIzquierda,
      x: -22,
      y: 50,
      rotation: -90,
      order: 8,
    },
    piernaDerecha: {
      ...walkFrontFrame0.layers.piernaDerecha,
      x: 18,
      y: 54,
      rotation: 90,
      order: 7,
    },
  },
}

const walkFrontFrame2: AvatarAnimationFrame = {
  durationMs: walkFrontFrame0.durationMs,
  layers: Object.fromEntries(
    Object.entries(walkFrontFrame0.layers).map(([part, pose]) => [part, { ...pose }]),
  ) as AvatarAnimationFrame['layers'],
}

const walkFrontFrame3: AvatarAnimationFrame = {
  durationMs: walkFrontFrame1.durationMs,
  layers: {
    ...walkFrontFrame1.layers,
    manoIzquierda: {
      ...walkFrontFrame1.layers.manoIzquierda,
      visible: true,
      x: walkFrontFrame1.layers.manoIzquierda.x - 10,
      order: -1,
    },
    manoDerecha: { ...walkFrontFrame1.layers.manoDerecha, x: 16, y: -8 },
  },
}

function createWalkHandsMidpointFrame(
  from: AvatarAnimationFrame,
  to: AvatarAnimationFrame,
): AvatarAnimationFrame {
  const layers = { ...from.layers }
  for (const part of ['manoIzquierda', 'manoDerecha'] as const) {
    const start = from.layers[part]
    const end = to.layers[part]
    layers[part] = {
      ...start,
      x: (start.x + end.x) / 2,
      y: (start.y + end.y) / 2,
    }
  }
  return { durationMs: from.durationMs, layers }
}

const walkFrontBaseFrames = [walkFrontFrame0, walkFrontFrame1, walkFrontFrame2, walkFrontFrame3]

const walkBackFrame0: AvatarAnimationFrame = {
  durationMs: 85,
  layers: {
    sombra: { x: 0, y: 0, rotation: 0, order: 0 },
    piernaDerecha: { x: 0, y: 0, rotation: 0, order: 1 },
    piernaIzquierda: { x: 0, y: 0, rotation: 0, order: 2 },
    manoDerecha: { x: 0, y: 0, rotation: 0, order: 3 },
    cabeza: { x: 0, y: 0, rotation: 0, order: 4 },
    cuerpo: { x: 0, y: 0, rotation: 0, order: 5 },
    manoIzquierda: { x: 0, y: 0, rotation: 0, order: 6 },
  },
}

export type AvatarAnimationName = 'idle' | 'walkFront' | 'walkBack'

export const avatarAnimations: Record<AvatarAnimationName, AvatarAnimation> = {
  idle: {
    frames: idleBaseFrames.flatMap((frame, index) => [
      frame,
      createMidpointFrame(frame, idleBaseFrames[(index + 1) % idleBaseFrames.length]),
    ]),
  },
  walkFront: {
    frames: walkFrontBaseFrames.flatMap((frame, index) => [
      frame,
      createWalkHandsMidpointFrame(frame, walkFrontBaseFrames[(index + 1) % walkFrontBaseFrames.length]),
    ]),
  },
  walkBack: {
    frames: [walkBackFrame0],
  },
}

export type AvatarEquipment = Record<AvatarPart, SkinLayerAsset | undefined>

export function getSkinEquipment(skin: string, view: AvatarView): AvatarEquipment {
  return Object.fromEntries(AVATAR_PARTS.map((part) => [
    part, skinLayerAssets.find((asset) => asset.skin === skin && asset.view === view && asset.part === part),
  ])) as AvatarEquipment
}

export type AnimationEquipment = Record<AnimationPart, SkinLayerAsset | undefined>

export function getSkinAnimationEquipment(skin: string, view: AvatarView): AnimationEquipment {
  return Object.fromEntries(ANIMATION_PARTS.map((part) => [
    part, skinLayerAssets.find((asset) => asset.skin === skin && asset.view === view && asset.part === part),
  ])) as AnimationEquipment
}

// Equipment for a customized character: each part can come from a different skin collection
// (e.g. { cabeza: 'crock' } keeps the body of the default skin and swaps only the head).
// A part the chosen skin does not have for this view falls back to the default skin, so a
// partial collection never leaves a hole in the character.
export function buildAnimationEquipment(
  partSkins: Partial<Record<AnimationPart, string>>,
  defaultSkin: string,
  view: AvatarView,
): AnimationEquipment {
  const find = (skin: string, part: AnimationPart) => skinLayerAssets.find((asset) => (
    asset.skin === skin && asset.view === view && asset.part === part
  ))
  return Object.fromEntries(ANIMATION_PARTS.map((part) => {
    const chosen = partSkins[part]
    return [part, (chosen ? find(chosen, part) : undefined) ?? find(defaultSkin, part)]
  })) as AnimationEquipment
}

export const chapFrontAnimationEquipment = getSkinAnimationEquipment('chap', 'f')

export const chapBackAnimationEquipment = getSkinAnimationEquipment('chap', 'b')

export const chapFrontEquipment = getSkinEquipment('chap', 'f')

export const chapBackEquipment = getSkinEquipment('chap', 'b')

export const idleBackLayerOrder: Record<'sombra' | AvatarPart, number> = {
  sombra: 0,
  manoIzquierda: 5,
  piernaDerecha: 2,
  piernaIzquierda: 3,
  cuerpo: 4,
  manoDerecha: 1,
  cabeza: 6,
}
