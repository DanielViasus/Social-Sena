import { useRef, useState } from 'react'

import { getScrubbedValue } from '../game/avatar/axisScrubbing'

interface NumericAxisScrubberProps {
  axis: string
  label: string
  value: number
  min?: number
  max?: number
  onStart: () => void
  onPreview: (value: number) => void
  onCommit: (value: number) => void
  onCancel: () => void
}

export default function NumericAxisScrubber({ axis, label, value, min = -Infinity, max = Infinity, onStart, onPreview, onCommit, onCancel }: NumericAxisScrubberProps) {
  const drag = useRef<{ pointerId: number; startX: number; startValue: number; value: number } | null>(null)
  const [dragging, setDragging] = useState(false)
  const clamp = (next: number) => Math.min(max, Math.max(min, next))

  const cancel = () => {
    if (!drag.current) return
    drag.current = null
    setDragging(false)
    onCancel()
  }

  return (
    <span
      className={`edit-room-axis-scrubber${dragging ? ' is-scrubbing' : ''}`}
      role="slider"
      tabIndex={0}
      aria-label={`Ajustar ${label}`}
      aria-valuenow={value}
      aria-valuemin={Number.isFinite(min) ? min : undefined}
      aria-valuemax={Number.isFinite(max) ? max : undefined}
      aria-orientation="horizontal"
      title="Arrastra: derecha aumenta, izquierda disminuye. Escape cancela."
      onClick={(event) => event.preventDefault()}
      onPointerDown={(event) => {
        if (event.button !== 0 || !event.isPrimary) return
        event.preventDefault()
        event.stopPropagation()
        event.currentTarget.focus()
        event.currentTarget.setPointerCapture(event.pointerId)
        drag.current = { pointerId: event.pointerId, startX: event.clientX, startValue: value, value }
        setDragging(true)
        onStart()
      }}
      onPointerMove={(event) => {
        const current = drag.current
        if (!current || current.pointerId !== event.pointerId) return
        event.preventDefault()
        current.value = clamp(getScrubbedValue(current.startValue, current.startX, event.clientX))
        onPreview(current.value)
      }}
      onPointerUp={(event) => {
        const current = drag.current
        if (!current || current.pointerId !== event.pointerId) return
        event.preventDefault()
        drag.current = null
        setDragging(false)
        event.currentTarget.releasePointerCapture(event.pointerId)
        onCommit(current.value)
      }}
      onPointerCancel={cancel}
      onLostPointerCapture={cancel}
      onKeyDown={(event) => {
        if (event.key === 'Escape' && drag.current) {
          event.preventDefault()
          event.stopPropagation()
          cancel()
        } else if (['ArrowLeft', 'ArrowRight'].includes(event.key) && !event.ctrlKey && !event.metaKey && !event.altKey) {
          event.preventDefault()
          event.stopPropagation()
          onCommit(clamp(value + (event.key === 'ArrowRight' ? 1 : -1)))
        }
      }}
    >{axis}</span>
  )
}
