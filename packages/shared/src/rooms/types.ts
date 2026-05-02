import type { Position } from '../types'

export type RoomObjectKind = 'wall' | 'door' | 'portal' | 'zone' | 'landmark'

export interface RoomColliderTemplate {
  offsetX: number
  offsetY: number
  width: number
  height: number
}

export interface RoomObjectTemplate {
  id: string
  kind: RoomObjectKind
  x: number
  y: number
  width: number
  height: number
  blocksMovement: boolean
  label?: string
  fillColor?: number
  strokeColor?: number
  opacity?: number
  collider?: RoomColliderTemplate
  depthOffsetY?: number
}

export interface RoomCameraTemplate {
  delayMs: number
  offsetX: number
  offsetY: number
  clampBorders: boolean
  marginX: number
  marginY: number
}

export interface RoomWorldTemplate {
  width: number
  height: number
  spawn: Position
  backgroundColor: number
  gridColor: number
}

export interface RoomTemplate {
  id: string
  routeSegment: string
  name: string
  chatMode: 'scene'
  world: RoomWorldTemplate
  camera: RoomCameraTemplate
  objects: RoomObjectTemplate[]
}
