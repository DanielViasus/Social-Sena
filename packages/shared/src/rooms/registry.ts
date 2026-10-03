import { centerRoomTemplate } from './templates/CenterRoom'
import { mazmorraDemoTemplate } from './templates/MazmorraDemo'
import { room1909Template } from './templates/Room_1909'
import { tavernTemplate } from './templates/Tavern'
import type { RoomTemplate } from './types'

export const roomTemplates: RoomTemplate[] = [tavernTemplate, room1909Template, centerRoomTemplate, mazmorraDemoTemplate]

const roomTemplateMap = new Map(roomTemplates.map((template) => [template.id, template]))
const roomTemplateRouteMap = new Map(roomTemplates.map((template) => [template.routeSegment.toLowerCase(), template]))

export function registerRoomTemplate(template: RoomTemplate) {
  roomTemplateMap.set(template.id, template)
  roomTemplateRouteMap.set(template.routeSegment.toLowerCase(), template)
}

export function unregisterRoomTemplate(templateId: string) {
  const template = roomTemplateMap.get(templateId)
  if (!template) return

  roomTemplateMap.delete(templateId)
  const routeKey = template.routeSegment.toLowerCase()
  if (roomTemplateRouteMap.get(routeKey)?.id === templateId) {
    roomTemplateRouteMap.delete(routeKey)
  }
}

export function getRoomTemplateById(templateId: string): RoomTemplate | undefined {
  return roomTemplateMap.get(templateId)
}

export function getRoomTemplateByRoute(routeSegment: string): RoomTemplate | undefined {
  return roomTemplateRouteMap.get(routeSegment.toLowerCase())
}

export function getDefaultRoomTemplate(): RoomTemplate {
  return tavernTemplate
}
