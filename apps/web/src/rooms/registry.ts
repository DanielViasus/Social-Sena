import { getDefaultRoomTemplate, getRoomTemplateByRoute, type RoomTemplate } from '@social-sena/shared'
import CenterRoom from './templates/CenterRoom'
import MazmorraDemo from './templates/mazmorra_demo'
import Room_1909 from './templates/Room_1909'
import Tavern from './templates/Tavern'

const webRoomTemplates = [Tavern, Room_1909, CenterRoom, MazmorraDemo]

const roomTemplateByRoute = new Map(
  webRoomTemplates.map((template) => [template.routeSegment.toLowerCase(), template]),
)

export function resolveRoomTemplateFromPath(pathname: string): RoomTemplate {
  const firstSegment = pathname.split('/').filter(Boolean)[0]?.toLowerCase()

  if (!firstSegment) {
    return getDefaultRoomTemplate()
  }

  return getRoomTemplateByRoute(firstSegment)
    ?? roomTemplateByRoute.get(firstSegment)
    ?? getDefaultRoomTemplate()
}

export const availableRoomRoutes = webRoomTemplates.map((template) => `/${template.routeSegment}`)
