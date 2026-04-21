export const auth0Config = {
  domain: import.meta.env.VITE_AUTH0_DOMAIN,
  clientId: import.meta.env.VITE_AUTH0_CLIENT_ID,
  callbackPath: import.meta.env.VITE_AUTH0_CALLBACK_URL ?? '/',
}

export const isAuth0Configured = Boolean(auth0Config.domain && auth0Config.clientId)

export function getAuth0RedirectUri() {
  return new URL(auth0Config.callbackPath, window.location.origin).toString()
}

export function resolvePostLoginRoute(pathname: string) {
  return pathname === '/' ? '/Room_1909' : pathname
}
