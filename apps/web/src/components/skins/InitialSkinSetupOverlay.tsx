import { useEffect, useMemo, useState } from 'react'
import {
  resolveAvatarSheetUrl,
  type AvatarColorSelections,
  type AvatarPreset,
  type AvatarTextureDefinition,
} from '../../game/avatar/avatarSprites'

interface InitialSkinSetupOverlayProps {
  presets: AvatarPreset[]
  selectedSkinId: string
  selectedSkinColors: AvatarColorSelections
  isSubmitting: boolean
  onSelectSkin: (skinId: string) => void
  onApply: () => void
}

function SkinSpritePreview({
  preset,
  frame,
  sheetUrl,
  size,
}: {
  preset: AvatarPreset
  frame: AvatarTextureDefinition
  sheetUrl: string
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
        src={sheetUrl}
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

export default function InitialSkinSetupOverlay({
  presets,
  selectedSkinId,
  selectedSkinColors,
  isSubmitting,
  onSelectSkin,
  onApply,
}: InitialSkinSetupOverlayProps) {
  const [previewFrameIndex, setPreviewFrameIndex] = useState(0)
  const selectedPreset = presets.find((preset) => preset.id === selectedSkinId) ?? presets[0]

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      setPreviewFrameIndex((currentValue) => (currentValue + 1) % 4)
    }, 220)

    return () => window.clearInterval(intervalId)
  }, [])

  const previewFrame =
    selectedPreset?.idleFrames[previewFrameIndex % selectedPreset.idleFrames.length] ?? selectedPreset?.idleFrames[0]
  const previewSheetUrl = useMemo(
    () => (selectedPreset ? resolveAvatarSheetUrl(selectedPreset, selectedSkinColors) : ''),
    [selectedPreset, selectedSkinColors],
  )

  return (
    <div className="skin-editor-overlay" role="dialog" aria-modal="true" aria-label="Seleccion inicial de skin">
      <div className="skin-editor-backdrop" />
      <section className="initial-skin-panel">
        <div className="initial-skin-copy">
          <p className="login-kicker">Registro inicial</p>
          <h2>Selecciona tu primera skin</h2>
          <p>Antes de entrar al lobby, elige la apariencia base de tu personaje.</p>
        </div>

        <div className="initial-skin-grid">
          <div className="initial-skin-options" role="list" aria-label="Skins disponibles">
            {presets.map((preset) => {
              const frame = preset.idleFrames[0]
              const optionSheetUrl = resolveAvatarSheetUrl(preset, null)
              const isSelected = preset.id === selectedPreset?.id

              return (
                <button
                  key={preset.id}
                  type="button"
                  className={`initial-skin-option ${isSelected ? 'is-selected' : ''}`}
                  onClick={() => onSelectSkin(preset.id)}
                  aria-pressed={isSelected}
                >
                  <SkinSpritePreview preset={preset} frame={frame} sheetUrl={optionSheetUrl} size={128} />
                  <span>{preset.label}</span>
                </button>
              )
            })}
          </div>

          <div className="initial-skin-preview">
            <h3>{selectedPreset?.label ?? 'Skin'}</h3>
            <div className="initial-skin-preview-stage">
              {selectedPreset && previewFrame ? (
                <SkinSpritePreview preset={selectedPreset} frame={previewFrame} sheetUrl={previewSheetUrl} size={240} />
              ) : (
                <div className="skin-editor-preview-empty" />
              )}
            </div>
            <button type="button" className="skin-editor-apply" onClick={onApply} disabled={isSubmitting}>
              {isSubmitting ? 'guardando...' : 'continuar'}
            </button>
          </div>
        </div>
      </section>
    </div>
  )
}
