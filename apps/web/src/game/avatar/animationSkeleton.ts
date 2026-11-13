import { ANIMATION_PARTS, type AnimationPart } from './layeredAvatar'
import type { AnimationEditorDocument, EditorImageLayer } from './animationEditorStorage'

// A skeleton is an animation reduced to data: per frame and layer it only says which part
// of the skin to draw and how to place it. Images come from the equipped skin, found by
// the file naming convention sk_<tier>_<coins>_<f|b>_<skin>_<part>.
export interface SkeletonLayer {
  id: string
  visible: boolean
  x: number
  y: number
  rotation: number
  rotationX: number
  rotationY: number
  pivotX: number
  pivotY: number
  part: AnimationPart
}

export interface SkeletonFrame {
  id: string
  durationMs: number
  layers: SkeletonLayer[] // Frontmost layer first.
}

export interface AnimationSkeleton {
  frames: SkeletonFrame[]
  sceneSize: { width: number; height: number }
}

// Older layers have no part. It is read from the layer name when that follows the file convention
// (sk_<tier>_<coins>_<f|b>_<skin>_<part>, with or without .svg) or is exactly a part name.
const CONVENTION_NAME = /^sk_\d+_\d+_[fb]_[^_]+_([^_.]+)(?:\.svg)?$/i

export function inferLayerPart(layer: Pick<EditorImageLayer, 'part' | 'name'>): AnimationPart | undefined {
  if (layer.part) return layer.part
  const name = layer.name.trim()
  const candidate = (CONVENTION_NAME.exec(name)?.[1] ?? name).toLowerCase()
  return ANIMATION_PARTS.find((part) => part.toLowerCase() === candidate)
}

export function toSkeleton(document: AnimationEditorDocument): { ok: true; skeleton: AnimationSkeleton } | { ok: false; error: string } {
  const frames: SkeletonFrame[] = []
  for (const [frameIndex, frame] of document.frames.entries()) {
    const layers: SkeletonLayer[] = []
    for (const layer of frame.layers) {
      const part = inferLayerPart(layer)
      if (!part) return { ok: false, error: `La capa “${layer.name}” (frame ${frameIndex + 1}) no tiene parte del avatar asignada.` }
      layers.push({
        id: layer.id, visible: layer.visible, x: layer.x, y: layer.y, rotation: layer.rotation,
        rotationX: layer.rotationX, rotationY: layer.rotationY, pivotX: layer.pivotX, pivotY: layer.pivotY, part,
      })
    }
    frames.push({ id: frame.id, durationMs: frame.durationMs, layers })
  }
  return { ok: true, skeleton: { frames, sceneSize: document.sceneSize } }
}
