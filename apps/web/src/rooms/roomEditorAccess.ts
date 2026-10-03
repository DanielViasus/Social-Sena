import type { UserRole } from '@social-sena/shared'

export const ROOM_EDITOR_ALLOWED_ROLES: readonly UserRole[] = [
  'user',
  'mage',
  'admin',
  'developer',
]

export function canAccessRoomEditor(role: UserRole) {
  return ROOM_EDITOR_ALLOWED_ROLES.includes(role)
}
