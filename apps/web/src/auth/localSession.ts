import type { UserProfile } from '@social-sena/shared'

const STORAGE_KEY = 'social-sena-auth-session'
const SKIN_PREFERENCES_KEY = 'social-sena-skin-preferences'

export interface AuthSession {
  provider: 'local' | 'auth0'
  level: number
  pictureUrl: string | null
  profile: UserProfile
}

function normalizeUsername(value: string) {
  return value
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 20)
}

export function readStoredAuthSession(): AuthSession | null {
  const storedValue = window.localStorage.getItem(STORAGE_KEY)
  if (!storedValue) {
    return null
  }

  try {
    return JSON.parse(storedValue) as AuthSession
  } catch {
    window.localStorage.removeItem(STORAGE_KEY)
    return null
  }
}

export function saveAuthSession(session: AuthSession) {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(session))
}

export function readPreferredSkin(userId: string): string | null {
  try {
    const rawValue = window.localStorage.getItem(SKIN_PREFERENCES_KEY)
    if (!rawValue) {
      return null
    }

    const skinPreferences = JSON.parse(rawValue) as Record<string, string>
    const nextSkinId = skinPreferences[userId]
    return typeof nextSkinId === 'string' && nextSkinId.trim() ? nextSkinId : null
  } catch {
    return null
  }
}

export function savePreferredSkin(userId: string, skinId: string) {
  try {
    const rawValue = window.localStorage.getItem(SKIN_PREFERENCES_KEY)
    const currentPreferences = rawValue ? (JSON.parse(rawValue) as Record<string, string>) : {}
    currentPreferences[userId] = skinId
    window.localStorage.setItem(SKIN_PREFERENCES_KEY, JSON.stringify(currentPreferences))
  } catch {
    window.localStorage.setItem(SKIN_PREFERENCES_KEY, JSON.stringify({ [userId]: skinId }))
  }
}

export function clearAuthSession() {
  window.localStorage.removeItem(STORAGE_KEY)
}

export function createLocalAuthSession(displayName: string): AuthSession {
  const usernameBase = normalizeUsername(displayName) || 'jugador'
  const suffix = crypto.randomUUID().slice(0, 8)

  return {
    provider: 'local',
    level: 1,
    pictureUrl: null,
    profile: {
      userId: `player_${suffix}`,
      username: `${usernameBase}_${suffix.slice(0, 4)}`,
      displayName: displayName.trim(),
      skinId: 'default-student',
    },
  }
}

export function createAuth0Session(options: {
  displayName: string
  userId: string
  username?: string
  pictureUrl?: string | null
}): AuthSession {
  const usernameBase = normalizeUsername(options.username ?? options.displayName) || 'jugador'
  const preferredSkinId = readPreferredSkin(options.userId)

  return {
    provider: 'auth0',
    level: 1,
    pictureUrl: options.pictureUrl ?? null,
    profile: {
      userId: options.userId,
      username: usernameBase,
      displayName: options.displayName.trim(),
      skinId: preferredSkinId ?? 'default-student',
    },
  }
}
