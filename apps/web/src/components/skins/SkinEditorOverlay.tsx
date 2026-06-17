import { useEffect, useMemo, useState } from 'react'
import {
  resolveAvatarSheetUrl,
  type AvatarColorSelections,
  type AvatarPreset,
  type AvatarTextureDefinition,
} from '../../game/avatar/avatarSprites'

interface SkinEditorOverlayProps {
  presets: AvatarPreset[]
  selectedSkinId: string
  appliedSkinId: string
  selectedSkinColors: AvatarColorSelections
  onTabChange?: (tab: 'skins' | 'colors') => void
  onSelectSkin: (skinId: string) => void
  onSelectColor: (slotId: string, optionId: string) => void
  onApply: () => void
  onClose: () => void
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

export default function SkinEditorOverlay({
  presets,
  selectedSkinId,
  appliedSkinId,
  selectedSkinColors,
  onTabChange,
  onSelectSkin,
  onSelectColor,
  onApply,
  onClose,
}: SkinEditorOverlayProps) {
  const [previewFrameIndex, setPreviewFrameIndex] = useState(0)
  const [activeTab, setActiveTab] = useState<'skins' | 'colors'>('skins')
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
  const previewSheetUrl = useMemo(
    () => (selectedPreset ? resolveAvatarSheetUrl(selectedPreset, selectedSkinColors) : ''),
    [selectedPreset, selectedSkinColors],
  )
  const selectedPrimarySubtitle = useMemo(
    () => {
      const primarySlot = selectedPreset?.colorSlots.find((slot) => slot.id === 'fur') ?? selectedPreset?.colorSlots[0]
      if (!primarySlot) {
        return ''
      }

      const option =
        primarySlot.options.find((currentOption) => currentOption.id === selectedSkinColors[primarySlot.id]) ??
        primarySlot.options.find((currentOption) => currentOption.id === primarySlot.defaultOptionId) ??
        primarySlot.options[0]

      return option?.subtitle ?? option?.label ?? ''
    },
    [selectedPreset, selectedSkinColors],
  )

  const handleTabChange = (nextTab: 'skins' | 'colors') => {
    if (nextTab === activeTab) {
      return
    }

    onTabChange?.(nextTab)
    setActiveTab(nextTab)
  }

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
            <div className="skin-editor-tabs" role="tablist" aria-label="Editor de apariencia">
              <button
                type="button"
                className={`skin-editor-tab ${activeTab === 'skins' ? 'is-active' : ''}`}
                onClick={() => handleTabChange('skins')}
                role="tab"
                aria-selected={activeTab === 'skins'}
              >
                skins
              </button>
              <button
                type="button"
                className={`skin-editor-tab ${activeTab === 'colors' ? 'is-active' : ''}`}
                onClick={() => handleTabChange('colors')}
                role="tab"
                aria-selected={activeTab === 'colors'}
              >
                colores
              </button>
            </div>

            {activeTab === 'skins' ? (
              <div className="skin-editor-options">
                {presets.map((preset) => {
                  const frame = preset.idleFrames[0]
                  const isSelected = preset.id === selectedSkinId
                  const isApplied = preset.id === appliedSkinId
                  const optionSheetUrl = resolveAvatarSheetUrl(preset, selectedPreset?.id === preset.id ? selectedSkinColors : undefined)

                  return (
                    <button
                      key={preset.id}
                      type="button"
                      className={`skin-editor-option ${isSelected ? 'is-selected' : ''} ${isApplied ? 'is-applied' : ''}`}
                      onClick={() => onSelectSkin(preset.id)}
                      aria-pressed={isSelected}
                    >
                      <SkinSpritePreview preset={preset} frame={frame} sheetUrl={optionSheetUrl} size={96} />
                      <span className="skin-editor-option-label">{preset.label}</span>
                    </button>
                  )
                })}
              </div>
            ) : (
              <div className="skin-editor-color-groups">
                {selectedPreset?.colorSlots.length ? (
                  selectedPreset.colorSlots.map((slot) => (
                    <section key={slot.id} className="skin-editor-color-group">
                      <header>
                        <h4>{slot.label}</h4>
                      </header>
                      <div className="skin-editor-color-options">
                        {slot.options.map((option) => {
                          const isSelected = selectedSkinColors[slot.id] === option.id
                          return (
                            <button
                              key={option.id}
                              type="button"
                              className={`skin-editor-color-option ${isSelected ? 'is-selected' : ''}`}
                              onClick={() => onSelectColor(slot.id, option.id)}
                              aria-pressed={isSelected}
                              aria-label={`${slot.label}: ${option.subtitle}`}
                              title={`${slot.label}: ${option.subtitle}`}
                            >
                              <span className="skin-editor-color-swatch" style={{ background: option.swatch }} />
                            </button>
                          )
                        })}
                      </div>
                    </section>
                  ))
                ) : (
                  <div className="skin-editor-color-empty">Esta skin aun no tiene variantes de color.</div>
                )}
              </div>
            )}
          </div>

          <div className="skin-editor-preview">
            <div className="skin-editor-preview-copy">
              <h3>{selectedPreset?.label ?? 'Skin'}</h3>
              {selectedPrimarySubtitle ? (
                <p className="skin-editor-preview-subtitle" aria-label="Paleta principal seleccionada">
                  {selectedPrimarySubtitle}
                </p>
              ) : null}
            </div>
            <div className="skin-editor-preview-stage">
              {selectedPreset && previewFrame ? (
                <SkinSpritePreview preset={selectedPreset} frame={previewFrame} sheetUrl={previewSheetUrl} size={256} />
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
