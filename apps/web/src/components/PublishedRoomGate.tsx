import { useEffect, useState } from 'react'
import {
  createRoomTemplateFromEditorMap,
  registerRoomTemplate,
  type SavedRoomEditorMap,
} from '@social-sena/shared'
import type { AuthSession } from '../auth/localSession'
import { navigateInApp } from '../hooks/usePathname'
import { availableRoomRoutes } from '../rooms/registry'
import GameClient from './GameClient'

const SERVER_URL = import.meta.env.VITE_GAME_SERVER_URL ?? 'http://localhost:3001'

interface PublishedRoomGateProps {
  session: AuthSession
  onLogout: () => void
  onSessionChange?: (nextSession: AuthSession) => void
}

export default function PublishedRoomGate(props: PublishedRoomGateProps) {
  const [resolvedPath, setResolvedPath] = useState<string | null>(null)
  const [notFoundPath, setNotFoundPath] = useState<string | null>(null)
  const path = window.location.pathname

  useEffect(() => {
    const abortController = new AbortController()
    const endpoint = new URL('/api/editor-rooms/resolve', SERVER_URL)
    endpoint.searchParams.set('path', path)

    void fetch(endpoint, { signal: abortController.signal })
      .then(async (response) => {
        if (!response.ok) return null
        return response.json() as Promise<{ ok: boolean; map?: SavedRoomEditorMap }>
      })
      .then((result) => {
        if (result?.ok && result.map) {
          registerRoomTemplate(createRoomTemplateFromEditorMap(result.map))
          setNotFoundPath(null)
        } else {
          const isStaticRoute = path === '/'
            || availableRoomRoutes.some((route) => route.toLowerCase() === path.toLowerCase())
          setNotFoundPath(isStaticRoute ? null : path)
        }
        setResolvedPath(path)
      })
      .catch((error: unknown) => {
        if ((error as { name?: string }).name !== 'AbortError') {
          console.warn('[room-editor] No fue posible comprobar la ruta publicada.', error)
          setNotFoundPath(null)
          setResolvedPath(path)
        }
      })

    return () => abortController.abort()
  }, [path])

  if (resolvedPath !== path) {
    return <main className="published-room-loading">Cargando sala...</main>
  }

  if (notFoundPath === path) {
    return (
      <main className="published-room-not-found">
        <section>
          <span>404</span>
          <h1>Sala no encontrada</h1>
          <p>Revisa que el código o la URL estén escritos exactamente como fueron publicados.</p>
          <button type="button" onClick={() => navigateInApp('/Tavern')}>Volver a la taberna</button>
        </section>
      </main>
    )
  }

  return <GameClient {...props} />
}
