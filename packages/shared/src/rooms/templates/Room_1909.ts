import type { RoomTemplate } from '../types'

export const room1909Template: RoomTemplate = {
  id: 'Room_1909',
  routeSegment: 'Room_1909',
  name: 'Lobby Garden 1909',
  chatMode: 'scene',
  world: {
    width: 2300,
    height: 2700,
    spawn: { x: 1000, y: 1600 },
    backgroundColor: 0xdfe8d2,
    gridColor: 0xffffff,
  },
  camera: {
    delayMs: 300,
    offsetX: 0,
    offsetY: -72,
    clampBorders: true,
    marginX: 200,
    marginY: 200,
  },
  objects: [
    {
      id: 'plaza-separator-nw',
      kind: 'landmark',
      x: 750,
      y: 1200,
      width: 476,
      height: 508,
      opacity: 1,
      spriteAssetId: 'plaza-separator-1',
     colliders: [
    {
      offsetX: 0,
      offsetY: -46,
      width: 474,
      height: 280,
    },
    {
      offsetX: -80,
      offsetY: 160,
      width: 318,
      height: 134,
    },
  ],
      zIndexRef: { offsetX: 0, offsetY: 97, width: 220, thickness: 2 },
    },
    {
      id: 'plaza-separator-ne',
      kind: 'landmark',
      x: 1600,
      y: 1200,
      width: 476,
      height: 508,
      opacity: 1,
      spriteAssetId: 'plaza-separator-2',
       colliders: [
    {
      offsetX: 0,
      offsetY: -46,
      width: 474,
      height: 280,
    },
    {
      offsetX: 80,
      offsetY: 160,
      width: 318,
      height: 134,
    },
  ],
      zIndexRef: { offsetX: 0, offsetY: 97, width: 220, thickness: 2 },
    },
    {
      id: 'plaza-separator-sw',
      kind: 'landmark',
      x: 750,
      y: 2050,
      width: 476,
      height: 544,
      opacity: 1,
      spriteAssetId: 'plaza-separator-3',
       colliders: [
    {
      offsetX: 0,
      offsetY: 130,
      width: 474,
      height: 280,
    },
    {
      offsetX: -80,
      offsetY: -90,
      width: 318,
      height: 164,
    },
  ],
      zIndexRef: { offsetX: 0, offsetY: 0, width: 220, thickness: 2 },
    },
    {
      id: 'plaza-separator-se',
      kind: 'landmark',
      x: 1600,
      y: 2050,
      width: 476,
      height: 544,
      opacity: 1,
      spriteAssetId: 'plaza-separator-4',
      colliders: [
    {
      offsetX: 0,
      offsetY: 130,
      width: 474,
      height: 280,
    },
    {
      offsetX: 80,
      offsetY: -90,
      width: 318,
      height: 164,
    },
  ],
      zIndexRef: { offsetX: 0, offsetY: 0, width: 220, thickness: 2 },
    },

    {
      id: 'plaza-separator-e',
      kind: 'landmark',
      x: 80,
      y: 1600,
      width: 160,
      height: 1438,
      opacity: 1,
      spriteAssetId: 'plaza-separator-5',
      colliders: [
    {
      offsetX: 0,
      offsetY: 50,
      width: 160,
      height: 1300,
    },
    
  ],
      zIndexRef: { offsetX: 0, offsetY: 0, width: 220, thickness: 2 },
    },

    {
      id: 'plaza-separator-o',
      kind: 'landmark',
      x: 2220,
      y: 1600,
      width: 160,
      height: 1438,
      opacity: 1,
      spriteAssetId: 'plaza-separator-6',
      colliders: [
    {
      offsetX: 0,
      offsetY: 50,
      width: 160,
      height: 1300,
    },
    
  ],
      zIndexRef: { offsetX: 0, offsetY: 0, width: 220, thickness: 2 },
    },

        {
      id: 'castel-Wall',
      kind: 'wall',
      x: 1350,
      y: 220,
      width: 2700,
      height: 440,
      opacity: 0,
      spriteAssetId: 'plaza',
      colliders: [
    {
      offsetX: 0,
      offsetY: 0,
      width: 2700,
      height: 440,
    },
    
  ],
      zIndexRef: { offsetX: 0, offsetY: 0, width: 220, thickness: 2 },
    },

    
    
  ],
  npcs: [],
  teleports: [
    {
      entityType: 'teleport',
      id: 'center-room-teleport',
      label: '',
      x: 1160,
      y: 440,
      width: 202,
      height: 192,
      spriteAssetId: 'tp-room-1909-1',
      spriteHoverAssetId: 'tp-room-1909-1-hover',
      fillColor: 0x936d6d,
      strokeColor: 0xd8c4c4,
      opacity: 1,
      iconFrameDurationMs: 400,
      iconWarningAssetIds: [
        'npc-alert-0',
        'npc-alert-1',
        'npc-alert-2',
        'npc-alert-3',
      ],
      iconInteractionAssetIds: [
        'npc-interaction-e-0',
        'npc-interaction-e-1',
      ],
      iconOffsetX: 0,
      iconOffsetY: -220,
      iconWidth: 96,
      iconHeight: 96,
      iconWarningFillColor: 0xe85050,
      iconInteractionFillColor: 0x6354ff,
      warningArea: {
        offsetX: 0,
        offsetY: 70,
        width: 320,
        height: 240,
      },
      interactionArea: {
        offsetX: 0,
        offsetY: 70,
        width: 240,
        height: 176,
      },
      interactionId: 'tp-center-room',
      teleportTarget: {
        templateId: 'mazmorra_demo',
        position: { x: 333, y: 604 },
      },
    },
  ],
}
