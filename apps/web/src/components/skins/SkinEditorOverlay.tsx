import { useEffect, useState } from 'react'
import type { AvatarPreset, AvatarTextureDefinition } from '../../game/avatar/avatarSprites'

interface SkinEditorOverlayProps {
  presets: AvatarPreset[]
  selectedSkinId: string
  appliedSkinId: string
  onSelectSkin: (skinId: string) => void
  onApply: () => void
  onClose: () => void
}

function SkinSpritePreview({
  preset,
  frame,
  size,
}: {
  preset: AvatarPreset
  frame: AvatarTextureDefinition
  size: number
}) {
  const scale = size / preset.frameWidth

  return (
    <div
      className="skin-preview-sprite"
      style={{
        width: `${size}px`,
        height: `${size}px`,
      }}
    >
      <img
        src={preset.sheetUrl}
        alt={preset.label}
        draggable={false}
        className="skin-preview-spritesheet"
        style={{
          width: `${preset.sheetWidth * scale}px`,
          height: `${preset.sheetHeight * scale}px`,
          left: `${-frame.column * preset.frameWidth * scale}px`,
          top: `${-frame.row * preset.frameHeight * scale}px`,
        }}
      />
    </div>
  )
}

export default function SkinEditorOverlay({
  presets,
  selectedSkinId,
  appliedSkinId,
  onSelectSkin,
  onApply,
  onClose,
}: SkinEditorOverlayProps) {
  const [previewFrameIndex, setPreviewFrameIndex] = useState(0)
  const selectedPreset =
    presets.find((preset) => preset.id === selectedSkinId) ??
    presets.find((preset) => preset.id === appliedSkinId) ??
    presets[0]

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      setPreviewFrameIndex((currentValue) => (currentValue + 1) % 4)
    }, 220)

    return () => window.clearInterval(intervalId)
  }, [])

  const previewFrame =
    selectedPreset?.idleFrames[previewFrameIndex % selectedPreset.idleFrames.length] ??
    selectedPreset?.idleFrames[0]

  return (
    <div className="skin-editor-overlay" role="dialog" aria-modal="true" aria-label="Editor de skins">
      <div className="skin-editor-backdrop" onClick={onClose} />
      <section className="skin-editor-panel">
        <button type="button" className="skin-editor-close" onClick={onClose} aria-label="Cerrar editor de skins">
          X
        </button>

        <div className="skin-editor-grid">
          <div className="skin-editor-sidebar">
            <h2>SKINS</h2>
            <div className="skin-editor-options">
              {presets.map((preset) => {
                const frame = preset.idleFrames[0]
                const isSelected = preset.id === selectedSkinId
                const isApplied = preset.id === appliedSkinId

                return (
                  <button
                    key={preset.id}
                    type="button"
                    className={`skin-editor-option ${isSelected ? 'is-selected' : ''} ${isApplied ? 'is-applied' : ''}`}
                    onClick={() => onSelectSkin(preset.id)}
                    aria-pressed={isSelected}
                  >
                    <SkinSpritePreview preset={preset} frame={frame} size={112} />
                  </button>
                )
              })}
            </div>
          </div>

          <div className="skin-editor-preview">
            <h3>{selectedPreset?.label ?? 'Skin'}</h3>
            <div className="skin-editor-preview-stage">
              {selectedPreset && previewFrame ? (
                <SkinSpritePreview preset={selectedPreset} frame={previewFrame} size={256} />
              ) : (
                <div className="skin-editor-preview-empty" />
              )}
            </div>
            <button type="button" className="skin-editor-apply" onClick={onApply}>
              aplicar
            </button>
          </div>
        </div>
      </section>
    </div>
  )
}
