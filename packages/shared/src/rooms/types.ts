import type { Position } from '../types'

export type RoomObjectKind = 'wall' | 'door' | 'portal' | 'zone' | 'landmark'

export interface RoomColliderTemplate {
  offsetX: number
  offsetY: number
  width: number
  height: number
}

export interface RoomZIndexReferenceTemplate {
  offsetX: number
  offsetY: number
  width: number
  thickness?: number
}

export interface RoomInteractionAreaTemplate {
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
  label?: string
  fillColor?: number
  strokeColor?: number
  opacity?: number
  spriteAssetId?: string
  collider?: RoomColliderTemplate
  colliders?: RoomColliderTemplate[]
  zIndexRef?: RoomZIndexReferenceTemplate
}

export interface RoomNpcTemplate {
  id: string
  x: number
  y: number
  width: number
  height: number
  label?: string
  fillColor?: number
  opacity?: number
  spriteAssetIds?: string[]
  spriteFrameDurationMs?: number
  iconWarningAssetIds?: string[]
  iconInteractionAssetIds?: string[]
  iconFrameDurationMs?: number
  iconOffsetX?: number
  iconOffsetY?: number
  iconWidth?: number
  iconHeight?: number
  iconWarningFillColor?: number
  iconInteractionFillColor?: number
  collider?: RoomColliderTemplate
  zIndexRef?: RoomZIndexReferenceTemplate
  warningArea?: RoomInteractionAreaTemplate
  interactionArea?: RoomInteractionAreaTemplate
  interactionId?: string
  dialogueId?: string
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
  npcs?: RoomNpcTemplate[]
}
