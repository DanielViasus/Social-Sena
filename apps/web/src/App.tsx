import { useState } from 'react'
import { isAuth0Configured } from './auth/auth0Config'
import {
  clearAuthSession,
  createLocalAuthSession,
  readStoredAuthSession,
  saveAuthSession,
  type AuthSession,
} from './auth/localSession'
import GameClient from './components/GameClient'
import LoginScreen from './components/LoginScreen'
import Auth0App from './components/Auth0App'

function LocalApp() {
  const [session, setSession] = useState<AuthSession | null>(() => readStoredAuthSession())

  const handleLogin = (displayName: string) => {
    const nextSession = createLocalAuthSession(displayName)
    saveAuthSession(nextSession)
    window.history.replaceState({}, '', '/Room_1909')
    setSession(nextSession)
  }

  const handleLogout = () => {
    clearAuthSession()
    setSession(null)
  }

  if (!session) {
    return <LoginScreen auth0Ready={isAuth0Configured} onLogin={handleLogin} />
  }

  return <GameClient session={session} onLogout={handleLogout} />
}

function App() {
  return isAuth0Configured ? <Auth0App /> : <LocalApp />
}

export default App
