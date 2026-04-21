import { useAuth0 } from '@auth0/auth0-react'
import { resolvePostLoginRoute } from '../auth/auth0Config'
import { createAuth0Session } from '../auth/localSession'
import GameClient from './GameClient'
import LoginScreen from './LoginScreen'

function Auth0App() {
  const { error, isAuthenticated, isLoading, loginWithRedirect, logout, user } = useAuth0()

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

  const displayName =
    user.name ?? user.nickname ?? user.given_name ?? user.email?.split('@')[0] ?? 'Jugador'

  const session = createAuth0Session({
    displayName,
    userId: user.sub ?? `auth0_${crypto.randomUUID().slice(0, 8)}`,
    username: user.nickname ?? user.preferred_username ?? user.email ?? displayName,
    pictureUrl: user.picture ?? null,
  })

  return (
    <GameClient
      session={session}
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
