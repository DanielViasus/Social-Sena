import {
  DEFAULT_AUDIO_SETTINGS,
  DEFAULT_USER_ROLE,
  normalizeAudioSettings,
  type PlayerInventory,
  type SkinColorSelections,
  type UserProfile,
} from '@social-sena/shared'

const STORAGE_KEY = 'social-sena-auth-session'
const CLIENT_SESSION_STORAGE_KEY = 'social-sena-client-session'
const SESSION_REPLACEMENT_STORAGE_KEY = 'social-sena-session-replacement'
const SESSION_REAUTHENTICATED_STORAGE_KEY = 'social-sena-session-reauthenticated'
const SKIN_PREFERENCES_KEY = 'social-sena-skin-preferences'

interface StoredSkinPreferenceEntry {
  skinId?: string
  skinColorsBySkinId?: Record<string, SkinColorSelections>
}

type StoredSkinPreferences = Record<string, string | StoredSkinPreferenceEntry>

export interface AuthSession {
  clientSessionId: string
  provider: 'local' | 'auth0'
  level: number
  experience: number
  inventory: PlayerInventory
  pictureUrl: string | null
  profile: UserProfile
}

interface StoredClientSession {
  clientSessionId: string
  userId: string
}

interface SessionReplacementMarker {
  clientSessionId: string
  message: string
  userId: string
}

interface ClearAuthSessionOptions {
  preserveClientSessionId?: boolean
}

function readStoredClientSession(): Partial<StoredClientSession> | null {
  try {
    const storedValue = window.sessionStorage.getItem(CLIENT_SESSION_STORAGE_KEY)
    if (!storedValue) {
      return null
    }

    const storedSession = JSON.parse(storedValue) as Partial<StoredClientSession>
    return storedSession && typeof storedSession === 'object' ? storedSession : null
  } catch {
    window.sessionStorage.removeItem(CLIENT_SESSION_STORAGE_KEY)
    return null
  }
}

function getOrCreateClientSessionId(userId: string) {
  const storedSession = readStoredClientSession()
  if (
    storedSession?.userId === userId &&
    typeof storedSession.clientSessionId === 'string' &&
    storedSession.clientSessionId.length > 0
  ) {
    return storedSession.clientSessionId
  }

  const clientSessionId = crypto.randomUUID()
  const nextStoredSession: StoredClientSession = { clientSessionId, userId }
  window.sessionStorage.setItem(CLIENT_SESSION_STORAGE_KEY, JSON.stringify(nextStoredSession))
  return clientSessionId
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

function normalizeInventory(value: unknown): PlayerInventory {
  if (!value || typeof value !== 'object') {
    return {}
  }

  return Object.fromEntries(
    Object.entries(value).flatMap(([itemId, itemValue]) => {
      if (typeof itemId !== 'string' || itemId.trim().length === 0 || !itemValue || typeof itemValue !== 'object') {
        return []
      }

      const rawQuantity = 'quantity' in itemValue ? itemValue.quantity : undefined
      const quantity = typeof rawQuantity === 'number' && Number.isFinite(rawQuantity) ? Math.max(0, Math.floor(rawQuantity)) : 0
      const rawMetadata = 'metadata' in itemValue ? itemValue.metadata : undefined
      const metadata =
        rawMetadata && typeof rawMetadata === 'object'
          ? Object.fromEntries(
              Object.entries(rawMetadata).filter(
                (entry): entry is [string, string | number | boolean | null] =>
                  typeof entry[0] === 'string' &&
                  entry[0].trim().length > 0 &&
                  (typeof entry[1] === 'string' ||
                    typeof entry[1] === 'number' ||
                    typeof entry[1] === 'boolean' ||
                    entry[1] === null),
              ),
            )
          : undefined

      return [[itemId, metadata && Object.keys(metadata).length > 0 ? { quantity, metadata } : { quantity }]]
    }),
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

function readRawStoredAuthSession() {
  const sessionStorageValue = window.sessionStorage.getItem(STORAGE_KEY)
  if (sessionStorageValue) {
    return sessionStorageValue
  }

  const localStorageValue = window.localStorage.getItem(STORAGE_KEY)
  if (!localStorageValue) {
    return null
  }

  return localStorageValue
}

export function readStoredAuthSession(): AuthSession | null {
  const storedValue = readRawStoredAuthSession()
  if (!storedValue) {
    return null
  }

  try {
    const parsedSession = JSON.parse(storedValue) as AuthSession
    return {
      ...parsedSession,
      clientSessionId: getOrCreateClientSessionId(parsedSession.profile.userId),
      experience: typeof parsedSession.experience === 'number' ? parsedSession.experience : 0,
      inventory: normalizeInventory(parsedSession.inventory),
      profile: {
        ...parsedSession.profile,
        role: parsedSession.profile.role ?? DEFAULT_USER_ROLE,
        skinColors: normalizeSkinColors(parsedSession.profile.skinColors),
        audioSettings: normalizeAudioSettings(parsedSession.profile.audioSettings),
      },
    }
  } catch {
    window.sessionStorage.removeItem(STORAGE_KEY)
    window.localStorage.removeItem(STORAGE_KEY)
    return null
  }
}

export function saveAuthSession(session: AuthSession) {
  const serializedSession = JSON.stringify(session)
  if (session.provider === 'local') {
    window.localStorage.setItem(STORAGE_KEY, serializedSession)
    window.sessionStorage.removeItem(STORAGE_KEY)
    return
  }

  window.localStorage.setItem(STORAGE_KEY, serializedSession)
  window.sessionStorage.removeItem(STORAGE_KEY)
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

export function clearAuthSession(
  clientSessionId?: string,
  options: ClearAuthSessionOptions = {},
) {
  window.sessionStorage.removeItem(STORAGE_KEY)
  if (!options.preserveClientSessionId) {
    window.sessionStorage.removeItem(CLIENT_SESSION_STORAGE_KEY)
  }
  window.sessionStorage.removeItem(SESSION_REAUTHENTICATED_STORAGE_KEY)
  window.localStorage.removeItem(SESSION_REPLACEMENT_STORAGE_KEY)

  if (!clientSessionId) {
    window.localStorage.removeItem(STORAGE_KEY)
    return
  }

  try {
    const storedValue = window.localStorage.getItem(STORAGE_KEY)
    if (!storedValue) {
      return
    }

    const storedSession = JSON.parse(storedValue) as Partial<AuthSession>
    if (!storedSession.clientSessionId || storedSession.clientSessionId === clientSessionId) {
      window.localStorage.removeItem(STORAGE_KEY)
    }
  } catch {
    window.localStorage.removeItem(STORAGE_KEY)
  }
}

export function readSessionReplacementMessage() {
  const storedValue = window.localStorage.getItem(SESSION_REPLACEMENT_STORAGE_KEY)
  if (!storedValue) {
    return null
  }

  try {
    const marker = JSON.parse(storedValue) as Partial<SessionReplacementMarker>
    if (
      typeof marker.clientSessionId !== 'string' ||
      typeof marker.message !== 'string' ||
      typeof marker.userId !== 'string'
    ) {
      return storedValue
    }

    const tabSession = readStoredClientSession()
    if (
      typeof tabSession?.clientSessionId === 'string' &&
      tabSession.clientSessionId !== marker.clientSessionId
    ) {
      window.localStorage.removeItem(SESSION_REPLACEMENT_STORAGE_KEY)
      return null
    }

    if (!tabSession?.clientSessionId) {
      const storedAuthValue = window.localStorage.getItem(STORAGE_KEY)
      if (storedAuthValue) {
        const storedAuthSession = JSON.parse(storedAuthValue) as Partial<AuthSession>
        if (
          storedAuthSession.profile?.userId === marker.userId &&
          typeof storedAuthSession.clientSessionId === 'string' &&
          storedAuthSession.clientSessionId !== marker.clientSessionId
        ) {
          window.localStorage.removeItem(SESSION_REPLACEMENT_STORAGE_KEY)
          return null
        }
      }
    }

    return marker.message
  } catch {
    return storedValue
  }
}

export function saveSessionReplacementMessage(
  message: string,
  session: Pick<SessionReplacementMarker, 'clientSessionId' | 'userId'>,
) {
  const marker: SessionReplacementMarker = {
    clientSessionId: session.clientSessionId,
    message,
    userId: session.userId,
  }
  window.localStorage.setItem(SESSION_REPLACEMENT_STORAGE_KEY, JSON.stringify(marker))
}

export function clearSessionReplacementMessage() {
  window.localStorage.removeItem(SESSION_REPLACEMENT_STORAGE_KEY)
  window.sessionStorage.removeItem(SESSION_REAUTHENTICATED_STORAGE_KEY)
}

export function markSessionReplacementReauthenticated() {
  if (!window.localStorage.getItem(SESSION_REPLACEMENT_STORAGE_KEY)) {
    return
  }

  window.sessionStorage.setItem(SESSION_REAUTHENTICATED_STORAGE_KEY, 'true')
}

export function consumeSessionReplacementReauthenticated() {
  const wasReauthenticated =
    window.sessionStorage.getItem(SESSION_REAUTHENTICATED_STORAGE_KEY) === 'true'

  window.sessionStorage.removeItem(SESSION_REAUTHENTICATED_STORAGE_KEY)
  if (!wasReauthenticated) {
    return false
  }

  window.localStorage.removeItem(SESSION_REPLACEMENT_STORAGE_KEY)
  window.sessionStorage.removeItem(CLIENT_SESSION_STORAGE_KEY)
  return true
}

export function createLocalAuthSession(displayName: string): AuthSession {
  const usernameBase = normalizeUsername(displayName) || 'jugador'
  const suffix = crypto.randomUUID().slice(0, 8)
  const userId = `player_${suffix}`

  return {
    clientSessionId: getOrCreateClientSessionId(userId),
    provider: 'local',
    level: 1,
    experience: 0,
    inventory: {},
    pictureUrl: null,
    profile: {
      userId,
      username: `${usernameBase}_${suffix.slice(0, 4)}`,
      displayName: displayName.trim(),
      role: DEFAULT_USER_ROLE,
      skinId: 'default-student',
      skinColors: {},
      audioSettings: { ...DEFAULT_AUDIO_SETTINGS },
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
    clientSessionId: getOrCreateClientSessionId(options.userId),
    provider: 'auth0',
    level: 1,
    experience: 0,
    inventory: {},
    pictureUrl: options.pictureUrl ?? null,
    profile: {
      userId: options.userId,
      username: usernameBase,
      displayName: options.displayName.trim(),
      role: DEFAULT_USER_ROLE,
      skinId: preferredSkinId,
      skinColors: preferredSkinColors,
      audioSettings: { ...DEFAULT_AUDIO_SETTINGS },
    },
  }
}
