import { centerRoomTemplate } from './templates/CenterRoom'
import { mazmorraDemoTemplate } from './templates/MazmorraDemo'
import { room1909Template } from './templates/Room_1909'
import type { RoomTemplate } from './types'

export const roomTemplates: RoomTemplate[] = [room1909Template, centerRoomTemplate, mazmorraDemoTemplate]

const roomTemplateMap = new Map(roomTemplates.map((template) => [template.id, template]))

export function getRoomTemplateById(templateId: string): RoomTemplate | undefined {
  return roomTemplateMap.get(templateId)
}

export function getDefaultRoomTemplate(): RoomTemplate {
  return room1909Template
}
