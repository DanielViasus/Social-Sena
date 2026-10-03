import { useCallback, useEffect, useRef, useState } from 'react'
import { io, type Socket } from 'socket.io-client'
import {
  USER_ROLES,
  clientEvents,
  serverEvents,
  type ConnectionAcceptedPayload,
  type UserProfile,
  type UserRole,
} from '@social-sena/shared'
import { saveAuthSession, type AuthSession } from '../auth/localSession'
import { getAccessRoleReturnPath, navigateInApp } from '../hooks/usePathname'

const SERVER_URL = import.meta.env.VITE_GAME_SERVER_URL ?? 'http://localhost:3001'

const ROLE_LABELS: Record<UserRole, string> = {
  visitor: 'Visitante',
  user: 'Usuario',
  mage: 'Mago',
  admin: 'Administrador',
  developer: 'Desarrollador',
}

interface AccessRolePageProps {
  session: AuthSession
  onSessionChange: (session: AuthSession) => void
}

interface UpdateRoleResponse {
  ok: boolean
  message?: string
  profile?: UserProfile
}

export default function AccessRolePage({ session, onSessionChange }: AccessRolePageProps) {
  const socketRef = useRef<Socket | null>(null)
  const sessionRef = useRef(session)
  const [selectedRole, setSelectedRole] = useState<UserRole>(session.profile.role)
  const [connected, setConnected] = useState(false)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('Conectando con el servidor...')
  const [messageKind, setMessageKind] = useState<'neutral' | 'success' | 'error'>('neutral')

  const updateSessionProfile = useCallback((profile: UserProfile) => {
    const nextSession: AuthSession = {
      ...sessionRef.current,
      profile,
    }

    sessionRef.current = nextSession
    if (nextSession.provider === 'local') {
      saveAuthSession(nextSession)
    }
    onSessionChange(nextSession)
  }, [onSessionChange])

  useEffect(() => {
    const socket = io(SERVER_URL, { autoConnect: true })
    socketRef.current = socket

    socket.on('connect', () => {
      setMessage('Validando tu rol actual...')
      socket.emit(clientEvents.connectToGame, { profile: sessionRef.current.profile })
    })

    socket.on(serverEvents.connectionAccepted, ({ profile }: ConnectionAcceptedPayload) => {
      setConnected(true)
      setSelectedRole(profile.role)
      setMessage(`Rol actual: ${ROLE_LABELS[profile.role]}`)
      setMessageKind('neutral')
      updateSessionProfile(profile)
    })

    socket.on('disconnect', () => {
      setConnected(false)
      setMessage('Se perdió la conexión con el servidor.')
      setMessageKind('error')
    })

    return () => {
      socket.disconnect()
      socketRef.current = null
    }
  }, [updateSessionProfile])

  const handleSaveRole = () => {
    const socket = socketRef.current
    if (!socket || !connected || saving) {
      return
    }

    setSaving(true)
    setMessage('Guardando el nuevo rol...')
    setMessageKind('neutral')

    socket.emit(
      clientEvents.updateAccessRole,
      { role: selectedRole },
      (response: UpdateRoleResponse) => {
        setSaving(false)

        if (!response.ok || !response.profile) {
          setMessage(response.message ?? 'No fue posible actualizar el rol.')
          setMessageKind('error')
          return
        }

        setSelectedRole(response.profile.role)
        updateSessionProfile(response.profile)
        setMessage(`Rol actualizado a ${ROLE_LABELS[response.profile.role]}.`)
        setMessageKind('success')
      },
    )
  }

  const handleReturn = () => navigateInApp(getAccessRoleReturnPath())

  return (
    <main className="access-role-page">
      <section className="access-role-panel" aria-labelledby="access-role-title">
        <p className="access-role-kicker">Herramienta de desarrollo</p>
        <h1 id="access-role-title">Cambiar rol</h1>
        <p className="access-role-user">Sesión: {session.profile.displayName}</p>

        <label className="access-role-field" htmlFor="access-role-select">
          <span>Rol de acceso</span>
          <select
            id="access-role-select"
            value={selectedRole}
            disabled={!connected || saving}
            onChange={(event) => setSelectedRole(event.target.value as UserRole)}
          >
            {USER_ROLES.map((role) => (
              <option key={role} value={role}>
                {ROLE_LABELS[role]}
              </option>
            ))}
          </select>
        </label>

        <p className={`access-role-message is-${messageKind}`} aria-live="polite">
          {message}
        </p>

        <div className="access-role-actions">
          <button type="button" className="access-role-back" onClick={handleReturn}>
            Volver
          </button>
          <button
            type="button"
            className="access-role-save"
            disabled={!connected || saving}
            onClick={handleSaveRole}
          >
            {saving ? 'Guardando...' : 'Guardar rol'}
          </button>
        </div>
      </section>
    </main>
  )
}
