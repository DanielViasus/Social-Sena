import { useEffect, useRef, useState } from 'react'
import { io, type Socket } from 'socket.io-client'
import {
  clientEvents,
  serverEvents,
  type ConnectionAcceptedPayload,
  type RoomEditorMapSummary,
  type UserProfile,
} from '@social-sena/shared'
import { saveAuthSession, type AuthSession } from '../auth/localSession'
import { navigateInApp } from '../hooks/usePathname'
import { canAccessRoomEditor } from '../rooms/roomEditorAccess'

interface RoomEditorMenuPageProps {
  session: AuthSession
  onSessionChange: (session: AuthSession) => void
}

const SERVER_URL = import.meta.env.VITE_GAME_SERVER_URL ?? 'http://localhost:3001'

export default function RoomEditorMenuPage({ session, onSessionChange }: RoomEditorMenuPageProps) {
  const sessionRef = useRef(session)
  const socketRef = useRef<Socket | null>(null)
  const [resolvedProfile, setResolvedProfile] = useState<UserProfile>(session.profile)
  const canUseRoomEditor = canAccessRoomEditor(resolvedProfile.role)
  const [mapCode, setMapCode] = useState('')
  const [maps, setMaps] = useState<RoomEditorMapSummary[]>([])
  const [mapsStatus, setMapsStatus] = useState<'loading' | 'ready' | 'error'>(
    canUseRoomEditor ? 'loading' : 'ready',
  )
  const [deletingMapCode, setDeletingMapCode] = useState<string | null>(null)
  const [mapActionMessage, setMapActionMessage] = useState('')
  const normalizedMapCode = mapCode.trim().toUpperCase()
  const ownedMaps = maps.filter((map) => map.ownerUserId === resolvedProfile.userId)
  const sharedMaps = maps.filter((map) => map.ownerUserId !== resolvedProfile.userId)

  useEffect(() => {
    sessionRef.current = session
  }, [session])

  useEffect(() => {
    const socket = io(SERVER_URL, { autoConnect: true })
    socketRef.current = socket
    const requestMaps = () => {
      socket.emit(
        clientEvents.listRoomEditorMaps,
        {},
        (response: { ok: boolean; maps?: RoomEditorMapSummary[] }) => {
          if (!response.ok) {
            setMapsStatus('error')
            return
          }
          setMaps(response.maps ?? [])
          setMapsStatus('ready')
        },
      )
    }

    socket.on('connect', () => {
      socket.emit(clientEvents.connectToGame, { profile: sessionRef.current.profile })
    })
    socket.on(serverEvents.connectionAccepted, ({ profile }: ConnectionAcceptedPayload) => {
      const nextSession: AuthSession = { ...sessionRef.current, profile }
      sessionRef.current = nextSession
      setResolvedProfile(profile)
      if (nextSession.provider === 'local') {
        saveAuthSession(nextSession)
      }
      onSessionChange(nextSession)

      if (canAccessRoomEditor(profile.role)) {
        setMapsStatus('loading')
        requestMaps()
      } else {
        setMaps([])
        setMapsStatus('ready')
      }
    })

    return () => {
      socketRef.current = null
      socket.disconnect()
    }
  }, [onSessionChange])

  const deleteMap = (map: RoomEditorMapSummary) => {
    const socket = socketRef.current
    if (!socket?.connected || deletingMapCode) return
    if (!window.confirm(`¿Eliminar permanentemente el mapa “${map.name}”?`)) return

    setDeletingMapCode(map.code)
    setMapActionMessage('Eliminando mapa...')
    socket.emit(
      clientEvents.deleteRoomEditorMap,
      { code: map.code },
      (response: { ok: boolean; message?: string }) => {
        setDeletingMapCode(null)
        if (!response.ok) {
          setMapActionMessage(response.message ?? 'No fue posible eliminar el mapa.')
          return
        }
        setMaps((currentMaps) => currentMaps.filter((candidate) => candidate.code !== map.code))
        setMapActionMessage(`“${map.name}” fue eliminado.`)
      },
    )
  }

  const renderMapRow = (map: RoomEditorMapSummary) => {
    const isOwner = map.ownerUserId === resolvedProfile.userId
    return (
      <article
        key={map.code}
        className={`room-editor-menu-map-row${isOwner ? '' : ' is-read-only'}`}
      >
        <button
          type="button"
          className="room-editor-menu-map-open"
          onClick={() => navigateInApp(`/EditRoom?room=${encodeURIComponent(map.code)}`)}
          title={`Abrir ${map.name}`}
          disabled={deletingMapCode === map.code}
        >
          <span>
            <strong>{map.name}</strong>
            <small>
              {map.routePath ?? 'Sin URL publicada'}
              {!isOwner ? ` · ${map.ownerDisplayName}` : ''}
            </small>
          </span>
          <code>{map.code}</code>
        </button>
        {isOwner ? (
          <button
            type="button"
            className="room-editor-menu-map-delete"
            aria-label={`Eliminar mapa ${map.name}`}
            title={`Eliminar ${map.name}`}
            disabled={Boolean(deletingMapCode)}
            onClick={() => deleteMap(map)}
          >
            {deletingMapCode === map.code ? '…' : '×'}
          </button>
        ) : null}
      </article>
    )
  }

  return (
    <main className="room-editor-menu-page" aria-label="Menú del editor de escenas">
      <section className="room-editor-menu-panel" aria-labelledby="room-editor-menu-title">
        <div className="room-editor-menu-user" aria-label="Usuario conectado">
          <span className="room-editor-menu-avatar" aria-hidden="true">
            {resolvedProfile.displayName.trim().charAt(0).toUpperCase() || '?'}
          </span>
          <div>
            <span>Usuario conectado</span>
            <strong>{resolvedProfile.displayName}</strong>
          </div>
        </div>

        <h1 id="room-editor-menu-title">Editor de escenas</h1>

        <section className="room-editor-menu-maps" aria-labelledby="room-editor-maps-title">
          <header>
            <strong id="room-editor-maps-title">
              {resolvedProfile.role === 'developer' ? 'Mapas disponibles' : 'Mis mapas'}
            </strong>
            <output>{maps.length}</output>
          </header>
          <div className="room-editor-menu-map-list">
            {mapsStatus === 'loading' ? (
              <p>Cargando mapas...</p>
            ) : mapsStatus === 'error' ? (
              <p>No fue posible cargar tus mapas.</p>
            ) : maps.length === 0 ? (
              <p>Todavía no has creado mapas.</p>
            ) : (
              <>
                {resolvedProfile.role === 'developer' ? (
                  <h2>Mis mapas</h2>
                ) : null}
                {ownedMaps.length > 0
                  ? ownedMaps.map(renderMapRow)
                  : <p>No tienes mapas propios.</p>}
                {sharedMaps.length > 0 ? (
                  <>
                    <h2>URLs globales y eventos</h2>
                    {sharedMaps.map(renderMapRow)}
                  </>
                ) : null}
              </>
            )}
          </div>
          {mapActionMessage ? <p className="room-editor-menu-map-message">{mapActionMessage}</p> : null}
        </section>

        <div className="room-editor-menu-actions">
          <button
            type="button"
            className="room-editor-menu-create"
            disabled={!canUseRoomEditor}
            title={canUseRoomEditor ? 'Crear una escena nueva' : 'Tu rol no puede crear escenas'}
            onClick={() => navigateInApp('/EditRoom?new=1')}
          >
            Crear nueva escena
          </button>
          <div className="room-editor-menu-open-map">
            <input
              type="text"
              value={mapCode}
              maxLength={24}
              placeholder="Código del mapa"
              aria-label="Código del mapa guardado"
              disabled={!canUseRoomEditor}
              onChange={(event) => setMapCode(event.target.value.toUpperCase())}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && normalizedMapCode) {
                  navigateInApp(`/EditRoom?room=${encodeURIComponent(normalizedMapCode)}`)
                }
              }}
            />
            <button
              type="button"
              disabled={!canUseRoomEditor || !normalizedMapCode}
              onClick={() => navigateInApp(`/EditRoom?room=${encodeURIComponent(normalizedMapCode)}`)}
            >
              Abrir mapa
            </button>
          </div>
          <button
            type="button"
            className="room-editor-menu-role"
            onClick={() => navigateInApp('/accessRole?returnTo=/Editor')}
          >
            Cambiar rol
          </button>
          <button
            type="button"
            className="room-editor-menu-exit"
            onClick={() => navigateInApp('/Tavern')}
          >
            Salir
          </button>
        </div>

        {!canUseRoomEditor ? (
          <p className="room-editor-menu-denied">El rol visitante puede entrar a salas, pero no crearlas.</p>
        ) : null}
      </section>
    </main>
  )
}
