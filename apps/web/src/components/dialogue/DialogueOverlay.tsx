import { useEffect, useState } from 'react'
import type { DialogueDefinition } from '../../dialogue/registry'

interface DialogueOverlayProps {
  dialogue: DialogueDefinition
  lineIndex: number
  pointerAdvanceEnabled?: boolean
  onAdvance?: () => void
}

function clampIndex(index: number, max: number) {
  return Math.min(Math.max(index, 0), Math.max(0, max - 1))
}

export default function DialogueOverlay({
  dialogue,
  lineIndex,
  pointerAdvanceEnabled = false,
  onAdvance,
}: DialogueOverlayProps) {
  const [now, setNow] = useState(() => performance.now())

  useEffect(() => {
    let frameId = 0

    const tick = (nextNow: number) => {
      setNow(nextNow)
      frameId = window.requestAnimationFrame(tick)
    }

    frameId = window.requestAnimationFrame(tick)
    return () => window.cancelAnimationFrame(frameId)
  }, [])

  const safeLineIndex = clampIndex(lineIndex, dialogue.lines.length)
  const currentLine = dialogue.lines[safeLineIndex] ?? ''
  const promptFrames = dialogue.promptFrames ?? []
  const promptFrameDurationMs = Math.max(120, dialogue.promptFrameDurationMs ?? 320)
  const promptWidth = dialogue.promptWidth ?? 128
  const promptHeight = dialogue.promptHeight ?? 128
  const promptFrame = promptFrames.length > 0
    ? promptFrames[Math.floor(now / promptFrameDurationMs) % promptFrames.length]
    : null

  return (
    <div className="dialogue-overlay" aria-live="polite" aria-modal="true" role="dialog">
      <div className="dialogue-letterbox dialogue-letterbox-top" />
      <div
        className={`dialogue-letterbox dialogue-letterbox-bottom ${pointerAdvanceEnabled ? 'is-clickable' : ''}`}
        onClick={pointerAdvanceEnabled ? onAdvance : undefined}
      >
        <div className="dialogue-panel-content">
          <p className="dialogue-panel-text">{currentLine}</p>
          {promptFrame ? (
            <img
              src={promptFrame.url}
              alt="Avanzar dialogo con tecla E"
              className="dialogue-panel-prompt"
              draggable={false}
              style={{ width: `${promptWidth}px`, height: `${promptHeight}px` }}
            />
          ) : (
            <div
              className="dialogue-panel-prompt dialogue-panel-prompt-fallback"
              style={{
                width: `${promptWidth}px`,
                height: `${promptHeight}px`,
                background: dialogue.promptFallbackColor ?? '#6e738f',
              }}
            />
          )}
        </div>
      </div>
    </div>
  )
}
