import { useState } from 'react'
import type { AuthSession } from '../auth/localSession'
import { navigateInApp } from '../hooks/usePathname'
import { canAccessRoomEditor } from '../rooms/roomEditorAccess'

interface RoomEditorMenuPageProps {
  session: AuthSession
}

export default function RoomEditorMenuPage({ session }: RoomEditorMenuPageProps) {
  const canUseRoomEditor = canAccessRoomEditor(session.profile.role)
  const [mapCode, setMapCode] = useState('')
  const normalizedMapCode = mapCode.trim().toUpperCase()

  return (
    <main className="room-editor-menu-page" aria-label="Menú del editor de escenas">
      <section className="room-editor-menu-panel" aria-labelledby="room-editor-menu-title">
        <div className="room-editor-menu-user" aria-label="Usuario conectado">
          <span className="room-editor-menu-avatar" aria-hidden="true">
            {session.profile.displayName.trim().charAt(0).toUpperCase() || '?'}
          </span>
          <div>
            <span>Usuario conectado</span>
            <strong>{session.profile.displayName}</strong>
          </div>
        </div>

        <h1 id="room-editor-menu-title">Editor de escenas</h1>

        <div className="room-editor-menu-actions">
          <button
            type="button"
            className="room-editor-menu-create"
            disabled={!canUseRoomEditor}
            title={canUseRoomEditor ? 'Crear una escena nueva' : 'Tu rol no puede crear escenas'}
            onClick={() => navigateInApp('/EditRoom')}
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
