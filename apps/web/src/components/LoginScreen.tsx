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
        <p className="login-copy">
          Vamos a arrancar con un login simple por nombre, pero la estructura ya queda lista para migrar a Auth0.
        </p>
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
          <input
            id="display-name"
            value={displayName}
            onChange={(event) => setDisplayName(event.target.value)}
            placeholder="Escribe tu nombre"
            autoComplete="nickname"
            maxLength={32}
          />
          <button type="submit">Ingresar al lobby</button>
        </form>
        <div className="login-notes">
          <span>Ruta inicial: `/Room_1909`</span>
          <span>{auth0Ready ? 'Auth0 configurado para integracion futura' : 'Auth0 pendiente de credenciales'}</span>
        </div>
      </section>
    </main>
  )
}

export default LoginScreen
