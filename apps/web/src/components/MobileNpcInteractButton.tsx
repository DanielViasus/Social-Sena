import { useEffect, useState } from 'react'
import iconTeclaE0 from '../assets/npc/Buttons/Interactions/IconTeclaE_0.svg'
import iconTeclaE1 from '../assets/npc/Buttons/Interactions/IconTeclaE_1.svg'

interface MobileNpcInteractButtonProps {
  onInteract: () => void
}

const FRAMES = [iconTeclaE0, iconTeclaE1]
const FRAME_DURATION_MS = 280

export default function MobileNpcInteractButton({ onInteract }: MobileNpcInteractButtonProps) {
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

  const frame = FRAMES[Math.floor(now / FRAME_DURATION_MS) % FRAMES.length]

  return (
    <button
      type="button"
      className="mobile-npc-interact-button"
      onClick={onInteract}
      aria-label="Interactuar con NPC"
    >
      <img src={frame} alt="Interactuar" draggable={false} className="mobile-npc-interact-button-image" />
    </button>
  )
}
