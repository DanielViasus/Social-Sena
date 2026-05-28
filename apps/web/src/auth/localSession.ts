import type { SkinColorSelections, UserProfile } from '@social-sena/shared'

const STORAGE_KEY = 'social-sena-auth-session'
const SKIN_PREFERENCES_KEY = 'social-sena-skin-preferences'

interface StoredSkinPreferenceEntry {
  skinId?: string
  skinColorsBySkinId?: Record<string, SkinColorSelections>
}

type StoredSkinPreferences = Record<string, string | StoredSkinPreferenceEntry>

export interface AuthSession {
  provider: 'local' | 'auth0'
  level: number
  experience: number
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

function normalizeSkinColors(value: unknown): SkinColorSelections {
  if (!value || typeof value !== 'object') {
    return {}
  }

  return Object.fromEntries(
    Object.entries(value).filter(
      (entry): entry is [string, string] =>
        typeof entry[0] === 'string' &&
        entry[0].trim().length > 0 &&
        typeof entry[1] === 'string' &&
        entry[1].trim().length > 0,
    ),
  )
}

function normalizeStoredSkinPreferenceEntry(entry: string | StoredSkinPreferenceEntry | undefined) {
  if (typeof entry === 'string') {
    return {
      skinId: entry,
      skinColorsBySkinId: {},
    }
  }

  if (!entry || typeof entry !== 'object') {
    return {
      skinId: undefined,
      skinColorsBySkinId: {},
    }
  }

  const nextSkinColorsBySkinId = Object.fromEntries(
    Object.entries(entry.skinColorsBySkinId ?? {}).map(([skinId, skinColors]) => [
      skinId,
      normalizeSkinColors(skinColors),
    ]),
  )

  return {
    skinId: typeof entry.skinId === 'string' && entry.skinId.trim() ? entry.skinId : undefined,
    skinColorsBySkinId: nextSkinColorsBySkinId,
  }
}

function readStoredSkinPreferences(): StoredSkinPreferences {
  try {
    const rawValue = window.localStorage.getItem(SKIN_PREFERENCES_KEY)
    if (!rawValue) {
      return {}
    }

    const parsed = JSON.parse(rawValue)
    return parsed && typeof parsed === 'object' ? (parsed as StoredSkinPreferences) : {}
  } catch {
    return {}
  }
}

function writeStoredSkinPreferences(nextPreferences: StoredSkinPreferences) {
  window.localStorage.setItem(SKIN_PREFERENCES_KEY, JSON.stringify(nextPreferences))
}

export function readStoredAuthSession(): AuthSession | null {
  const storedValue = window.localStorage.getItem(STORAGE_KEY)
  if (!storedValue) {
    return null
  }

  try {
    const parsedSession = JSON.parse(storedValue) as AuthSession
    return {
      ...parsedSession,
      experience: typeof parsedSession.experience === 'number' ? parsedSession.experience : 0,
      profile: {
        ...parsedSession.profile,
        skinColors: normalizeSkinColors(parsedSession.profile.skinColors),
      },
    }
  } catch {
    window.localStorage.removeItem(STORAGE_KEY)
    return null
  }
}

export function saveAuthSession(session: AuthSession) {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(session))
}

export function readPreferredSkin(userId: string): string | null {
  const entry = normalizeStoredSkinPreferenceEntry(readStoredSkinPreferences()[userId])
  return entry.skinId ?? null
}

export function readPreferredSkinColors(userId: string, skinId: string): SkinColorSelections {
  const entry = normalizeStoredSkinPreferenceEntry(readStoredSkinPreferences()[userId])
  return normalizeSkinColors(entry.skinColorsBySkinId[skinId])
}

export function savePreferredSkin(userId: string, skinId: string) {
  const currentPreferences = readStoredSkinPreferences()
  const currentEntry = normalizeStoredSkinPreferenceEntry(currentPreferences[userId])

  writeStoredSkinPreferences({
    ...currentPreferences,
    [userId]: {
      skinId,
      skinColorsBySkinId: currentEntry.skinColorsBySkinId,
    },
  })
}

export function savePreferredSkinColors(userId: string, skinId: string, skinColors: SkinColorSelections) {
  const currentPreferences = readStoredSkinPreferences()
  const currentEntry = normalizeStoredSkinPreferenceEntry(currentPreferences[userId])

  writeStoredSkinPreferences({
    ...currentPreferences,
    [userId]: {
      skinId: currentEntry.skinId ?? skinId,
      skinColorsBySkinId: {
        ...currentEntry.skinColorsBySkinId,
        [skinId]: normalizeSkinColors(skinColors),
      },
    },
  })
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
    experience: 0,
    pictureUrl: null,
    profile: {
      userId: `player_${suffix}`,
      username: `${usernameBase}_${suffix.slice(0, 4)}`,
      displayName: displayName.trim(),
      skinId: 'default-student',
      skinColors: {},
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
  const preferredSkinId = readPreferredSkin(options.userId) ?? 'default-student'
  const preferredSkinColors = readPreferredSkinColors(options.userId, preferredSkinId)

  return {
    provider: 'auth0',
    level: 1,
    experience: 0,
    pictureUrl: options.pictureUrl ?? null,
    profile: {
      userId: options.userId,
      username: usernameBase,
      displayName: options.displayName.trim(),
      skinId: preferredSkinId,
      skinColors: preferredSkinColors,
    },
  }
}
