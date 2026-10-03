import { useEffect, useState } from 'react'

const ACCESS_ROLE_PATH = '/accessrole'
const EDIT_ROOM_PATH = '/editroom'
const ROOM_EDITOR_MENU_PATH = '/editor'
const ACCESS_ROLE_RETURN_PATH_KEY = 'social-sena-access-role-return-path'

function getCurrentLocationPath() {
  return `${window.location.pathname}${window.location.search}${window.location.hash}`
}

export function isAccessRolePath(pathname: string) {
  return pathname.toLowerCase() === ACCESS_ROLE_PATH
}

export function isEditRoomPath(pathname: string) {
  return pathname.toLowerCase() === EDIT_ROOM_PATH
}

export function isRoomEditorMenuPath(pathname: string) {
  return pathname.toLowerCase() === ROOM_EDITOR_MENU_PATH
}

export function isStandalonePagePath(pathname: string) {
  return isAccessRolePath(pathname)
    || isEditRoomPath(pathname)
    || isRoomEditorMenuPath(pathname)
}

export function getAccessRoleReturnPath() {
  const requestedPath = new URLSearchParams(window.location.search).get('returnTo')
  const storedPath = window.sessionStorage.getItem(ACCESS_ROLE_RETURN_PATH_KEY)
  const candidate = requestedPath ?? storedPath ?? '/Tavern'

  if (!candidate.startsWith('/') || isAccessRolePath(candidate.split(/[?#]/, 1)[0] ?? '')) {
    return '/Tavern'
  }

  return candidate
}

export function navigateInApp(path: string) {
  window.history.pushState({}, '', path)
  window.dispatchEvent(new PopStateEvent('popstate'))
}

export function usePathname() {
  const [pathname, setPathname] = useState(() => window.location.pathname)

  useEffect(() => {
    const handlePopState = () => setPathname(window.location.pathname)
    window.addEventListener('popstate', handlePopState)
    return () => window.removeEventListener('popstate', handlePopState)
  }, [])

  useEffect(() => {
    if (!isAccessRolePath(pathname)) {
      window.sessionStorage.setItem(ACCESS_ROLE_RETURN_PATH_KEY, getCurrentLocationPath())
    }
  }, [pathname])

  return pathname
}
