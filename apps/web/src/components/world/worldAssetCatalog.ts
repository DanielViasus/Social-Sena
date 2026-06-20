import type { RoomTemplate } from '@social-sena/shared'
import bkGarden from '../../assets/Places/bk_garden.svg?url&no-inline'
import bkCenterRoom from '../../assets/Places/bk_centerRoom.svg?url&no-inline'
import mazmorraDemo from '../../assets/Places/mazmorra_demo.svg?url&no-inline'
import plazaSeparator1 from '../../assets/Decoration/Plaza/Separador_Plaza_1.svg'
import plazaSeparator2 from '../../assets/Decoration/Plaza/Separador_Plaza_2.svg'
import plazaSeparator3 from '../../assets/Decoration/Plaza/Separador_Plaza_3.svg'
import plazaSeparator4 from '../../assets/Decoration/Plaza/Separador_Plaza_4.svg'
import plazaSeparator5 from '../../assets/Decoration/Plaza/Separador_Plaza_5.svg'
import plazaSeparator6 from '../../assets/Decoration/Plaza/Separador_Plaza_6.svg'
import tpCenterRoom1 from '../../assets/Decoration/Doors_tp/tp_center_room_1.svg'
import tpCenterRoom1Hover from '../../assets/Decoration/Doors_tp/tp_center_room_1_hover.svg'
import tpRoom1909_1 from '../../assets/Decoration/Doors_tp/tp_room_1909_1.svg'
import tpRoom1909_1Hover from '../../assets/Decoration/Doors_tp/tp_room_1909_1_hover.svg'
import mageSheet from '../../assets/npc/mago/Mage.svg'
import npcAlert0 from '../../assets/npc/icons/alert/ALERT_0.svg'
import npcAlert1 from '../../assets/npc/icons/alert/ALERT_1.svg'
import npcAlert2 from '../../assets/npc/icons/alert/ALERT_2.svg'
import npcAlert3 from '../../assets/npc/icons/alert/ALERT_3.svg'
import npcInteractionE0 from '../../assets/npc/icons/interaction/INTERACTION_E_0.svg'
import npcInteractionE1 from '../../assets/npc/icons/interaction/INTERACTION_E_1.svg'

export const WORLD_BACKGROUND_BY_TEMPLATE_ID: Record<string, string> = {
  Room_1909: bkGarden,
  CenterRoom: bkCenterRoom,
  mazmorra_demo: mazmorraDemo,
}

export const WORLD_SPRITES: Record<string, string> = {
  'plaza-separator-1': plazaSeparator1,
  'plaza-separator-2': plazaSeparator2,
  'plaza-separator-3': plazaSeparator3,
  'plaza-separator-4': plazaSeparator4,
  'plaza-separator-5': plazaSeparator5,
  'plaza-separator-6': plazaSeparator6,
  'tp-center-room-1': tpCenterRoom1,
  'tp-center-room-1-hover': tpCenterRoom1Hover,
  'tp-room-1909-1': tpRoom1909_1,
  'tp-room-1909-1-hover': tpRoom1909_1Hover,
}

export const NPC_SPRITES: Record<string, string> = {
  'npc-mage-sheet': mageSheet,
  'npc-alert-0': npcAlert0,
  'npc-alert-1': npcAlert1,
  'npc-alert-2': npcAlert2,
  'npc-alert-3': npcAlert3,
  'npc-interaction-e-0': npcInteractionE0,
  'npc-interaction-e-1': npcInteractionE1,
}

const imagePreloadCache = new Map<string, Promise<void>>()
const IMAGE_PRELOAD_TIMEOUT_MS = 2500

export function getRoomBackgroundAsset(templateId: string) {
  return WORLD_BACKGROUND_BY_TEMPLATE_ID[templateId]
}

export function getWorldSpriteAsset(assetId?: string) {
  return assetId ? WORLD_SPRITES[assetId] : undefined
}

export function getNpcSpriteAsset(assetId?: string) {
  return assetId ? NPC_SPRITES[assetId] : undefined
}

export function preloadImageAsset(src: string | null | undefined) {
  if (!src) {
    return Promise.resolve()
  }

  const cachedPromise = imagePreloadCache.get(src)
  if (cachedPromise) {
    return cachedPromise
  }

  const preloadPromise = new Promise<void>((resolve) => {
    const image = new Image()
    let settled = false
    let timeoutId: number | null = null
    const finish = () => {
      if (settled) {
        return
      }

      settled = true
      image.onload = null
      image.onerror = null
      if (timeoutId !== null) {
        window.clearTimeout(timeoutId)
      }
      resolve()
    }

    image.decoding = 'async'
    image.onload = finish
    image.onerror = finish
    image.src = src

    if (typeof window !== 'undefined') {
      timeoutId = window.setTimeout(() => {
        if (import.meta.env.DEV) {
          console.warn('[scene-loading] Timed out preloading image, continuing anyway.', src)
        }
        finish()
      }, IMAGE_PRELOAD_TIMEOUT_MS)
    }

    if (image.complete) {
      finish()
    }
  })

  imagePreloadCache.set(src, preloadPromise)
  return preloadPromise
}

function collectRoomAssetUrls(template: RoomTemplate) {
  const assetUrls = new Set<string>()
  const backgroundAsset = getRoomBackgroundAsset(template.id)

  if (backgroundAsset) {
    assetUrls.add(backgroundAsset)
  }

  template.objects.forEach((objectTemplate) => {
    const spriteSrc = getWorldSpriteAsset(objectTemplate.spriteAssetId)
    if (spriteSrc) {
      assetUrls.add(spriteSrc)
    }
  })

  ;(template.npcs ?? []).forEach((npcTemplate) => {
    ;(npcTemplate.spriteAssetIds ?? []).forEach((assetId) => {
      const spriteSrc = getNpcSpriteAsset(assetId)
      if (spriteSrc) {
        assetUrls.add(spriteSrc)
      }
    })

    const spriteSheetSrc = getNpcSpriteAsset(npcTemplate.spriteSheetAssetId)
    if (spriteSheetSrc) {
      assetUrls.add(spriteSheetSrc)
    }

    ;(npcTemplate.iconWarningAssetIds ?? []).forEach((assetId) => {
      const iconSrc = getNpcSpriteAsset(assetId)
      if (iconSrc) {
        assetUrls.add(iconSrc)
      }
    })

    ;(npcTemplate.iconInteractionAssetIds ?? []).forEach((assetId) => {
      const iconSrc = getNpcSpriteAsset(assetId)
      if (iconSrc) {
        assetUrls.add(iconSrc)
      }
    })
  })

  ;(template.teleports ?? []).forEach((teleportTemplate) => {
    const spriteSrc = getWorldSpriteAsset(teleportTemplate.spriteAssetId)
    if (spriteSrc) {
      assetUrls.add(spriteSrc)
    }

    const hoverSpriteSrc = getWorldSpriteAsset(teleportTemplate.spriteHoverAssetId)
    if (hoverSpriteSrc) {
      assetUrls.add(hoverSpriteSrc)
    }

    ;(teleportTemplate.iconWarningAssetIds ?? []).forEach((assetId) => {
      const iconSrc = getNpcSpriteAsset(assetId)
      if (iconSrc) {
        assetUrls.add(iconSrc)
      }
    })

    ;(teleportTemplate.iconInteractionAssetIds ?? []).forEach((assetId) => {
      const iconSrc = getNpcSpriteAsset(assetId)
      if (iconSrc) {
        assetUrls.add(iconSrc)
      }
    })
  })

  ;(template.enemies ?? []).forEach((enemyTemplate) => {
    const spriteSrc = getWorldSpriteAsset(enemyTemplate.spriteAssetId)
    if (spriteSrc) {
      assetUrls.add(spriteSrc)
    }
  })

  return [...assetUrls]
}

export async function preloadRoomTemplateAssets(template: RoomTemplate) {
  const assetUrls = collectRoomAssetUrls(template)
  const fontPromise =
    typeof document !== 'undefined' &&
    'fonts' in document &&
    typeof document.fonts.ready?.then === 'function'
      ? document.fonts.ready.then(() => undefined).catch(() => undefined)
      : Promise.resolve()

  await Promise.all([
    fontPromise,
    ...assetUrls.map((assetUrl) => preloadImageAsset(assetUrl)),
  ])
}
