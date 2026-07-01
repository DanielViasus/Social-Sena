import { useState } from 'react'
import type { FormEvent } from 'react'

import ImageLogoinPanel from "../assets/UI/Login/image_login_panel.svg"
import ImageAuthBox from "../assets/UI/Login/image_auth_box.svg"
import ImageBtnLogin from "../assets/UI/Login/image_btn_login.png"

interface LoginScreenProps {
  auth0Ready: boolean
  auth0Error?: string
  onAuth0Login?: () => void
  onAuth0ChooseAccount?: () => void
  onLogin: (displayName: string) => void
}

function LoginScreen({ auth0Ready, auth0Error, onAuth0Login, onAuth0ChooseAccount, onLogin }: LoginScreenProps) {
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
      <section className="login-panel login-panel--framed">
        <img
          src={ImageLogoinPanel}
          alt=""
          aria-hidden="true"
          draggable={false}
          className="login-panel-background"
        />

        <div className="login-panel-content">
          <p className="login-kicker pixel-font"
            style={{
              marginTop: "25px",
            }}
          >Social Sena</p>
          <h1 className="pixel-font">Ingresa al Lobby</h1>

          {auth0Ready ? (
            <div className="auth0-box auth0-box--framed"
              style={{
                marginTop: "25px",
              }}
            >
              <img
                src={ImageAuthBox}
                alt=""
                aria-hidden="true"
                draggable={false}
                className="auth0-box-background"
              />

              <div className="auth0-box-content"
                style={{
                  marginTop: "5px",
                }}
              >
                <div className="auth0-box-actions">
                  <button type="button" className="auth0-button auth0-button--primary pixel-font"

                    onClick={onAuth0Login}>
                    <img
                      src={ImageBtnLogin}
                      alt=""
                      aria-hidden="true"
                      draggable={false}
                      className="auth0-button-background"
                    />
                    <span className="auth0-button-label">Ingresar con Auth0</span>
                  </button>

                  {onAuth0ChooseAccount ? (
                    <button
                      type="button"
                      style={{
                        marginTop: "5px",
                      }}
                      className="auth0-button auth0-button--secondary pixel-font"
                      onClick={onAuth0ChooseAccount}
                    >
                      <img
                        src={ImageBtnLogin}
                        alt=""
                        aria-hidden="true"
                        draggable={false}
                        className="auth0-button-background"
                      />
                      <span className="auth0-button-label">Elegir otra cuenta</span>
                    </button>
                  ) : null}
                </div>

                <p
                  style={{
                    marginTop: "10px",
                  }}
                >Puedes usar una cuenta Gmail para loguearte.</p>
                {auth0Error ? <span className="auth0-error">{auth0Error}</span> : null}
              </div>
            </div>
          ) : null}
        </div>
      </section>
    </main>
  )
}

export default LoginScreen
