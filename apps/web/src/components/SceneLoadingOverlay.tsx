import { useEffect, useState } from 'react'
import type { SkinColorSelections } from '@social-sena/shared'
import {
  normalizeAvatarColorSelections,
  resolveAvatarPreset,
  resolveAvatarSheetUrl,
} from '../game/avatar/avatarSprites'
import skyLayerUrl from '../assets/loading/cielo_pantalla_de_carga.svg?url'
import mountainsLayerUrl from '../assets/loading/montanas_pantalla_de_carga.svg?url'
import grassLayerUrl from '../assets/loading/cesped_pantalla_de_carga.svg?url'

interface SceneLoadingOverlayProps {
  visible: boolean
  skinId: string
  skinColors: SkinColorSelections
}

const LOADING_COPY_FRAMES = [
  'Conectando a Servidores.',
  'Conectando a Servidores..',
  'Conectando a Servidores...',
] as const

const LOADING_OVERLAY_FADE_MS = 300
const LOADING_ASSET_PRELOAD_TIMEOUT_MS = 2500
const SCENE_LOADING_LAYER_DEFINITIONS = [
  { key: 'sky', src: skyLayerUrl, className: 'scene-loading-layer--sky' },
  { key: 'mountains', src: mountainsLayerUrl, className: 'scene-loading-layer--mountains' },
  { key: 'grass', src: grassLayerUrl, className: 'scene-loading-layer--grass' },
] as const

export const SCENE_LOADING_LAYER_ASSETS = SCENE_LOADING_LAYER_DEFINITIONS.map((layer) => layer.src)

function preloadLoadingImage(src: string) {
  return new Promise<void>((resolve) => {
    const image = new Image()
    let settled = false
    let timeoutId: number | null = null
    const finalize = () => {
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

    image.onload = finalize
    image.onerror = finalize
    image.src = src

    timeoutId = window.setTimeout(() => {
      if (import.meta.env.DEV) {
        console.warn('[scene-loading] Timed out preloading loading-screen asset, continuing anyway.', src)
      }
      finalize()
    }, LOADING_ASSET_PRELOAD_TIMEOUT_MS)

    if (image.complete) {
      finalize()
    }
  })
}

export default function SceneLoadingOverlay({ visible, skinId, skinColors }: SceneLoadingOverlayProps) {
  const [loadingFrame, setLoadingFrame] = useState(0)
  const [assetsReady, setAssetsReady] = useState(false)
  const [shouldRender, setShouldRender] = useState(visible)
  const preset = resolveAvatarPreset(skinId)
  const normalizedColors = normalizeAvatarColorSelections(preset, skinColors)
  const sheetUrl = resolveAvatarSheetUrl(preset, normalizedColors)
  const walkFrame = preset.walkFrames[loadingFrame % preset.walkFrames.length] ?? preset.idleFrames[0]
  const scale = 1.125

  useEffect(() => {
    if (visible) {
      setShouldRender(true)
      return
    }

    const timeoutId = window.setTimeout(() => {
      setShouldRender(false)
    }, LOADING_OVERLAY_FADE_MS)

    return () => window.clearTimeout(timeoutId)
  }, [visible])

  useEffect(() => {
    if (!visible) {
      setLoadingFrame(0)
      return
    }

    const intervalId = window.setInterval(() => {
      setLoadingFrame((currentFrame) => currentFrame + 1)
    }, 220)

    return () => window.clearInterval(intervalId)
  }, [visible])

  useEffect(() => {
    if (!visible) {
      return
    }

    let isCancelled = false
    setAssetsReady(false)

    void Promise.all([
      preloadLoadingImage(sheetUrl),
      ...SCENE_LOADING_LAYER_ASSETS.map((assetUrl) => preloadLoadingImage(assetUrl)),
    ]).then(() => {
      if (!isCancelled) {
        setAssetsReady(true)
      }
    })

    return () => {
      isCancelled = true
    }
  }, [sheetUrl, visible])

  if (!shouldRender) {
    return null
  }

  return (
    <div
      className={`scene-loading-overlay ${visible ? 'is-visible' : 'is-hiding'} ${assetsReady ? 'is-assets-ready' : 'is-assets-pending'}`}
      role="status"
      aria-live="polite"
      aria-label="Conectando a servidores"
    >
      <div className="scene-loading-panel">
        <div className="scene-loading-stage" aria-hidden="true">
          {SCENE_LOADING_LAYER_DEFINITIONS.map((layer) => (
            <div key={layer.key} className={`scene-loading-layer ${layer.className}`}>
              <div className="scene-loading-layer-track">
                <img
                  src={layer.src}
                  alt=""
                  draggable={false}
                  className="scene-loading-layer-image"
                />
                <img
                  src={layer.src}
                  alt=""
                  draggable={false}
                  className="scene-loading-layer-image"
                />
              </div>
            </div>
          ))}

          <div className="scene-loading-avatar-shell">
            <div className="scene-loading-avatar-glow" />
            <div
              className="scene-loading-avatar-frame"
              style={{
                width: `${preset.frameWidth * scale}px`,
                height: `${preset.frameHeight * scale}px`,
              }}
            >
              <img
                src={sheetUrl}
                alt=""
                draggable={false}
                className="scene-loading-avatar-sheet"
                style={{
                  width: `${preset.sheetWidth * scale}px`,
                  height: `${preset.sheetHeight * scale}px`,
                  left: `${-walkFrame.column * preset.frameWidth * scale}px`,
                  top: `${-walkFrame.row * preset.frameHeight * scale}px`,
                }}
              />
            </div>
          </div>
        </div>

        <p className="scene-loading-copy">
          {LOADING_COPY_FRAMES[loadingFrame % LOADING_COPY_FRAMES.length]}
        </p>
      </div>
    </div>
  )
}
