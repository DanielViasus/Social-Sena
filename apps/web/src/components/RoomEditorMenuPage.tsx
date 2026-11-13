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
import { listenForSessionReplacement } from '../auth/sessionReplacement'
import { navigateInApp } from '../hooks/usePathname'
import { deleteAnimation, listAnimations, type AnimationSummary } from '../game/avatar/animationEditorStorage'
import { DEFAULT_VARIATION_ID, countAssigned, loadAssignments } from '../game/avatar/animationAssignmentStorage'
import { canAccessRoomEditor } from '../rooms/roomEditorAccess'

const EDITOR_TABS = [
  { id: 'levels', label: 'Niveles' },
  { id: 'animations', label: 'Assets y animaciones' },
  { id: 'assignments', label: 'Asignar animaciones' },
] as const

interface RoomEditorMenuPageProps {
  session: AuthSession
  onSessionChange: (session: AuthSession) => void
  onSessionReplaced: () => void
}

const SERVER_URL = import.meta.env.VITE_GAME_SERVER_URL ?? 'http://localhost:3001'

export default function RoomEditorMenuPage({
  session,
  onSessionChange,
  onSessionReplaced,
}: RoomEditorMenuPageProps) {
  const sessionRef = useRef(session)
  const socketRef = useRef<Socket | null>(null)
  const [resolvedProfile, setResolvedProfile] = useState<UserProfile>(session.profile)
  const canUseRoomEditor = canAccessRoomEditor(resolvedProfile.role)
  const [activeTab, setActiveTab] = useState<'levels' | 'animations' | 'assignments'>('levels')
  const [assignments] = useState(loadAssignments)
  const [animations, setAnimations] = useState<AnimationSummary[]>([])
  const [animationsStatus, setAnimationsStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [deletingAnimationId, setDeletingAnimationId] = useState<string | null>(null)
  const [animationActionMessage, setAnimationActionMessage] = useState('')

  const removeAnimation = async (animation: AnimationSummary) => {
    if (deletingAnimationId) return
    if (!window.confirm(`¿Eliminar permanentemente la animación “${animation.name}”?`)) return
    setDeletingAnimationId(animation.id)
    setAnimationActionMessage('Eliminando animación…')
    try {
      await deleteAnimation(animation.id)
      setAnimations((previous) => previous.filter((item) => item.id !== animation.id))
      setAnimationActionMessage(`“${animation.name}” fue eliminada.`)
    } catch (error) {
      setAnimationActionMessage(error instanceof Error ? error.message : 'No se pudo eliminar la animación.')
    } finally {
      setDeletingAnimationId(null)
    }
  }

  useEffect(() => {
    let cancelled = false
    listAnimations().then((records) => {
      if (!cancelled) { setAnimations(records); setAnimationsStatus('ready') }
    }).catch(() => { if (!cancelled) setAnimationsStatus('error') })
    return () => { cancelled = true }
  }, [])

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
    const stopListeningForSessionReplacement = listenForSessionReplacement(socket, onSessionReplaced)
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
      socket.emit(clientEvents.connectToGame, {
        clientSessionId: sessionRef.current.clientSessionId,
        profile: sessionRef.current.profile,
      })
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
      stopListeningForSessionReplacement()
      socketRef.current = null
      socket.disconnect()
    }
  }, [onSessionChange, onSessionReplaced])

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

        <div className="room-editor-menu-tabs" role="tablist" aria-label="Contenido guardado">
          {EDITOR_TABS.map((tab) => (
            <button
              key={tab.id}
              type="button"
              role="tab"
              id={`editor-tab-${tab.id}`}
              aria-controls={`editor-panel-${tab.id}`}
              aria-selected={activeTab === tab.id}
              tabIndex={activeTab === tab.id ? 0 : -1}
              onClick={() => setActiveTab(tab.id)}
              onKeyDown={(event) => {
                if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
                event.preventDefault()
                const index = EDITOR_TABS.findIndex((item) => item.id === activeTab)
                const nextIndex = event.key === 'Home' ? 0
                  : event.key === 'End' ? EDITOR_TABS.length - 1
                  : (index + (event.key === 'ArrowRight' ? 1 : -1) + EDITOR_TABS.length) % EDITOR_TABS.length
                const nextTab = EDITOR_TABS[nextIndex].id
                setActiveTab(nextTab)
                window.document.getElementById(`editor-tab-${nextTab}`)?.focus()
              }}
            >{tab.label}</button>
          ))}
        </div>

        {activeTab === 'levels' ? (
        <section id="editor-panel-levels" role="tabpanel" className="room-editor-menu-maps" aria-labelledby="editor-tab-levels">
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

        ) : activeTab === 'animations' ? (
          <section id="editor-panel-animations" role="tabpanel" className="room-editor-menu-maps" aria-labelledby="editor-tab-animations">
            <header><strong>Animaciones guardadas</strong><output>{animations.length}</output></header>
            <div className="room-editor-menu-map-list">
              {animationsStatus === 'loading' ? <p>Cargando animaciones…</p>
                : animationsStatus === 'error' ? <p>No se pudieron leer las animaciones de este navegador.</p>
                : animations.length === 0 ? <p>Todavía no hay animaciones guardadas en este navegador.</p>
                : animations.map((animation) => (
                  <article key={animation.id} className="room-editor-menu-map-row">
                    <button type="button" className="room-editor-menu-map-open" disabled={deletingAnimationId === animation.id} title={`Abrir ${animation.name}`} onClick={() => navigateInApp(`/editor/animations?animation=${encodeURIComponent(animation.id)}`)}>
                      <span><strong>{animation.name}</strong><small>Animación · Guardada en este navegador</small></span>
                    </button>
                    <button
                      type="button"
                      className="room-editor-menu-map-delete"
                      aria-label={`Eliminar animación ${animation.name}`}
                      title={`Eliminar ${animation.name}`}
                      disabled={Boolean(deletingAnimationId)}
                      onClick={() => { void removeAnimation(animation) }}
                    >{deletingAnimationId === animation.id ? '…' : '×'}</button>
                  </article>
                ))}
            </div>
            {animationActionMessage && <p className="room-editor-menu-map-message" role="status">{animationActionMessage}</p>}
          </section>
        ) : (
          <section id="editor-panel-assignments" role="tabpanel" className="room-editor-menu-maps" aria-labelledby="editor-tab-assignments">
            <header><strong>Variaciones de animación</strong><output>{assignments.variations.length}</output></header>
            <div className="room-editor-menu-map-list">
              {assignments.variations.length === 0 ? <p>Todavía no hay variaciones. Crea una para asignar animaciones a cada estado.</p>
                : assignments.variations.map((variation) => (
                  <article key={variation.id} className="room-editor-menu-map-row">
                    <button type="button" className="room-editor-menu-map-open" title={`Abrir ${variation.name}`} onClick={() => navigateInApp(`/editor/assignments?variation=${encodeURIComponent(variation.id)}`)}>
                      <span><strong>{variation.name}</strong><small>{variation.id === DEFAULT_VARIATION_ID ? 'Referencia' : 'Variación'} · {countAssigned(variation)} {countAssigned(variation) === 1 ? 'asignación' : 'asignaciones'}</small></span>
                    </button>
                  </article>
                ))}
            </div>
          </section>
        )}

        <div className="room-editor-menu-actions">
          {activeTab === 'animations' ? (
          <button
            type="button"
            className="room-editor-menu-animate"
            onClick={() => navigateInApp('/editor/animations')}
            title="Abrir el editor de animaciones"
          >
            Crear animación
          </button>
          ) : activeTab === 'assignments' ? (
          <button
            type="button"
            className="room-editor-menu-animate"
            onClick={() => navigateInApp('/editor/assignments?new=1')}
            title="Crear una variación y asignar animaciones a sus estados"
          >
            Crear variación
          </button>
          ) : (
            <>
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
            </>
          )}
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
          <p className="room-editor-menu-denied" style={{ visibility: activeTab === 'levels' ? 'visible' : 'hidden' }}>El rol visitante puede entrar a salas, pero no crearlas.</p>
        ) : null}
      </section>
    </main>
  )
}
