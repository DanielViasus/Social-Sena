import type { AnimationAssignments } from './animationAssignmentStorage'
import { loadAnimation } from './animationEditorStorage'
import { toSkeleton, type AnimationSkeleton } from './animationSkeleton'

// Paquete de solo datos con unas asignaciones y las animaciones que usan.
// Sirve como respaldo incluido en el juego y para exportar/importar entre navegadores.
export interface AnimationPack {
  format: 'social-sena-animation-pack'
  version: 1
  config: AnimationAssignments
  animations: Array<{ id: string; name: string; document: AnimationSkeleton }>
}

export const ANIMATION_PACK_FORMAT = 'social-sena-animation-pack'

// Convierte las asignaciones guardadas en este navegador (y sus animaciones de IndexedDB) en un paquete.
export async function buildAnimationPack(
  assignments: AnimationAssignments,
): Promise<{ ok: true; pack: AnimationPack } | { ok: false; message: string }> {
  const ids = [...new Set(assignments.variations.flatMap((variation) => Object.values(variation.assignments)))]
  const animations: AnimationPack['animations'] = []
  for (const id of ids) {
    const animation = await loadAnimation(id)
    if (!animation) return { ok: false, message: 'Una animación asignada ya no existe en este navegador.' }
    const skeleton = toSkeleton(animation.document)
    if (!skeleton.ok) return { ok: false, message: `“${animation.name}”: ${skeleton.error}` }
    animations.push({ id: animation.id, name: animation.name, document: skeleton.skeleton })
  }
  return { ok: true, pack: { format: ANIMATION_PACK_FORMAT, version: 1, config: assignments, animations } }
}

export function isAnimationPack(value: unknown): value is AnimationPack {
  if (!value || typeof value !== 'object') return false
  const pack = value as AnimationPack
  return pack.format === ANIMATION_PACK_FORMAT
    && pack.version === 1
    && Boolean(pack.config)
    && pack.config.version === 2
    && Array.isArray(pack.config.variations)
    && Array.isArray(pack.animations)
}

export function parseAnimationPack(text: string): { ok: true; pack: AnimationPack } | { ok: false; message: string } {
  try {
    const parsed: unknown = JSON.parse(text)
    if (!isAnimationPack(parsed)) return { ok: false, message: 'El archivo no es un paquete de animaciones válido.' }
    return { ok: true, pack: parsed }
  } catch {
    return { ok: false, message: 'El archivo no es JSON válido.' }
  }
}

export function downloadAnimationPack(pack: AnimationPack) {
  const blob = new Blob([JSON.stringify(pack, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = 'defaultAnimationPack.json'
  link.click()
  URL.revokeObjectURL(url)
}
