import type { PlayerProgress } from './types'

/** Experiencia total necesaria para alcanzar el nivel N: 100 × (N - 1)². */
export const PLAYER_EXPERIENCE_CURVE_BASE = 100

/** Mantiene la experiencia dentro del rango seguro de un integer de Postgres. */
export const MAX_PLAYER_EXPERIENCE = 2_000_000_000

export function normalizePlayerExperience(value: unknown) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return 0
  }

  return Math.min(MAX_PLAYER_EXPERIENCE, Math.max(0, Math.floor(value)))
}

export function experienceRequiredForLevel(level: number) {
  const normalizedLevel = Number.isFinite(level) ? Math.max(1, Math.floor(level)) : 1
  const completedLevels = normalizedLevel - 1

  return normalizePlayerExperience(
    PLAYER_EXPERIENCE_CURVE_BASE * completedLevels * completedLevels,
  )
}

export function levelFromExperience(experience: number) {
  const normalizedExperience = normalizePlayerExperience(experience)

  return Math.floor(Math.sqrt(normalizedExperience / PLAYER_EXPERIENCE_CURVE_BASE)) + 1
}

export function derivePlayerProgress(experience: number): PlayerProgress {
  const normalizedExperience = normalizePlayerExperience(experience)

  return {
    level: levelFromExperience(normalizedExperience),
    experience: normalizedExperience,
  }
}
