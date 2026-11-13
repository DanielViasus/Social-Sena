import { io, type Socket } from 'socket.io-client'
import { clientEvents, serverEvents, type UserProfile } from '@social-sena/shared'
import type { AuthSession } from '../../auth/localSession'
import type { AnimationAssignments } from './animationAssignmentStorage'
import { loadAnimation } from './animationEditorStorage'
import { toSkeleton } from './animationSkeleton'
import type { AnimationPack } from './avatarAnimationRuntime'

const LOG = '[avatar-animations:publicar]'
const SERVER_URL = import.meta.env.VITE_GAME_SERVER_URL ?? 'http://localhost:3001'

type Ack = { ok: boolean; message?: string }

export interface AnimationHistoryVersion {
  id: string
  createdBy: string
  createdAt: string
  variations: number
  animations: number
}

function emitWithAck<T extends Ack = Ack>(socket: Socket, event: string, payload: unknown): Promise<T> {
  return new Promise((resolve) => {
    const timer = window.setTimeout(() => resolve({ ok: false, message: 'El servidor no respondió.' } as T), 30000)
    socket.emit(event, payload, (response: T) => {
      window.clearTimeout(timer)
      resolve(response ?? ({ ok: false, message: 'Respuesta inválida del servidor.' } as T))
    })
  })
}

// Abre una conexión propia, verifica el rol real en el servidor y ejecuta la acción de administrador.
async function withAdminSocket<T extends Ack>(
  session: AuthSession,
  onProgress: (message: string) => void,
  action: (socket: Socket) => Promise<T>,
): Promise<T | Ack> {
  const socket = io(SERVER_URL, { autoConnect: true })
  try {
    onProgress('Conectando con el servidor…')
    console.info(LOG, 'Conectando a', SERVER_URL)
    const profile = await new Promise<UserProfile>((resolve, reject) => {
      const timer = window.setTimeout(() => reject(new Error('No se pudo conectar con el servidor.')), 15000)
      socket.on('connect', () => {
        socket.emit(clientEvents.connectToGame, { clientSessionId: session.clientSessionId, profile: session.profile })
      })
      socket.on('connect_error', (error) => { console.error(LOG, 'Error de conexión', error); window.clearTimeout(timer); reject(new Error('No se pudo conectar con el servidor.')) })
      socket.on(serverEvents.connectionAccepted, ({ profile: accepted }: { profile: UserProfile }) => {
        window.clearTimeout(timer)
        resolve(accepted)
      })
    })
    console.info(LOG, 'Sesión aceptada. Rol real en el servidor:', profile.role)
    if (profile.role !== 'admin' && profile.role !== 'developer') {
      return { ok: false, message: 'Solo un administrador puede hacer esto.' }
    }
    return await action(socket)
  } catch (error) {
    console.error(LOG, 'Fallo inesperado', error)
    return { ok: false, message: error instanceof Error ? error.message : 'No se pudo completar la operación.' }
  } finally {
    socket.disconnect()
  }
}

// Convierte las asignaciones guardadas en este navegador (y sus animaciones) en un paquete de solo datos.
export async function buildAnimationPack(assignments: AnimationAssignments): Promise<{ ok: true; pack: AnimationPack } | { ok: false; message: string }> {
  const ids = [...new Set(assignments.variations.flatMap((variation) => Object.values(variation.assignments)))]
  const animations: AnimationPack['animations'] = []
  for (const id of ids) {
    const animation = await loadAnimation(id)
    if (!animation) return { ok: false, message: 'Una animación asignada ya no existe en este navegador.' }
    const skeleton = toSkeleton(animation.document)
    if (!skeleton.ok) return { ok: false, message: `“${animation.name}”: ${skeleton.error}` }
    animations.push({ id: animation.id, name: animation.name, document: skeleton.skeleton })
  }
  return { ok: true, pack: { format: 'social-sena-animation-pack', version: 1, config: assignments, animations } }
}

export function parseAnimationPack(text: string): { ok: true; pack: AnimationPack } | { ok: false; message: string } {
  try {
    const pack = JSON.parse(text) as Partial<AnimationPack>
    if (pack?.format !== 'social-sena-animation-pack' || pack.version !== 1) return { ok: false, message: 'El archivo no es un paquete de animaciones válido.' }
    if (!pack.config || pack.config.version !== 2 || !Array.isArray(pack.config.variations) || !Array.isArray(pack.animations)) {
      return { ok: false, message: 'El paquete está incompleto.' }
    }
    return { ok: true, pack: pack as AnimationPack }
  } catch {
    return { ok: false, message: 'El archivo no es JSON válido.' }
  }
}

export function downloadAnimationPack(pack: AnimationPack) {
  const blob = new Blob([JSON.stringify(pack, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = 'defaultAnimationPack.json'
  link.click()
  URL.revokeObjectURL(url)
}

// Sube primero las animaciones y luego las asignaciones. El servidor solo lo acepta de administradores.
export async function publishAnimationPack(
  session: AuthSession,
  pack: AnimationPack,
  onProgress: (message: string) => void,
): Promise<Ack> {
  return withAdminSocket(session, onProgress, async (socket) => {
    console.info(LOG, `Animaciones a publicar: ${pack.animations.length}`)
    for (const [index, animation] of pack.animations.entries()) {
      onProgress(`Publicando animación ${index + 1} de ${pack.animations.length}…`)
      const result = await emitWithAck(socket, clientEvents.publishAvatarAnimation, {
        id: animation.id,
        name: animation.name,
        document: animation.document,
      })
      console.info(LOG, `Animación “${animation.name}” (${animation.document.frames.length} frames):`, result)
      if (!result.ok) return { ok: false, message: result.message ?? `No se pudo publicar “${animation.name}”.` }
    }
    onProgress('Publicando asignaciones…')
    const configResult = await emitWithAck(socket, clientEvents.publishAvatarAnimationConfig, { config: pack.config })
    console.info(LOG, 'Asignaciones:', configResult)
    return configResult
  })
}

export async function publishAvatarAnimations(
  session: AuthSession,
  assignments: AnimationAssignments,
  onProgress: (message: string) => void,
): Promise<Ack> {
  const built = await buildAnimationPack(assignments)
  if (!built.ok) return built
  return publishAnimationPack(session, built.pack, onProgress)
}

export async function listAnimationHistory(session: AuthSession): Promise<Ack & { versions?: AnimationHistoryVersion[] }> {
  return withAdminSocket(session, () => undefined, (socket) =>
    emitWithAck<Ack & { versions?: AnimationHistoryVersion[] }>(socket, clientEvents.listAvatarAnimationHistory, {}),
  )
}

export async function restoreAnimationVersion(session: AuthSession, id: string): Promise<Ack> {
  return withAdminSocket(session, () => undefined, (socket) =>
    emitWithAck(socket, clientEvents.restoreAvatarAnimationVersion, { id }),
  )
}
