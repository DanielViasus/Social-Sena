import { randomUUID } from 'node:crypto'
import type {
  FriendRequestSummary,
  FriendSummary,
  PlayerInventory,
  PlayerProgress,
  Position,
  SkinColorSelections,
  UserProfile,
} from '@social-sena/shared'
import { normalizeAudioSettings } from '@social-sena/shared'
import { getDbPool } from '../client'

interface PersistedPlayerState {
  roomId: string | null
  position: Position | null
}

interface ResolvedUserProfileResult {
  profile: UserProfile
  needsOnboarding: boolean
  progress: PlayerProgress
  inventory: PlayerInventory
  friends: FriendSummary[]
  incomingFriendRequests: FriendRequestSummary[]
  outgoingFriendRequestUserIds: string[]
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
      if (
        typeof itemId !== 'string' ||
        itemId.trim().length === 0 ||
        !itemValue ||
        typeof itemValue !== 'object'
      ) {
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

function normalizeFriendRows(
  rows: Array<{
    friend_user_id: string
    display_name: string | null
    skin_id: string | null
    skin_colors: unknown
    level: number | null
  }>,
): FriendSummary[] {
  return rows.map((row) => ({
    userId: row.friend_user_id,
    displayName: row.display_name?.trim() || 'Jugador',
    skinId: row.skin_id?.trim() || 'crock',
    skinColors: normalizeSkinColors(row.skin_colors),
    level: row.level ?? 1,
    isOnline: false,
  }))
}

function normalizeFriendRequestRows(
  rows: Array<{
    request_id: string
    from_user_id: string
    display_name: string | null
    skin_id: string | null
    skin_colors: unknown
    level: number | null
    created_at: string | Date
  }>,
): FriendRequestSummary[] {
  return rows.map((row) => ({
    requestId: row.request_id,
    fromUserId: row.from_user_id,
    displayName: row.display_name?.trim() || 'Jugador',
    skinId: row.skin_id?.trim() || 'crock',
    skinColors: normalizeSkinColors(row.skin_colors),
    level: row.level ?? 1,
    createdAt:
      row.created_at instanceof Date ? row.created_at.toISOString() : new Date(row.created_at).toISOString(),
  }))
}

class GameRepository {
  async resolveUserProfile(incomingProfile: UserProfile): Promise<ResolvedUserProfileResult> {
    const pool = getDbPool()
    if (!pool) {
      return {
        profile: incomingProfile,
        needsOnboarding: false,
        progress: {
          level: 1,
          experience: 0,
        },
        inventory: {},
        friends: [],
        incomingFriendRequests: [],
        outgoingFriendRequestUserIds: [],
      }
    }

    const client = await pool.connect()

    try {
      await client.query('BEGIN')
      await client.query(
        `
          insert into users (user_id, username, display_name)
          values ($1, $2, $3)
          on conflict (user_id) do update set
            username = excluded.username,
            display_name = excluded.display_name,
            updated_at = now()
        `,
        [incomingProfile.userId, incomingProfile.username, incomingProfile.displayName],
      )

      await client.query(
        `
          insert into player_progress (user_id)
          values ($1)
          on conflict (user_id) do nothing
        `,
        [incomingProfile.userId],
      )

      await client.query(
        `
          insert into player_inventory (user_id)
          values ($1)
          on conflict (user_id) do nothing
        `,
        [incomingProfile.userId],
      )

      const profileResult = await client.query<{
        skin_id: string
        skin_colors: unknown
        audio_settings: unknown
        onboarding_completed: boolean
      }>(
        `
          select skin_id, skin_colors, audio_settings, onboarding_completed
          from player_profiles
          where user_id = $1
          limit 1
        `,
        [incomingProfile.userId],
      )

      if (profileResult.rowCount && profileResult.rows[0]) {
        const friendsResult = await client.query<{
          friend_user_id: string
          display_name: string | null
          skin_id: string | null
          skin_colors: unknown
          level: number | null
        }>(
          `
            select
              friendships.friend_user_id,
              users.display_name,
              player_profiles.skin_id,
              player_profiles.skin_colors
              ,
              player_progress.level
            from friendships
            inner join users on users.user_id = friendships.friend_user_id
            left join player_profiles on player_profiles.user_id = friendships.friend_user_id
            left join player_progress on player_progress.user_id = friendships.friend_user_id
            where friendships.user_id = $1
            order by users.display_name asc
          `,
          [incomingProfile.userId],
        )
        const incomingRequestsResult = await client.query<{
          request_id: string
          from_user_id: string
          display_name: string | null
          skin_id: string | null
          skin_colors: unknown
          level: number | null
          created_at: string | Date
        }>(
          `
            select
              friend_requests.request_id,
              friend_requests.from_user_id,
              users.display_name,
              player_profiles.skin_id,
              player_profiles.skin_colors,
              player_progress.level,
              friend_requests.created_at
            from friend_requests
            inner join users on users.user_id = friend_requests.from_user_id
            left join player_profiles on player_profiles.user_id = friend_requests.from_user_id
            left join player_progress on player_progress.user_id = friend_requests.from_user_id
            where friend_requests.to_user_id = $1
            order by friend_requests.created_at desc
          `,
          [incomingProfile.userId],
        )
        const outgoingRequestsResult = await client.query<{
          to_user_id: string
        }>(
          `
            select to_user_id
            from friend_requests
            where from_user_id = $1
          `,
          [incomingProfile.userId],
        )
        const inventoryResult = await client.query<{
          inventory: unknown
        }>(
          `
            select inventory
            from player_inventory
            where user_id = $1
            limit 1
          `,
          [incomingProfile.userId],
        )
        const progressResult = await client.query<{
          level: number
          experience: number
        }>(
          `
            select level, experience
            from player_progress
            where user_id = $1
            limit 1
          `,
          [incomingProfile.userId],
        )
        await client.query('COMMIT')

        return {
          profile: {
            ...incomingProfile,
            skinId: profileResult.rows[0].skin_id,
            skinColors: normalizeSkinColors(profileResult.rows[0].skin_colors),
            audioSettings: normalizeAudioSettings(profileResult.rows[0].audio_settings),
          },
          needsOnboarding: !profileResult.rows[0].onboarding_completed,
          progress: {
            level: progressResult.rows[0]?.level ?? 1,
            experience: progressResult.rows[0]?.experience ?? 0,
          },
          inventory: normalizeInventory(inventoryResult.rows[0]?.inventory),
          friends: normalizeFriendRows(friendsResult.rows),
          incomingFriendRequests: normalizeFriendRequestRows(incomingRequestsResult.rows),
          outgoingFriendRequestUserIds: outgoingRequestsResult.rows.map((row) => row.to_user_id),
        }
      }

      await client.query(
        `
          insert into player_profiles (user_id, skin_id, skin_colors, audio_settings)
          values ($1, $2, $3::jsonb, $4::jsonb)
        `,
        [
          incomingProfile.userId,
          incomingProfile.skinId,
          JSON.stringify(incomingProfile.skinColors ?? {}),
          JSON.stringify(incomingProfile.audioSettings),
        ],
      )

      await client.query('COMMIT')
      return {
        profile: incomingProfile,
        needsOnboarding: true,
        progress: {
          level: 1,
          experience: 0,
        },
        inventory: {},
        friends: [],
        incomingFriendRequests: [],
        outgoingFriendRequestUserIds: [],
      }
    } catch (error) {
      await client.query('ROLLBACK')
      console.error('[db] No fue posible resolver el perfil persistido del jugador.', error)
      return {
        profile: incomingProfile,
        needsOnboarding: false,
        progress: {
          level: 1,
          experience: 0,
        },
        inventory: {},
        friends: [],
        incomingFriendRequests: [],
        outgoingFriendRequestUserIds: [],
      }
    } finally {
      client.release()
    }
  }

  async savePlayerProfile(profile: UserProfile) {
    const pool = getDbPool()
    if (!pool) {
      return
    }

    try {
      await pool.query(
        `
          insert into users (user_id, username, display_name)
          values ($1, $2, $3)
          on conflict (user_id) do update set
            username = excluded.username,
            display_name = excluded.display_name,
            updated_at = now()
        `,
        [profile.userId, profile.username, profile.displayName],
      )

      await pool.query(
        `
          insert into player_profiles (user_id, skin_id, skin_colors, audio_settings)
          values ($1, $2, $3::jsonb, $4::jsonb)
          on conflict (user_id) do update set
            skin_id = excluded.skin_id,
            skin_colors = excluded.skin_colors,
            audio_settings = excluded.audio_settings,
            updated_at = now()
        `,
        [
          profile.userId,
          profile.skinId,
          JSON.stringify(profile.skinColors ?? {}),
          JSON.stringify(profile.audioSettings),
        ],
      )
    } catch (error) {
      console.error('[db] No fue posible guardar el perfil del jugador.', error)
    }
  }

  async completeOnboarding(profile: UserProfile) {
    const pool = getDbPool()
    if (!pool) {
      return profile
    }

    try {
      await pool.query(
        `
          insert into users (user_id, username, display_name)
          values ($1, $2, $3)
          on conflict (user_id) do update set
            username = excluded.username,
            display_name = excluded.display_name,
            updated_at = now()
        `,
        [profile.userId, profile.username, profile.displayName],
      )

      await pool.query(
        `
          insert into player_profiles (user_id, skin_id, skin_colors, audio_settings, onboarding_completed)
          values ($1, $2, $3::jsonb, $4::jsonb, true)
          on conflict (user_id) do update set
            skin_id = excluded.skin_id,
            skin_colors = excluded.skin_colors,
            audio_settings = excluded.audio_settings,
            onboarding_completed = true,
            updated_at = now()
        `,
        [
          profile.userId,
          profile.skinId,
          JSON.stringify(profile.skinColors ?? {}),
          JSON.stringify(profile.audioSettings),
        ],
      )
    } catch (error) {
      console.error('[db] No fue posible completar el onboarding inicial del jugador.', error)
    }

    return profile
  }

  async getPlayerProgress(userId: string): Promise<PlayerProgress> {
    const pool = getDbPool()
    if (!pool) {
      return { level: 1, experience: 0 }
    }

    try {
      await pool.query(
        `
          insert into player_progress (user_id)
          values ($1)
          on conflict (user_id) do nothing
        `,
        [userId],
      )

      const result = await pool.query<{
        level: number
        experience: number
      }>(
        `
          select level, experience
          from player_progress
          where user_id = $1
          limit 1
        `,
        [userId],
      )

      return {
        level: result.rows[0]?.level ?? 1,
        experience: result.rows[0]?.experience ?? 0,
      }
    } catch (error) {
      console.error('[db] No fue posible leer el progreso del jugador.', error)
      return { level: 1, experience: 0 }
    }
  }

  async getPlayerInventory(userId: string): Promise<PlayerInventory> {
    const pool = getDbPool()
    if (!pool) {
      return {}
    }

    try {
      await pool.query(
        `
          insert into player_inventory (user_id)
          values ($1)
          on conflict (user_id) do nothing
        `,
        [userId],
      )

      const result = await pool.query<{
        inventory: unknown
      }>(
        `
          select inventory
          from player_inventory
          where user_id = $1
          limit 1
        `,
        [userId],
      )

      return normalizeInventory(result.rows[0]?.inventory)
    } catch (error) {
      console.error('[db] No fue posible leer el inventario del jugador.', error)
      return {}
    }
  }

  async savePlayerInventory(userId: string, inventory: PlayerInventory) {
    const pool = getDbPool()
    if (!pool) {
      return
    }

    try {
      await pool.query(
        `
          insert into player_inventory (user_id, inventory)
          values ($1, $2::jsonb)
          on conflict (user_id) do update set
            inventory = excluded.inventory,
            updated_at = now()
        `,
        [userId, JSON.stringify(normalizeInventory(inventory))],
      )
    } catch (error) {
      console.error('[db] No fue posible guardar el inventario del jugador.', error)
    }
  }

  async getPlayerState(userId: string): Promise<PersistedPlayerState | null> {
    const pool = getDbPool()
    if (!pool) {
      return null
    }

    try {
      const result = await pool.query<{
        last_room_id: string | null
        last_pos_x: number | null
        last_pos_y: number | null
      }>(
        `
          select last_room_id, last_pos_x, last_pos_y
          from player_state
          where user_id = $1
          limit 1
        `,
        [userId],
      )

      const row = result.rows[0]
      if (!row) {
        return null
      }

      return {
        roomId: row.last_room_id,
        position:
          row.last_pos_x === null || row.last_pos_y === null
            ? null
            : {
                x: row.last_pos_x,
                y: row.last_pos_y,
              },
      }
    } catch (error) {
      console.error('[db] No fue posible leer el estado persistido del jugador.', error)
      return null
    }
  }

  async savePlayerState(userId: string, state: PersistedPlayerState) {
    const pool = getDbPool()
    if (!pool) {
      return
    }

    try {
      await pool.query(
        `
          insert into player_state (user_id, last_room_id, last_pos_x, last_pos_y)
          values ($1, $2, $3, $4)
          on conflict (user_id) do update set
            last_room_id = excluded.last_room_id,
            last_pos_x = excluded.last_pos_x,
            last_pos_y = excluded.last_pos_y,
            updated_at = now()
        `,
        [userId, state.roomId, state.position?.x ?? null, state.position?.y ?? null],
      )
    } catch (error) {
      console.error('[db] No fue posible guardar el estado del jugador.', error)
    }
  }

  async getFriends(userId: string): Promise<FriendSummary[]> {
    const pool = getDbPool()
    if (!pool) {
      return []
    }

    try {
      const result = await pool.query<{
        friend_user_id: string
        display_name: string | null
        skin_id: string | null
        skin_colors: unknown
        level: number | null
      }>(
        `
          select
            friendships.friend_user_id,
            users.display_name,
            player_profiles.skin_id,
            player_profiles.skin_colors,
            player_progress.level
          from friendships
          inner join users on users.user_id = friendships.friend_user_id
          left join player_profiles on player_profiles.user_id = friendships.friend_user_id
          left join player_progress on player_progress.user_id = friendships.friend_user_id
          where friendships.user_id = $1
          order by users.display_name asc
        `,
        [userId],
      )

      return normalizeFriendRows(result.rows)
    } catch (error) {
      console.error('[db] No fue posible leer la lista de amistades.', error)
      return []
    }
  }

  async getIncomingFriendRequests(userId: string): Promise<FriendRequestSummary[]> {
    const pool = getDbPool()
    if (!pool) {
      return []
    }

    try {
      const result = await pool.query<{
        request_id: string
        from_user_id: string
        display_name: string | null
        skin_id: string | null
        skin_colors: unknown
        level: number | null
        created_at: string | Date
      }>(
        `
          select
            friend_requests.request_id,
            friend_requests.from_user_id,
            users.display_name,
            player_profiles.skin_id,
            player_profiles.skin_colors,
            player_progress.level,
            friend_requests.created_at
          from friend_requests
          inner join users on users.user_id = friend_requests.from_user_id
          left join player_profiles on player_profiles.user_id = friend_requests.from_user_id
          left join player_progress on player_progress.user_id = friend_requests.from_user_id
          where friend_requests.to_user_id = $1
          order by friend_requests.created_at desc
        `,
        [userId],
      )

      return normalizeFriendRequestRows(result.rows)
    } catch (error) {
      console.error('[db] No fue posible leer las solicitudes de amistad.', error)
      return []
    }
  }

  async getOutgoingFriendRequestUserIds(userId: string): Promise<string[]> {
    const pool = getDbPool()
    if (!pool) {
      return []
    }

    try {
      const result = await pool.query<{ to_user_id: string }>(
        `
          select to_user_id
          from friend_requests
          where from_user_id = $1
        `,
        [userId],
      )

      return result.rows.map((row) => row.to_user_id)
    } catch (error) {
      console.error('[db] No fue posible leer las solicitudes enviadas.', error)
      return []
    }
  }

  async getFriendRequestById(requestId: string): Promise<FriendRequestSummary | null> {
    const pool = getDbPool()
    if (!pool) {
      return null
    }

    try {
      const result = await pool.query<{
        request_id: string
        from_user_id: string
        display_name: string | null
        skin_id: string | null
        skin_colors: unknown
        level: number | null
        created_at: string | Date
      }>(
        `
          select
            friend_requests.request_id,
            friend_requests.from_user_id,
            users.display_name,
            player_profiles.skin_id,
            player_profiles.skin_colors,
            player_progress.level,
            friend_requests.created_at
          from friend_requests
          inner join users on users.user_id = friend_requests.from_user_id
          left join player_profiles on player_profiles.user_id = friend_requests.from_user_id
          left join player_progress on player_progress.user_id = friend_requests.from_user_id
          where friend_requests.request_id = $1
          limit 1
        `,
        [requestId],
      )

      return normalizeFriendRequestRows(result.rows)[0] ?? null
    } catch (error) {
      console.error('[db] No fue posible leer la solicitud de amistad.', error)
      return null
    }
  }

  async sendFriendRequest(userId: string, friendUserId: string) {
    const pool = getDbPool()
    if (!pool || userId === friendUserId) {
      return { ok: false, message: 'No fue posible registrar la solicitud.' }
    }

    const client = await pool.connect()

    try {
      await client.query('BEGIN')

      const friendExistsResult = await client.query<{ user_id: string }>(
        `
          select user_id
          from users
          where user_id = $1
          limit 1
        `,
        [friendUserId],
      )

      if (!friendExistsResult.rowCount) {
        await client.query('ROLLBACK')
        return { ok: false, message: 'Ese jugador aun no tiene perfil disponible.' }
      }

      const friendshipResult = await client.query<{ user_id: string }>(
        `
          select user_id
          from friendships
          where user_id = $1 and friend_user_id = $2
          limit 1
        `,
        [userId, friendUserId],
      )

      if (friendshipResult.rowCount) {
        await client.query('ROLLBACK')
        return { ok: false, message: 'Ese jugador ya hace parte de tus amistades.' }
      }

      const reversePendingResult = await client.query<{ request_id: string }>(
        `
          select request_id
          from friend_requests
          where from_user_id = $1 and to_user_id = $2
          limit 1
        `,
        [friendUserId, userId],
      )

      if (reversePendingResult.rowCount) {
        await client.query('ROLLBACK')
        return { ok: false, message: 'Ese jugador ya te envio una solicitud. Revísala en tu panel.' }
      }

      const existingPendingResult = await client.query<{ request_id: string }>(
        `
          select request_id
          from friend_requests
          where from_user_id = $1 and to_user_id = $2
          limit 1
        `,
        [userId, friendUserId],
      )

      if (existingPendingResult.rowCount) {
        await client.query('ROLLBACK')
        return { ok: false, message: 'Ya tienes una solicitud pendiente con este jugador.' }
      }

      const requestId = randomUUID()
      await client.query(
        `
          insert into friend_requests (request_id, from_user_id, to_user_id)
          values ($1, $2, $3)
        `,
        [requestId, userId, friendUserId],
      )

      await client.query('COMMIT')
      const request = await this.getFriendRequestById(requestId)
      return { ok: true, request }
    } catch (error) {
      await client.query('ROLLBACK')
      console.error('[db] No fue posible guardar la solicitud de amistad.', error)
      return { ok: false, message: 'No fue posible guardar la solicitud de amistad.' }
    } finally {
      client.release()
    }
  }

  async respondToFriendRequest(userId: string, requestId: string, action: 'accept' | 'reject') {
    const pool = getDbPool()
    if (!pool) {
      return { ok: false, message: 'No fue posible responder la solicitud.' }
    }

    const client = await pool.connect()

    try {
      await client.query('BEGIN')

      const requestResult = await client.query<{
        request_id: string
        from_user_id: string
        to_user_id: string
      }>(
        `
          select request_id, from_user_id, to_user_id
          from friend_requests
          where request_id = $1 and to_user_id = $2
          limit 1
        `,
        [requestId, userId],
      )

      const request = requestResult.rows[0]
      if (!request) {
        await client.query('ROLLBACK')
        return { ok: false, message: 'La solicitud ya no está disponible.' }
      }

      if (action === 'accept') {
        await client.query(
          `
            insert into friendships (user_id, friend_user_id)
            values ($1, $2), ($2, $1)
            on conflict (user_id, friend_user_id) do nothing
          `,
          [request.from_user_id, request.to_user_id],
        )
      }

      await client.query(
        `
          delete from friend_requests
          where
            request_id = $1
            or (
              (from_user_id = $2 and to_user_id = $3)
              or (from_user_id = $3 and to_user_id = $2)
            )
        `,
        [requestId, request.from_user_id, request.to_user_id],
      )

      await client.query('COMMIT')
      return { ok: true, requesterUserId: request.from_user_id }
    } catch (error) {
      await client.query('ROLLBACK')
      console.error('[db] No fue posible responder la solicitud de amistad.', error)
      return { ok: false, message: 'No fue posible responder la solicitud.' }
    } finally {
      client.release()
    }
  }

  async removeFriend(userId: string, friendUserId: string) {
    const pool = getDbPool()
    if (!pool || userId === friendUserId) {
      return { ok: false, message: 'No fue posible quitar la amistad.' }
    }

    try {
      await pool.query(
        `
          delete from friendships
          where
            (user_id = $1 and friend_user_id = $2)
            or (user_id = $2 and friend_user_id = $1)
        `,
        [userId, friendUserId],
      )

      await pool.query(
        `
          delete from friend_requests
          where
            (from_user_id = $1 and to_user_id = $2)
            or (from_user_id = $2 and to_user_id = $1)
        `,
        [userId, friendUserId],
      )

      return { ok: true }
    } catch (error) {
      console.error('[db] No fue posible quitar la amistad.', error)
      return { ok: false, message: 'No fue posible quitar la amistad.' }
    }
  }
}

export const gameRepository = new GameRepository()
