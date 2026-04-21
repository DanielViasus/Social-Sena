import type { UserProfile } from '@social-sena/shared'

const STORAGE_KEY = 'social-sena-auth-session'

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

  return {
    provider: 'auth0',
    level: 1,
    pictureUrl: options.pictureUrl ?? null,
    profile: {
      userId: options.userId,
      username: usernameBase,
      displayName: options.displayName.trim(),
      skinId: 'default-student',
    },
  }
}
