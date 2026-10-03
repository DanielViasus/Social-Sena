import { hasMinimumUserRole, type UserRole } from '@social-sena/shared'

export function canAccessRoomEditor(role: UserRole) {
  return hasMinimumUserRole(role, 'user')
}
