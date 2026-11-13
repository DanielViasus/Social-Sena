import type { AvatarAnimationName } from './layeredAvatar'

// A variation is a named set of assignments (for example "Levitar" or "Nadar").
// Inside it, each catalog state (Idle, Walk, custom actions) and movement direction
// points to an animation saved in the animation editor. Everything is stored
// only in this browser and is not read by the game yet.
export interface AnimationState {
  id: string
  name: string
  builtin: boolean
}

// Per-slot properties that sit next to the animation assignment.
export interface SlotSettings {
  flipX?: boolean // Mirror the animation horizontally (invert the X scale).
  flipY?: boolean // Mirror the animation vertically (invert the Y scale).
}

export interface AnimationVariation {
  id: string
  name: string
  assignments: Record<string, string> // slot key -> saved animation id
  settings: Record<string, SlotSettings> // slot key -> properties; an entry replaces Default's for that slot
}

export interface AnimationAssignments {
  version: 2
  customStates: { id: string; name: string }[]
  variations: AnimationVariation[]
}

export const BUILTIN_STATES: readonly AnimationState[] = [
  { id: 'idle', name: 'Idle', builtin: true },
  { id: 'walk', name: 'Walk', builtin: true },
]

// The character is always seen in profile, so there is no pure Up or Down: moving only
// up or down keeps the last direction. Six directions remain; `row`/`column` place each
// one around the center of the compass.
export type AssignmentDirection = 'ne' | 'e' | 'se' | 'sw' | 'w' | 'nw'
export const ASSIGNMENT_DIRECTIONS: readonly {
  id: AssignmentDirection
  label: string
  arrow: string
  row: number
  column: number
  dx: number
  dy: number
}[] = [
  { id: 'nw', label: 'UpLeft', arrow: '↖', row: 1, column: 1, dx: -1, dy: -1 },
  { id: 'ne', label: 'UpRight', arrow: '↗', row: 1, column: 3, dx: 1, dy: -1 },
  { id: 'w', label: 'Left', arrow: '←', row: 2, column: 1, dx: -1, dy: 0 },
  { id: 'e', label: 'Right', arrow: '→', row: 2, column: 3, dx: 1, dy: 0 },
  { id: 'sw', label: 'DownLeft', arrow: '↙', row: 3, column: 1, dx: -1, dy: 1 },
  { id: 'se', label: 'DownRight', arrow: '↘', row: 3, column: 3, dx: 1, dy: 1 },
]

export function directionFromVector(dx: number, dy: number): AssignmentDirection | null {
  return ASSIGNMENT_DIRECTIONS.find((direction) => direction.dx === Math.sign(dx) && direction.dy === Math.sign(dy))?.id ?? null
}

// Animation the game plays today when a slot has no assignment: it shows the back
// view while moving up and the front view otherwise (mirrored for left/right).
export const DEFAULT_SLOT_ANIMATIONS: Record<string, AvatarAnimationName> = Object.fromEntries([
  ...ASSIGNMENT_DIRECTIONS.map((direction) => [`idle:${direction.id}`, 'idle'] as const),
  ...ASSIGNMENT_DIRECTIONS.map((direction) => [
    `walk:${direction.id}`, direction.dy < 0 ? 'walkBack' : 'walkFront',
  ] as const),
])

export const MAX_STATE_NAME_LENGTH = 40
export const MAX_VARIATION_NAME_LENGTH = 40
// The main variation always exists. It is the reference used when another variation
// (Fly, Fight…) lacks an animation for a slot.
export const DEFAULT_VARIATION_ID = 'default'
export const DEFAULT_VARIATION_NAME = 'Default'
const STORAGE_KEY = 'social-sena-animation-assignments'

export function slotKey(stateId: string, direction: AssignmentDirection) {
  return `${stateId}:${direction}`
}

export function slotLabel(state: Pick<AnimationState, 'name'>, direction: AssignmentDirection) {
  const label = ASSIGNMENT_DIRECTIONS.find((item) => item.id === direction)?.label ?? direction
  return `${state.name.replace(/\s+/g, '')}${label}`
}

export function createDefaultVariation(assignments: Record<string, string> = {}): AnimationVariation {
  return { id: DEFAULT_VARIATION_ID, name: DEFAULT_VARIATION_NAME, assignments, settings: {} }
}

// Guarantees the Default variation exists and comes first.
function withDefaultVariation(variations: AnimationVariation[]): AnimationVariation[] {
  const main = variations.find((item) => item.id === DEFAULT_VARIATION_ID) ?? createDefaultVariation()
  return [{ ...main, name: DEFAULT_VARIATION_NAME }, ...variations.filter((item) => item.id !== DEFAULT_VARIATION_ID)]
}

export function emptyAssignments(): AnimationAssignments {
  return { version: 2, customStates: [], variations: [createDefaultVariation()] }
}

// Animation a variation uses for a slot: its own, else Default's, else null
// (the caller then falls back to the animation built into the game).
// By convention the animations are drawn facing right, so every slot on the left side
// (Left, UpLeft, DownLeft) starts with the X axis inverted. Settings can override it.
export function conventionalFlip(key: string): { flipX: boolean; flipY: boolean } {
  const direction = ASSIGNMENT_DIRECTIONS.find((item) => item.id === key.slice(key.lastIndexOf(':') + 1))
  return { flipX: Boolean(direction && direction.dx < 0), flipY: false }
}

// Flip settings follow the slot: a variation's own entry wins; otherwise an inherited
// animation brings Default's along; a missing value falls back to the convention above.
export function resolveSlotAnimation(
  data: AnimationAssignments,
  variationId: string,
  key: string,
): { animationId: string; inherited: boolean; flipX: boolean; flipY: boolean } | null {
  const variation = data.variations.find((item) => item.id === variationId)
  const reference = data.variations.find((item) => item.id === DEFAULT_VARIATION_ID)
  const convention = conventionalFlip(key)
  const own = variation?.assignments[key]
  if (own) {
    const settings = variation?.settings[key]
    return { animationId: own, inherited: false, flipX: settings?.flipX ?? convention.flipX, flipY: settings?.flipY ?? convention.flipY }
  }
  const inheritedId = variationId === DEFAULT_VARIATION_ID ? undefined : reference?.assignments[key]
  if (!inheritedId) return null
  const settings = variation?.settings[key] ?? reference?.settings[key]
  return { animationId: inheritedId, inherited: true, flipX: settings?.flipX ?? convention.flipX, flipY: settings?.flipY ?? convention.flipY }
}

export function countAssigned(variation: Pick<AnimationVariation, 'assignments'>) {
  return Object.keys(variation.assignments).length
}

export function listStates(data: AnimationAssignments): AnimationState[] {
  return [...BUILTIN_STATES, ...data.customStates.map((state) => ({ ...state, builtin: false }))]
}

// Slot keys are `${stateId}:${direction}`. Keys for directions that no longer exist
// (front/back, up/down from earlier versions) are dropped when loading.
function isValidSlotKey(key: string) {
  const direction = key.slice(key.lastIndexOf(':') + 1)
  return ASSIGNMENT_DIRECTIONS.some((item) => item.id === direction)
}

function sanitizeAssignments(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object') return {}
  return Object.fromEntries(
    Object.entries(value).filter(([key, id]) => typeof id === 'string' && isValidSlotKey(key)),
  ) as Record<string, string>
}

function sanitizeSettings(value: unknown): Record<string, SlotSettings> {
  if (!value || typeof value !== 'object') return {}
  const result: Record<string, SlotSettings> = {}
  for (const [key, entry] of Object.entries(value)) {
    if (!entry || typeof entry !== 'object' || !isValidSlotKey(key)) continue
    const { flipX, flipY } = entry as { flipX?: unknown; flipY?: unknown }
    result[key] = {
      ...(typeof flipX === 'boolean' ? { flipX } : {}),
      ...(typeof flipY === 'boolean' ? { flipY } : {}),
    }
  }
  return result
}

function sanitizeCustomStates(value: unknown): AnimationAssignments['customStates'] {
  if (!Array.isArray(value)) return []
  return value.flatMap((state: unknown) => {
    if (!state || typeof state !== 'object') return []
    const { id, name } = state as { id?: unknown; name?: unknown }
    if (typeof id !== 'string' || typeof name !== 'string' || BUILTIN_STATES.some((builtin) => builtin.id === id)) return []
    return [{ id, name: name.slice(0, MAX_STATE_NAME_LENGTH) }]
  })
}

export function loadAssignments(): AnimationAssignments {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return emptyAssignments()
    const parsed: unknown = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object') return emptyAssignments()
    const record = parsed as { version?: unknown; customStates?: unknown; variations?: unknown; assignments?: unknown }
    const customStates = sanitizeCustomStates(record.customStates)
    if (record.version === 2 && Array.isArray(record.variations)) {
      const variations = record.variations.flatMap((variation: unknown) => {
        if (!variation || typeof variation !== 'object') return []
        const { id, name, assignments, settings } = variation as { id?: unknown; name?: unknown; assignments?: unknown; settings?: unknown }
        if (typeof id !== 'string' || typeof name !== 'string') return []
        return [{ id, name: name.slice(0, MAX_VARIATION_NAME_LENGTH), assignments: sanitizeAssignments(assignments), settings: sanitizeSettings(settings) }]
      })
      return { version: 2, customStates, variations: withDefaultVariation(variations) }
    }
    if (record.version === 1) {
      // The first release stored one flat set of assignments; it becomes Default.
      return { version: 2, customStates, variations: [createDefaultVariation(sanitizeAssignments(record.assignments))] }
    }
    return emptyAssignments()
  } catch {
    return emptyAssignments()
  }
}

export function saveAssignments(data: AnimationAssignments): boolean {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(data))
    return true
  } catch {
    return false
  }
}
