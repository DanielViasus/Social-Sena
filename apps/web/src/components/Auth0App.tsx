import { useAuth0 } from '@auth0/auth0-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { resolvePostLoginRoute } from '../auth/auth0Config'
import {
  createAuth0Session,
  createLocalAuthSession,
  consumeSessionReplacementReauthenticated,
  readStoredAuthSession,
  readSessionReplacementMessage,
  saveAuthSession,
  saveSessionReplacementMessage,
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
  const [sessionReplacementMessage, setSessionReplacementMessage] = useState<string | null>(
    () => readSessionReplacementMessage(),
  )
  const auth0LogoutStartedRef = useRef(false)
  const [localSession, setLocalSession] = useState<AuthSession | null>(() => {
    const storedSession = readStoredAuthSession()
    return storedSession?.provider === 'local' ? storedSession : null
  })
  const displayName =
    user?.name ?? user?.nickname ?? user?.given_name ?? user?.email?.split('@')[0] ?? 'Jugador'
  const auth0UserId = user?.sub ?? null
  const auth0ClientSessionId = session?.clientSessionId

  const startAuth0Login = (prompt?: 'login' | 'select_account') => {
    void loginWithRedirect({
      appState: {
        returnTo: resolvePostLoginRoute(window.location.pathname),
      },
      ...(prompt
        ? { authorizationParams: { prompt } }
        : {}),
    })
  }

  const handleAuth0Login = () => startAuth0Login(sessionReplacementMessage ? 'login' : undefined)

  const handleAuth0ChooseAccount = () => startAuth0Login('select_account')


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

  const handleLocalLogout = useCallback(() => {
    clearAuthSession()
    redirectToLobbyIfNeeded()
    setLocalSession(null)
  }, [])

  const handleLocalSessionReplaced = useCallback(() => {
    clearAuthSession(localSession?.clientSessionId, { preserveClientSessionId: true })
    redirectToLobbyIfNeeded()
    setLocalSession(null)
  }, [localSession?.clientSessionId])

  const handleAuth0Logout = useCallback(() => {
    if (auth0LogoutStartedRef.current) {
      return
    }

    auth0LogoutStartedRef.current = true
    clearAuthSession()
    setSessionReplacementMessage(null)
    setSession(null)
    void logout({
      logoutParams: {
        returnTo: `${window.location.origin}/Tavern`,
      },
    })
  }, [logout])

  const handleAuth0SessionReplaced = useCallback(() => {
    const replacementMessage =
      'Esta cuenta inició sesión en otro dispositivo. Autentícate nuevamente para continuar aquí.'
    if (!auth0ClientSessionId || !auth0UserId) {
      return
    }

    clearAuthSession(auth0ClientSessionId, { preserveClientSessionId: true })
    saveSessionReplacementMessage(replacementMessage, {
      clientSessionId: auth0ClientSessionId,
      userId: auth0UserId,
    })
    setSession(null)
    setSessionReplacementMessage(replacementMessage)
    window.history.replaceState({}, '', '/Tavern')
    window.dispatchEvent(new PopStateEvent('popstate'))
  }, [auth0ClientSessionId, auth0UserId])

  useEffect(() => {
    if (!isAuthenticated) {
      auth0LogoutStartedRef.current = false
    }
  }, [isAuthenticated])

  useEffect(() => {
    if (
      !isAuthenticated ||
      !sessionReplacementMessage ||
      !consumeSessionReplacementReauthenticated()
    ) {
      return
    }

    window.queueMicrotask(() => {
      setSessionReplacementMessage(null)
    })
  }, [isAuthenticated, sessionReplacementMessage])

  useEffect(() => {
    if (sessionReplacementMessage) {
      return
    }

    if (!isAuthenticated || !user || !auth0UserId) {
      window.queueMicrotask(() => {
        setSession(null)
      })
      return
    }

    const nextSession = createAuth0Session({
      displayName,
      userId: auth0UserId,
      username: user.nickname ?? user.preferred_username ?? user.email ?? displayName,
      pictureUrl: user.picture ?? null,
    })

    window.queueMicrotask(() => {
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
    })
  }, [auth0UserId, displayName, isAuthenticated, sessionReplacementMessage, user])

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

  if (sessionReplacementMessage) {
    return (
      <LoginScreen
        auth0Ready
        auth0Error={sessionReplacementMessage}
        onAuth0Login={handleAuth0Login}
        onAuth0ChooseAccount={handleAuth0ChooseAccount}
        onLogin={() => {}}
      />
    )
  }

  if (!isAuthenticated || !user) {
    if (localSession) {
      if (isAccessRolePath(pathname)) {
        return (
          <AccessRolePage
            session={localSession}
            onSessionChange={setLocalSession}
            onSessionReplaced={handleLocalSessionReplaced}
          />
        )
      }

      if (isEditRoomPath(pathname)) {
        if (!hasEditRoomContext()) {
          return (
            <RoomEditorMenuPage
              session={localSession}
              onSessionChange={setLocalSession}
              onSessionReplaced={handleLocalSessionReplaced}
            />
          )
        }
        return (
          <EditRoomPage
            session={localSession}
            onSessionChange={setLocalSession}
            onSessionReplaced={handleLocalSessionReplaced}
          />
        )
      }

      if (isRoomEditorMenuPath(pathname)) {
        return (
          <RoomEditorMenuPage
            session={localSession}
            onSessionChange={setLocalSession}
            onSessionReplaced={handleLocalSessionReplaced}
          />
        )
      }

      return (
        <PublishedRoomGate
          session={localSession}
          onSessionChange={setLocalSession}
          onLogout={handleLocalLogout}
          onSessionReplaced={handleLocalSessionReplaced}
        />
      )
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
    return (
      <AccessRolePage
        session={session}
        onSessionChange={setSession}
        onSessionReplaced={handleAuth0SessionReplaced}
      />
    )
  }

  if (isEditRoomPath(pathname)) {
    if (!hasEditRoomContext()) {
      return (
        <RoomEditorMenuPage
          session={session}
          onSessionChange={setSession}
          onSessionReplaced={handleAuth0SessionReplaced}
        />
      )
    }
    return (
      <EditRoomPage
        session={session}
        onSessionChange={setSession}
        onSessionReplaced={handleAuth0SessionReplaced}
      />
    )
  }

  if (isRoomEditorMenuPath(pathname)) {
    return (
      <RoomEditorMenuPage
        session={session}
        onSessionChange={setSession}
        onSessionReplaced={handleAuth0SessionReplaced}
      />
    )
  }

  return (
    <PublishedRoomGate
      session={session}
      onSessionChange={setSession}
      onLogout={handleAuth0Logout}
      onSessionReplaced={handleAuth0SessionReplaced}
    />
  )
}

export default Auth0App
