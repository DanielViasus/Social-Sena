import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { Auth0Provider, type AppState } from '@auth0/auth0-react'
import './index.css'
import App from './App'
import { auth0Config, getAuth0RedirectUri, isAuth0Configured } from './auth/auth0Config'

function handleAuth0Redirect(appState?: AppState) {
  const nextPath =
    typeof appState?.returnTo === 'string' && appState.returnTo.length > 0
      ? appState.returnTo
      : window.location.pathname

  window.history.replaceState({}, '', nextPath)
  window.dispatchEvent(new PopStateEvent('popstate'))
}

const app = (
  <StrictMode>
    <App />
  </StrictMode>
)

createRoot(document.getElementById('root')!).render(
  isAuth0Configured ? (
    <Auth0Provider
      domain={auth0Config.domain}
      clientId={auth0Config.clientId}
      onRedirectCallback={handleAuth0Redirect}
      authorizationParams={{
        redirect_uri: getAuth0RedirectUri(),
      }}
    >
      {app}
    </Auth0Provider>
  ) : (
    app
  ),
)
