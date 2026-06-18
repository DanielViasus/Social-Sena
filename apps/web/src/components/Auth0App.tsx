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
import GameClient from './GameClient'
import LoginScreen from './LoginScreen'

function redirectToLobbyIfNeeded() {
  if (window.location.pathname === '/Room_1909') {
    return
  }

  window.history.replaceState({}, '', '/Room_1909')
  window.dispatchEvent(new PopStateEvent('popstate'))
}

function Auth0App() {
  const { error, isAuthenticated, isLoading, loginWithRedirect, logout, user } = useAuth0()
  const [session, setSession] = useState<AuthSession | null>(null)
  const [localSession, setLocalSession] = useState<AuthSession | null>(() => {
    const storedSession = readStoredAuthSession()
    return storedSession?.provider === 'local' ? storedSession : null
  })
  const displayName =
    user?.name ?? user?.nickname ?? user?.given_name ?? user?.email?.split('@')[0] ?? 'Jugador'
  const auth0UserId = user?.sub ?? null
  const sameSkinColors = (left: AuthSession | null, right: AuthSession) =>
    JSON.stringify(left?.profile.skinColors ?? {}) === JSON.stringify(right.profile.skinColors ?? {})

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
    window.history.replaceState({}, '', '/Room_1909')
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
      if (
        currentSession &&
        currentSession.profile.userId === nextSession.profile.userId &&
        (currentSession.profile.skinId !== nextSession.profile.skinId || !sameSkinColors(currentSession, nextSession))
      ) {
        return currentSession
      }

      return nextSession
    })
  }, [auth0UserId, displayName, isAuthenticated, user])

  useEffect(() => {
    if (!isLoading && !isAuthenticated && !localSession) {
      redirectToLobbyIfNeeded()
    }
  }, [isAuthenticated, isLoading, localSession])

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
      return <GameClient session={localSession} onSessionChange={setLocalSession} onLogout={handleLocalLogout} />
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

  return (
    <GameClient
      session={session}
      onSessionChange={setSession}
      onLogout={() =>
        void logout({
          logoutParams: {
            returnTo: `${window.location.origin}/Room_1909`,
          },
        })
      }
    />
  )
}

export default Auth0App
