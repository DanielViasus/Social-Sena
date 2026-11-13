import 'dotenv/config'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { Pool } from 'pg'

const connectionString = process.env.DATABASE_URL?.trim()
const isProduction = process.env.NODE_ENV === 'production'

if (!connectionString && isProduction) {
  throw new Error('[db] DATABASE_URL no esta configurada en produccion. La persistencia es obligatoria para iniciar el servidor.')
}

const pool = connectionString
  ? new Pool({
      connectionString,
    })
  : null

if (!pool) {
  console.warn('[db] DATABASE_URL no esta configurada. La persistencia en Postgres queda deshabilitada.')
} else {
  pool.on('error', (error) => {
    console.error('[db] Error inesperado en el pool de Postgres.', error)
  })
}

export function getDbPool() {
  return pool
}

export function isDatabaseEnabled() {
  return pool !== null
}

// Las animaciones publicadas son opcionales: si su esquema falla, el juego sigue funcionando sin ellas.
let avatarAnimationStorageReady = false

export function isAvatarAnimationStorageReady() {
  return avatarAnimationStorageReady
}

// Interruptor de apagado: con DISABLE_PUBLISHED_AVATAR_ANIMATIONS=true el servidor no entrega ni acepta
// animaciones publicadas, y los clientes usan sus animaciones de respaldo. Basta reiniciar con la variable.
export function isAvatarAnimationsDisabledByEnv() {
  return process.env.DISABLE_PUBLISHED_AVATAR_ANIMATIONS?.trim().toLowerCase() === 'true'
}

async function initializeAvatarAnimationStorage() {
  if (!pool) {
    return
  }

  try {
    const schemaPath = fileURLToPath(new URL('./schema.avatar-animations.sql', import.meta.url))
    await pool.query(await readFile(schemaPath, 'utf8'))
    avatarAnimationStorageReady = true
  } catch (error) {
    avatarAnimationStorageReady = false
    console.error('[db] No fue posible preparar las tablas de animaciones. La funcion queda desactivada; el servidor continua.', error)
  }
}

export async function initializeDatabase() {
  if (!pool) {
    return
  }

  try {
    const schemaPath = fileURLToPath(new URL('./schema.sql', import.meta.url))
    const schemaSql = await readFile(schemaPath, 'utf8')
    await pool.query(schemaSql)
    console.log('[db] Esquema de Postgres validado correctamente.')
  } catch (error) {
    console.error('[db] No fue posible inicializar el esquema de Postgres.', error)
    if (isProduction) {
      throw error
    }
  }

  await initializeAvatarAnimationStorage()
}
