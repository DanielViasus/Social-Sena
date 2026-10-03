import { useAuth0 } from '@auth0/auth0-react'
import { useEffect, useState } from 'react'
import { resolvePostLoginRoute } from '../auth/auth0Config'
import {
  createAuth0Session,
  createLocalAuthSession,
  readStoredAuthSession,
  saveAuthSession,
  clearAuthSession,
  type AuthSession,
} from '../auth/localSession'
import PublishedRoomGate from './PublishedRoomGate'
import LoginScreen from './LoginScreen'
import AccessRolePage from './AccessRolePage'
import EditRoomPage from './EditRoomPage'
import RoomEditorMenuPage from './RoomEditorMenuPage'
import {
  isAccessRolePath,
  hasEditRoomContext,
  isEditRoomPath,
  isRoomEditorMenuPath,
  isStandalonePagePath,
  usePathname,
} from '../hooks/usePathname'

function redirectToLobbyIfNeeded() {
  if (window.location.pathname === '/Tavern' || isStandalonePagePath(window.location.pathname)) {
    return
  }

  window.history.replaceState({}, '', '/Tavern')
  window.dispatchEvent(new PopStateEvent('popstate'))
}

function Auth0App() {
  const { error, isAuthenticated, isLoading, loginWithRedirect, logout, user } = useAuth0()
  const pathname = usePathname()
  const [session, setSession] = useState<AuthSession | null>(null)
  const [localSession, setLocalSession] = useState<AuthSession | null>(() => {
    const storedSession = readStoredAuthSession()
    return storedSession?.provider === 'local' ? storedSession : null
  })
  const displayName =
    user?.name ?? user?.nickname ?? user?.given_name ?? user?.email?.split('@')[0] ?? 'Jugador'
  const auth0UserId = user?.sub ?? null

  const handleAuth0Login = () =>
    void loginWithRedirect({
      appState: {
        returnTo: resolvePostLoginRoute(window.location.pathname),
      },
    })

  const handleAuth0ChooseAccount = () =>
    void loginWithRedirect({
      appState: {
        returnTo: resolvePostLoginRoute(window.location.pathname),
      },
      authorizationParams: {
        prompt: 'select_account',
      },
    })


  const handleLocalLogin = (displayName: string) => {
    const nextSession = createLocalAuthSession(displayName)
    saveAuthSession(nextSession)
    window.history.replaceState(
      {},
      '',
      resolvePostLoginRoute(`${window.location.pathname}${window.location.search}`),
    )
    setLocalSession(nextSession)
  }

  const handleLocalLogout = () => {
    clearAuthSession()
    redirectToLobbyIfNeeded()
    setLocalSession(null)
  }

  useEffect(() => {
    if (!isAuthenticated || !user || !auth0UserId) {
      setSession(null)
      return
    }

    const nextSession = createAuth0Session({
      displayName,
      userId: auth0UserId,
      username: user.nickname ?? user.preferred_username ?? user.email ?? displayName,
      pictureUrl: user.picture ?? null,
    })

    setSession((currentSession) => {
      if (currentSession?.profile.userId === nextSession.profile.userId) {
        return {
          ...currentSession,
          pictureUrl: nextSession.pictureUrl,
          profile: {
            ...currentSession.profile,
            username: nextSession.profile.username,
            displayName: nextSession.profile.displayName,
          },
        }
      }

      return nextSession
    })
  }, [auth0UserId, displayName, isAuthenticated, user])

  if (isLoading) {
    return (
      <main className="login-layout">
        <section className="login-panel">
          <p className="login-kicker">Social Sena</p>
          <h1>Conectando con Auth0</h1>
          <p className="login-copy">Estamos preparando tu sesión para entrar al lobby.</p>
        </section>
      </main>
    )
  }

  if (error) {
    return (
      <LoginScreen
        auth0Ready
        auth0Error={error.message}
        onAuth0Login={handleAuth0Login}
        onAuth0ChooseAccount={handleAuth0ChooseAccount}
        onLogin={() => {}}
      />
    )
  }

  if (!isAuthenticated || !user) {
    if (localSession) {
      if (isAccessRolePath(pathname)) {
        return <AccessRolePage session={localSession} onSessionChange={setLocalSession} />
      }

      if (isEditRoomPath(pathname)) {
        if (!hasEditRoomContext()) {
          return <RoomEditorMenuPage session={localSession} onSessionChange={setLocalSession} />
        }
        return <EditRoomPage session={localSession} onSessionChange={setLocalSession} />
      }

      if (isRoomEditorMenuPath(pathname)) {
        return <RoomEditorMenuPage session={localSession} onSessionChange={setLocalSession} />
      }

      return <PublishedRoomGate session={localSession} onSessionChange={setLocalSession} onLogout={handleLocalLogout} />
    }

    return (
      <LoginScreen
        auth0Ready
        onAuth0Login={handleAuth0Login}
        onAuth0ChooseAccount={handleAuth0ChooseAccount}
        onLogin={handleLocalLogin}
      />
    )
  }

  if (!session) {
    return null
  }

  if (isAccessRolePath(pathname)) {
    return <AccessRolePage session={session} onSessionChange={setSession} />
  }

  if (isEditRoomPath(pathname)) {
    if (!hasEditRoomContext()) {
      return <RoomEditorMenuPage session={session} onSessionChange={setSession} />
    }
    return <EditRoomPage session={session} onSessionChange={setSession} />
  }

  if (isRoomEditorMenuPath(pathname)) {
    return <RoomEditorMenuPage session={session} onSessionChange={setSession} />
  }

  return (
    <PublishedRoomGate
      session={session}
      onSessionChange={setSession}
      onLogout={() =>
        void logout({
          logoutParams: {
            returnTo: `${window.location.origin}/Tavern`,
          },
        })
      }
    />
  )
}

export default Auth0App
