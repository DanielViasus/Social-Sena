import { useEffect, useState } from 'react'
import type { SkinColorSelections } from '@social-sena/shared'
import {
  normalizeAvatarColorSelections,
  resolveAvatarPreset,
  resolveAvatarSheetUrl,
} from '../game/avatar/avatarSprites'

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

export default function SceneLoadingOverlay({ visible, skinId, skinColors }: SceneLoadingOverlayProps) {
  const [loadingFrame, setLoadingFrame] = useState(0)
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

  if (!shouldRender) {
    return null
  }

  return (
    <div
      className={`scene-loading-overlay ${visible ? 'is-visible' : 'is-hiding'}`}
      role="status"
      aria-live="polite"
      aria-label="Conectando a servidores"
    >
      <div className="scene-loading-panel">
        <div className="scene-loading-avatar-shell" aria-hidden="true">
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

        <p className="scene-loading-copy">
          {LOADING_COPY_FRAMES[loadingFrame % LOADING_COPY_FRAMES.length]}
        </p>
      </div>
    </div>
  )
}
