import { useAuth0 } from '@auth0/auth0-react'
import { useEffect, useState } from 'react'
import { resolvePostLoginRoute } from '../auth/auth0Config'
import { createAuth0Session, type AuthSession } from '../auth/localSession'
import GameClient from './GameClient'
import LoginScreen from './LoginScreen'

function Auth0App() {
  const { error, isAuthenticated, isLoading, loginWithRedirect, logout, user } = useAuth0()
  const [session, setSession] = useState<AuthSession | null>(null)
  const displayName =
    user?.name ?? user?.nickname ?? user?.given_name ?? user?.email?.split('@')[0] ?? 'Jugador'
  const auth0UserId = user?.sub ?? null

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
        currentSession.profile.skinId !== nextSession.profile.skinId
      ) {
        return currentSession
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
        onAuth0Login={() =>
          void loginWithRedirect({
            appState: {
              returnTo: resolvePostLoginRoute(window.location.pathname),
            },
          })
        }
        onLogin={() => {}}
      />
    )
  }

  if (!isAuthenticated || !user) {
    return (
      <LoginScreen
        auth0Ready
        onAuth0Login={() =>
          void loginWithRedirect({
            appState: {
              returnTo: resolvePostLoginRoute(window.location.pathname),
            },
          })
        }
        onLogin={() => {}}
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
            returnTo: window.location.origin,
          },
        })
      }
    />
  )
}

export default Auth0App
