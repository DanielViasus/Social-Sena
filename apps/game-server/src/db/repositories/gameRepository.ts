import type { Position, SkinColorSelections, UserProfile } from '@social-sena/shared'
import { getDbPool } from '../client'

interface PersistedPlayerState {
  roomId: string | null
  position: Position | null
}

interface ResolvedUserProfileResult {
  profile: UserProfile
  needsOnboarding: boolean
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

class GameRepository {
  async resolveUserProfile(incomingProfile: UserProfile): Promise<ResolvedUserProfileResult> {
    const pool = getDbPool()
    if (!pool) {
      return {
        profile: incomingProfile,
        needsOnboarding: false,
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

      const profileResult = await client.query<{
        skin_id: string
        skin_colors: unknown
        onboarding_completed: boolean
      }>(
        `
          select skin_id, skin_colors, onboarding_completed
          from player_profiles
          where user_id = $1
          limit 1
        `,
        [incomingProfile.userId],
      )

      if (profileResult.rowCount && profileResult.rows[0]) {
        await client.query('COMMIT')

        return {
          profile: {
            ...incomingProfile,
            skinId: profileResult.rows[0].skin_id,
            skinColors: normalizeSkinColors(profileResult.rows[0].skin_colors),
          },
          needsOnboarding: !profileResult.rows[0].onboarding_completed,
        }
      }

      await client.query(
        `
          insert into player_profiles (user_id, skin_id, skin_colors)
          values ($1, $2, $3::jsonb)
        `,
        [incomingProfile.userId, incomingProfile.skinId, JSON.stringify(incomingProfile.skinColors ?? {})],
      )

      await client.query('COMMIT')
      return {
        profile: incomingProfile,
        needsOnboarding: true,
      }
    } catch (error) {
      await client.query('ROLLBACK')
      console.error('[db] No fue posible resolver el perfil persistido del jugador.', error)
      return {
        profile: incomingProfile,
        needsOnboarding: false,
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
          insert into player_profiles (user_id, skin_id, skin_colors)
          values ($1, $2, $3::jsonb)
          on conflict (user_id) do update set
            skin_id = excluded.skin_id,
            skin_colors = excluded.skin_colors,
            updated_at = now()
        `,
        [profile.userId, profile.skinId, JSON.stringify(profile.skinColors ?? {})],
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
          insert into player_profiles (user_id, skin_id, skin_colors, onboarding_completed)
          values ($1, $2, $3::jsonb, true)
          on conflict (user_id) do update set
            skin_id = excluded.skin_id,
            skin_colors = excluded.skin_colors,
            onboarding_completed = true,
            updated_at = now()
        `,
        [profile.userId, profile.skinId, JSON.stringify(profile.skinColors ?? {})],
      )
    } catch (error) {
      console.error('[db] No fue posible completar el onboarding inicial del jugador.', error)
    }

    return profile
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
}

export const gameRepository = new GameRepository()
