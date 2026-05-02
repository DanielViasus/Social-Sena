import { FormEvent, useState } from 'react'

interface LoginScreenProps {
  auth0Ready: boolean
  auth0Error?: string
  onAuth0Login?: () => void
  onLogin: (displayName: string) => void
}

function LoginScreen({ auth0Ready, auth0Error, onAuth0Login, onLogin }: LoginScreenProps) {
  const [displayName, setDisplayName] = useState('')

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const nextName = displayName.trim()
    if (!nextName) {
      return
    }

    onLogin(nextName)
  }

  return (
    <main className="login-layout">
      <section className="login-panel">
        <p className="login-kicker">Social Sena</p>
        <h1>Ingresa al Lobby</h1>
        
        {auth0Ready ? (
          <div className="auth0-box">
            <button type="button" className="auth0-button" onClick={onAuth0Login}>
              Ingresar con Auth0
            </button>
            <p>Usa tu cuenta real de Auth0 y vuelve directamente a la sala activa.</p>
            {auth0Error ? <span className="auth0-error">{auth0Error}</span> : null}
          </div>
        ) : null}
        <form className="login-form" onSubmit={handleSubmit}>
          <label className="login-label" htmlFor="display-name">
            Nombre del jugador para acceso local
          </label>
        </form>
        <div className="login-notes">
          <span>Ruta inicial: `/Room_1909`</span>
          
        </div>
      </section>
    </main>
  )
}

export default LoginScreen
