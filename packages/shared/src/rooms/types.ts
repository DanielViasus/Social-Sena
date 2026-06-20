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

export interface RoomTeleportTargetTemplate {
  templateId: string
  position?: Position
}

export interface RoomSpriteFrameTemplate {
  key: string
  row: number
  column: number
}

export interface RoomInteractableBaseTemplate {
  id: string
  x: number
  y: number
  width: number
  height: number
  label?: string
  fillColor?: number
  opacity?: number
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

export interface RoomNpcTemplate extends RoomInteractableBaseTemplate {
  entityType: 'npc'
  interactionMode?: 'manual' | 'touch'
  showInteractionIcon?: boolean
  patrolArea?: RoomInteractionAreaTemplate
  patrolSpeedPxPerSecond?: number
  spriteAssetIds?: string[]
  spriteSheetAssetId?: string
  spriteSheetWidth?: number
  spriteSheetHeight?: number
  spriteFrameWidth?: number
  spriteFrameHeight?: number
  spriteFrames?: RoomSpriteFrameTemplate[]
  spriteFrameDurationMs?: number
  dialogueId?: string
  teleportTarget?: RoomTeleportTargetTemplate
}

export interface RoomTeleportTemplate extends RoomInteractableBaseTemplate {
  entityType: 'teleport'
  fillColor?: number
  strokeColor?: number
  spriteAssetId?: string
  spriteHoverAssetId?: string
  teleportTarget: RoomTeleportTargetTemplate
}

export interface RoomEnemyTemplate {
  entityType: 'enemy'
  id: string
  label?: string
  posicion_relativa_X: number
  posicion_relativa_Y: number
  ancho_de_patrullaje_: number
  alto_de_patrullaje_: number
  velocidad_de_patrullaje_?: number
  nivel_enemigo_?: number
  ancho_area_interaccion_directa_?: number
  alto_area_interaccion_directa_?: number
  spriteAssetId?: string
}

export type RoomEnemyMode = 'patrol' | 'chase'

export interface RoomEnemyState {
  enemyId: string
  x: number
  y: number
  mode: RoomEnemyMode
  targetUserId: string | null
}

export type RoomInteractableTemplate = RoomNpcTemplate | RoomTeleportTemplate

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
  teleports?: RoomTeleportTemplate[]
  enemies?: RoomEnemyTemplate[]
}
