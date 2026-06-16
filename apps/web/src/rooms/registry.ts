import { getDefaultRoomTemplate, type RoomTemplate } from '@social-sena/shared'
import CenterRoom from './templates/CenterRoom'
import Room_1909 from './templates/Room_1909'

const webRoomTemplates = [Room_1909, CenterRoom]

const roomTemplateByRoute = new Map(
  webRoomTemplates.map((template) => [template.routeSegment.toLowerCase(), template]),
)

export function resolveRoomTemplateFromPath(pathname: string): RoomTemplate {
  const firstSegment = pathname.split('/').filter(Boolean)[0]?.toLowerCase()

  if (!firstSegment) {
    return getDefaultRoomTemplate()
  }

  return roomTemplateByRoute.get(firstSegment) ?? getDefaultRoomTemplate()
}

export const availableRoomRoutes = webRoomTemplates.map((template) => `/${template.routeSegment}`)
