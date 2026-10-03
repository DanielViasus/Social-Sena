import { useState } from 'react'
import { isAuth0Configured, resolvePostLoginRoute } from './auth/auth0Config'
import {
  clearAuthSession,
  createLocalAuthSession,
  readStoredAuthSession,
  saveAuthSession,
  type AuthSession,
} from './auth/localSession'
import PublishedRoomGate from './components/PublishedRoomGate'
import LoginScreen from './components/LoginScreen'
import Auth0App from './components/Auth0App'
import AccessRolePage from './components/AccessRolePage'
import EditRoomPage from './components/EditRoomPage'
import RoomEditorMenuPage from './components/RoomEditorMenuPage'
import {
  isAccessRolePath,
  hasEditRoomContext,
  isEditRoomPath,
  isRoomEditorMenuPath,
  isStandalonePagePath,
  usePathname,
} from './hooks/usePathname'

function redirectToLobbyIfNeeded() {
  if (window.location.pathname === '/Tavern' || isStandalonePagePath(window.location.pathname)) {
    return
  }

  window.history.replaceState({}, '', '/Tavern')
  window.dispatchEvent(new PopStateEvent('popstate'))
}

function LocalApp() {
  const [session, setSession] = useState<AuthSession | null>(() => readStoredAuthSession())
  const pathname = usePathname()

  const handleLogin = (displayName: string) => {
    const nextSession = createLocalAuthSession(displayName)
    saveAuthSession(nextSession)
    window.history.replaceState(
      {},
      '',
      resolvePostLoginRoute(`${window.location.pathname}${window.location.search}`),
    )
    setSession(nextSession)
  }

  const handleLogout = () => {
    clearAuthSession()
    redirectToLobbyIfNeeded()
    setSession(null)
  }

  if (!session) {
    return <LoginScreen auth0Ready={isAuth0Configured} onLogin={handleLogin} />
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

  return <PublishedRoomGate session={session} onSessionChange={setSession} onLogout={handleLogout} />
}

function App() {
  return isAuth0Configured ? <Auth0App /> : <LocalApp />
}

export default App
