import type { Position } from '../types'

export type RoomObjectKind = 'wall' | 'floor' | 'door' | 'portal' | 'zone' | 'landmark'

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

export type RoomTeleportTargetTemplate =
  | {
      templateId: string
      position?: Position
      routePath?: never
    }
  | {
      routePath: string
      templateId?: never
      position?: Position
    }

export interface RoomSpriteFrameTemplate {
  key: string
  row: number
  column: number
}

export type RoomMerchantCategory =
  | 'weapons'
  | 'potions'
  | 'food'
  | 'extras'
  | 'armor'
  | 'designs'

export type RoomMerchantType = 'shop' | 'merchant' | 'barter'

export interface RoomMerchantConfig {
  type: RoomMerchantType
  categories: [RoomMerchantCategory, ...RoomMerchantCategory[]]
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
  flippedX?: boolean
  layerOrder?: number
  gridFootprint?: {
    columns: number
    rows: number
  }
  collider?: RoomColliderTemplate
  colliders?: RoomColliderTemplate[]
  zIndexRef?: RoomZIndexReferenceTemplate
  warningArea?: RoomInteractionAreaTemplate
  interactionArea?: RoomInteractionAreaTemplate
  interactionIconContainer?: RoomInteractionAreaTemplate
  interactionState?: 0 | 1
  interactionVariants?: RoomObjectInteractionVariantTemplate[]
}

export interface RoomObjectInteractionVariantTemplate {
  state: 0 | 1
  x: number
  y: number
  width: number
  height: number
  spriteAssetId?: string
  gridFootprint?: {
    columns: number
    rows: number
  }
  collider?: RoomColliderTemplate
  colliders?: RoomColliderTemplate[]
  zIndexRef?: RoomZIndexReferenceTemplate
  warningArea?: RoomInteractionAreaTemplate
  interactionArea?: RoomInteractionAreaTemplate
  interactionIconContainer?: RoomInteractionAreaTemplate
}

export interface RoomNpcTemplate extends RoomInteractableBaseTemplate {
  entityType: 'npc'
  merchant?: RoomMerchantConfig
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
  spriteSheetAssetId?: string
  spriteSheetWidth?: number
  spriteSheetHeight?: number
  spriteFrameWidth?: number
  spriteFrameHeight?: number
  spriteFrames?: RoomSpriteFrameTemplate[]
  spriteFrameDurationMs?: number
  iconAssetId?: string
  iconOffsetX?: number
  iconOffsetY?: number
  iconWidth?: number
  iconHeight?: number
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
  entrySpawns?: RoomEntrySpawnTemplate[]
  backgroundColor: number
  gridColor: number
}

export interface RoomEntrySpawnTemplate {
  id: string
  position: Position
  sourcePaths: string[]
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
