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
}
