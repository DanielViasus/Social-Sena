import type { RoomTemplate } from '@social-sena/shared'
import bkGarden from '../../assets/Places/bk_garden.svg'
import plazaSeparator1 from '../../assets/Decoration/Plaza/Separador_Plaza_1.svg'
import plazaSeparator2 from '../../assets/Decoration/Plaza/Separador_Plaza_2.svg'
import plazaSeparator3 from '../../assets/Decoration/Plaza/Separador_Plaza_3.svg'
import plazaSeparator4 from '../../assets/Decoration/Plaza/Separador_Plaza_4.svg'
import plazaSeparator5 from '../../assets/Decoration/Plaza/Separador_Plaza_5.svg'
import plazaSeparator6 from '../../assets/Decoration/Plaza/Separador_Plaza_6.svg'
import mageSheet from '../../assets/npc/mago/Mage.svg'
import npcAlert0 from '../../assets/npc/icons/alert/ALERT_0.svg'
import npcAlert1 from '../../assets/npc/icons/alert/ALERT_1.svg'
import npcAlert2 from '../../assets/npc/icons/alert/ALERT_2.svg'
import npcAlert3 from '../../assets/npc/icons/alert/ALERT_3.svg'
import npcInteractionE0 from '../../assets/npc/icons/interaction/INTERACTION_E_0.svg'
import npcInteractionE1 from '../../assets/npc/icons/interaction/INTERACTION_E_1.svg'

export const WORLD_BACKGROUND_BY_TEMPLATE_ID: Record<string, string> = {
  Room_1909: bkGarden,
  CenterRoom: bkGarden,
}

export const WORLD_SPRITES: Record<string, string> = {
  'plaza-separator-1': plazaSeparator1,
  'plaza-separator-2': plazaSeparator2,
  'plaza-separator-3': plazaSeparator3,
  'plaza-separator-4': plazaSeparator4,
  'plaza-separator-5': plazaSeparator5,
  'plaza-separator-6': plazaSeparator6,
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
    const finish = () => resolve()

    image.decoding = 'async'
    image.onload = finish
    image.onerror = finish
    image.src = src

    if (image.complete) {
      resolve()
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

  return [...assetUrls]
}

export async function preloadRoomTemplateAssets(template: RoomTemplate) {
  const assetUrls = collectRoomAssetUrls(template)
  const fontPromise = typeof document !== 'undefined' && 'fonts' in document
    ? document.fonts.ready.then(() => undefined).catch(() => undefined)
    : Promise.resolve()

  await Promise.all([
    fontPromise,
    ...assetUrls.map((assetUrl) => preloadImageAsset(assetUrl)),
  ])
}
