import { useSyncExternalStore } from 'react'
import type { Socket } from 'socket.io-client'
import { clientEvents, serverEvents } from '@social-sena/shared'
import {
  DEFAULT_VARIATION_ID,
  resolveSlotAnimation,
  slotKey,
  type AnimationAssignments,
  type AssignmentDirection,
} from './animationAssignmentStorage'
import type { AnimationSkeleton } from './animationSkeleton'

// Runtime store for the animations published by an administrator. The game reads it
// synchronously while rendering; anything missing or still loading resolves to null so
// the caller keeps using the built-in animations.

const VARIATION_STORAGE_KEY = 'social-sena-runtime-animation-variation'
const CACHE_KEY = 'social-sena-avatar-animations-cache-v1'

// Paquete incluido con el juego (opcional): se usa solo cuando no hay animaciones publicadas disponibles.
// Se genera con «Exportar paquete» en la pantalla de asignaciones y se guarda como ./defaultAnimationPack.json.
export interface AnimationPack {
  format: 'social-sena-animation-pack'
  version: 1
  config: AnimationAssignments
  animations: Array<{ id: string; name: string; document: AnimationSkeleton }>
}

const packLoaders = import.meta.glob<AnimationPack>('./defaultAnimationPack.json', { import: 'default' })
let bundled: { config: AnimationAssignments; documents: Map<string, AnimationSkeleton> } | null = null
let bundledRequested = false
let serverDisabled = false
let configVersion: string | null = null

let socket: Socket | null = null
let config: AnimationAssignments | null = null
let version = 0
let configStatus = 'esperando al servidor'
let selectedVariationId = readStoredVariation()
const documents = new Map<string, AnimationSkeleton>()
const pending = new Set<string>()
const failed = new Set<string>()
const listeners = new Set<() => void>()

function readStoredVariation() {
  try {
    return window.localStorage.getItem(VARIATION_STORAGE_KEY) || DEFAULT_VARIATION_ID
  } catch {
    return DEFAULT_VARIATION_ID
  }
}

function isSkeleton(value: unknown): value is AnimationSkeleton {
  return Boolean(value) && Array.isArray((value as AnimationSkeleton).frames) && (value as AnimationSkeleton).frames.length > 0
}

function loadBundledPack() {
  if (bundledRequested) return
  bundledRequested = true
  const loader = Object.values(packLoaders)[0]
  if (!loader) return
  loader().then((pack) => {
    if (pack?.format !== 'social-sena-animation-pack' || !isConfig(pack.config) || !Array.isArray(pack.animations)) {
      console.warn('[avatar-animations] El paquete incluido no es válido; se ignora.')
      return
    }
    bundled = {
      config: pack.config,
      documents: new Map(pack.animations.filter((item) => isSkeleton(item?.document)).map((item) => [item.id, item.document])),
    }
    console.info(`[avatar-animations] Paquete incluido listo: ${bundled.documents.size} animaciones.`)
    notify()
  }).catch((error) => console.warn('[avatar-animations] No se pudo cargar el paquete incluido.', error))
}

// Con animaciones publicadas se usan esas; sin ellas (y sin apagado explícito) se usa el paquete incluido.
function usingBundled() {
  return !config && !DISABLED_BY_ENV && !serverDisabled && bundled !== null
}

function activeConfig() {
  return config ?? (usingBundled() ? bundled!.config : null)
}

function activeDocuments() {
  return usingBundled() ? bundled!.documents : documents
}

let cacheTimer: number | null = null

// Guarda la última configuración y animaciones para pintar al instante en la siguiente visita.
function scheduleCacheWrite() {
  if (cacheTimer !== null) return
  cacheTimer = window.setTimeout(() => {
    cacheTimer = null
    try {
      if (!config) {
        window.localStorage.removeItem(CACHE_KEY)
        return
      }
      window.localStorage.setItem(CACHE_KEY, JSON.stringify({
        version: configVersion,
        config,
        documents: Object.fromEntries(documents),
      }))
    } catch {
      // Sin espacio o sin almacenamiento: el juego funciona igual, solo sin caché.
    }
  }, 500)
}

function hydrateFromCache() {
  if (DISABLED_BY_ENV) return
  try {
    const raw = window.localStorage.getItem(CACHE_KEY)
    if (!raw) return
    const cached = JSON.parse(raw) as { version?: unknown; config?: unknown; documents?: Record<string, unknown> }
    if (!isConfig(cached.config)) return
    config = cached.config
    configVersion = typeof cached.version === 'string' ? cached.version : null
    documents.clear()
    for (const [id, document] of Object.entries(cached.documents ?? {})) {
      if (isSkeleton(document)) documents.set(id, document)
    }
    configStatus = 'caché del navegador (verificando con el servidor…)'
    console.info(`[avatar-animations] Caché cargada: ${documents.size} animaciones.`)
  } catch {
    // Caché ilegible: se ignora y se pide todo al servidor.
  }
}

function notify() {
  version += 1
  for (const listener of [...listeners]) listener()
}

function isConfig(value: unknown): value is AnimationAssignments {
  return Boolean(value)
    && typeof value === 'object'
    && (value as AnimationAssignments).version === 2
    && Array.isArray((value as AnimationAssignments).variations)
}

// Interruptor de apagado: VITE_DISABLE_PUBLISHED_AVATAR_ANIMATIONS=true (se aplica al reconstruir el sitio)
// hace que el juego ignore las animaciones publicadas y use las de respaldo.
const DISABLED_BY_ENV = String(import.meta.env.VITE_DISABLE_PUBLISHED_AVATAR_ANIMATIONS ?? '').trim().toLowerCase() === 'true'

function requestConfig() {
  const current = socket
  if (!current) return
  loadBundledPack()
  if (DISABLED_BY_ENV) {
    config = null
    configStatus = 'desactivadas (VITE_DISABLE_PUBLISHED_AVATAR_ANIMATIONS)'
    notify()
    return
  }
  configStatus = 'consultando al servidor…'
  const timer = window.setTimeout(() => {
    console.warn('[avatar-animations] El servidor no respondió a la consulta de configuración.')
    configStatus = 'el servidor no respondió (¿reiniciaste el game-server con el código nuevo?)'
    notify()
  }, 8000)
  current.emit(clientEvents.getAvatarAnimationConfig, {}, (response: { ok: boolean; config?: unknown; version?: unknown; message?: string }) => {
    window.clearTimeout(timer)
    if (current !== socket) return
    if (!response?.ok) {
      console.warn('[avatar-animations] Error del servidor:', response)
      configStatus = `error del servidor: ${response?.message ?? 'sin detalle'}`
      notify()
      return
    }
    const serverFlags = response as { disabled?: boolean; unavailable?: boolean }
    const nextConfig = isConfig(response.config) ? response.config : null
    const nextVersion = typeof response.version === 'string' ? response.version : null
    serverDisabled = Boolean(serverFlags.disabled)
    console.info('[avatar-animations]', config ? `Configuración recibida: ${config.variations.length} variaciones.` : 'El servidor no tiene asignaciones publicadas.')
    configStatus = config
      ? 'ok'
      : serverFlags.disabled
        ? 'desactivadas en el servidor (DISABLE_PUBLISHED_AVATAR_ANIMATIONS)'
        : serverFlags.unavailable
          ? 'almacenamiento de animaciones no disponible en el servidor'
          : 'nada publicado en el servidor (la base de datos no tiene asignaciones)'
    // Si la versión coincide con la de la caché, las animaciones guardadas siguen vigentes y no se vuelven a pedir.
    const sameVersion = Boolean(nextConfig && nextVersion && nextVersion === configVersion)
    config = nextConfig
    configVersion = nextVersion
    if (!sameVersion) documents.clear()
    failed.clear()
    scheduleCacheWrite()
    notify()
  })
}

function requestDocument(id: string) {
  const current = socket
  if (!current || pending.has(id) || failed.has(id)) return
  pending.add(id)
  current.emit(
    clientEvents.getAvatarAnimation,
    { id },
    (response: { ok: boolean; animation?: { document?: AnimationSkeleton } }) => {
      pending.delete(id)
      if (current !== socket) return
      const document = response?.ok ? response.animation?.document : undefined
      if (document && Array.isArray(document.frames) && document.frames.length > 0) {
        documents.set(id, document)
        scheduleCacheWrite()
        console.info(`[avatar-animations] Animación ${id} cargada (${document.frames.length} frames).`)
      } else {
        failed.add(id)
        console.warn(`[avatar-animations] No se pudo cargar la animación publicada "${id}".`)
      }
      notify()
    },
  )
}

export function attachAvatarAnimationSocket(nextSocket: Socket) {
  socket = nextSocket
  loadBundledPack()
  if (!config) hydrateFromCache()
  if (config) notify()
  nextSocket.on(serverEvents.connectionAccepted, requestConfig)
  nextSocket.on(serverEvents.avatarAnimationsUpdated, requestConfig)
  return () => {
    if (socket !== nextSocket) return
    socket = null
    config = null
    documents.clear()
    pending.clear()
    failed.clear()
    notify()
  }
}

export function getSelectedRuntimeVariation() {
  return selectedVariationId
}

export function setSelectedRuntimeVariation(id: string) {
  selectedVariationId = id
  try {
    window.localStorage.setItem(VARIATION_STORAGE_KEY, id)
  } catch {
    // The choice only lasts for this visit when storage is unavailable.
  }
  notify()
}

export function getRuntimeStatus() {
  if (!socket) return 'sin conexión'
  if (!config) return usingBundled() ? `paquete incluido (${bundled!.documents.size} animaciones) · ${configStatus}` : configStatus
  const variation = config.variations.find((item) => item.id === selectedVariationId)
    ?? config.variations.find((item) => item.id === DEFAULT_VARIATION_ID)
  const assigned = variation ? Object.keys(variation.assignments).length : 0
  return `${config.variations.length} variaciones · ${assigned} casillas en la activa · ${documents.size} animaciones cargadas · ${failed.size} con error`
}

export function listRuntimeVariations() {
  return activeConfig()?.variations.map(({ id, name }) => ({ id, name })) ?? []
}

export interface RuntimeAnimation {
  document: AnimationSkeleton
  flipX: boolean
  flipY: boolean
}

// Facing poses only distinguish front/back and left/right, so a pure horizontal slot
// (e / w) stands in for a diagonal that has no animation of its own.
const FALLBACK_DIRECTION: Record<string, AssignmentDirection> = { ne: 'e', se: 'e', nw: 'w', sw: 'w' }

export function resolveRuntimeAnimation(
  stateId: 'idle' | 'walk',
  direction: AssignmentDirection,
): RuntimeAnimation | null {
  const active = activeConfig()
  if (!active) return null
  const variationId = active.variations.some((item) => item.id === selectedVariationId)
    ? selectedVariationId
    : DEFAULT_VARIATION_ID
  for (const candidate of [direction, FALLBACK_DIRECTION[direction]]) {
    if (!candidate) continue
    const slot = resolveSlotAnimation(active, variationId, slotKey(stateId, candidate))
    if (!slot) continue
    const document = activeDocuments().get(slot.animationId)
    if (!document) {
      if (!usingBundled()) requestDocument(slot.animationId)
      return null
    }
    return { document, flipX: slot.flipX, flipY: slot.flipY }
  }
  return null
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

// Re-renders the caller whenever the published data, a loaded document or the test selection changes.
export function useAvatarAnimationRuntimeVersion() {
  return useSyncExternalStore(subscribe, () => version, () => 0)
}
