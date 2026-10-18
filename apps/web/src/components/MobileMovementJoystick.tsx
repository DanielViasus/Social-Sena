import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'

export interface MobileMovementInput {
  up: boolean
  down: boolean
  left: boolean
  right: boolean
}

interface MobileMovementJoystickProps {
  onMovementChange: (input: MobileMovementInput) => void
}

const EMPTY_MOVEMENT_INPUT: MobileMovementInput = {
  up: false,
  down: false,
  left: false,
  right: false,
}

const DEAD_ZONE_RATIO = 0.18
const DIRECTION_THRESHOLD = 0.38

function areInputsEqual(left: MobileMovementInput, right: MobileMovementInput) {
  return left.up === right.up && left.down === right.down && left.left === right.left && left.right === right.right
}

export default function MobileMovementJoystick({ onMovementChange }: MobileMovementJoystickProps) {
  const baseRef = useRef<HTMLDivElement | null>(null)
  const knobRef = useRef<HTMLDivElement | null>(null)
  const activePointerIdRef = useRef<number | null>(null)
  const latestMovementRef = useRef<MobileMovementInput>(EMPTY_MOVEMENT_INPUT)
  const onMovementChangeRef = useRef(onMovementChange)
  const [active, setActive] = useState(false)

  useEffect(() => {
    onMovementChangeRef.current = onMovementChange
  }, [onMovementChange])

  useEffect(() => {
    const resetJoystick = () => {
      activePointerIdRef.current = null
      setActive(false)
      knobRef.current?.style.setProperty('--mobile-joystick-x', '0px')
      knobRef.current?.style.setProperty('--mobile-joystick-y', '0px')

      if (!areInputsEqual(latestMovementRef.current, EMPTY_MOVEMENT_INPUT)) {
        latestMovementRef.current = EMPTY_MOVEMENT_INPUT
        onMovementChangeRef.current(EMPTY_MOVEMENT_INPUT)
      }
    }

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        resetJoystick()
      }
    }

    window.addEventListener('blur', resetJoystick)
    window.addEventListener('pagehide', resetJoystick)
    document.addEventListener('visibilitychange', handleVisibilityChange)

    return () => {
      window.removeEventListener('blur', resetJoystick)
      window.removeEventListener('pagehide', resetJoystick)
      document.removeEventListener('visibilitychange', handleVisibilityChange)

      if (!areInputsEqual(latestMovementRef.current, EMPTY_MOVEMENT_INPUT)) {
        onMovementChangeRef.current(EMPTY_MOVEMENT_INPUT)
      }
    }
  }, [])

  const emitMovement = (nextInput: MobileMovementInput) => {
    if (areInputsEqual(latestMovementRef.current, nextInput)) {
      return
    }

    latestMovementRef.current = nextInput
    onMovementChangeRef.current(nextInput)
  }

  const moveKnob = (x: number, y: number) => {
    if (!knobRef.current) {
      return
    }

    knobRef.current.style.setProperty('--mobile-joystick-x', `${x}px`)
    knobRef.current.style.setProperty('--mobile-joystick-y', `${y}px`)
  }

  const updateFromPointer = (clientX: number, clientY: number) => {
    const base = baseRef.current
    if (!base) {
      return
    }

    const bounds = base.getBoundingClientRect()
    const knobSize = knobRef.current?.offsetWidth ?? bounds.width * 0.46
    const maxTravel = Math.max(1, (Math.min(bounds.width, bounds.height) - knobSize) / 2 - 6)
    const rawX = clientX - (bounds.left + bounds.width / 2)
    const rawY = clientY - (bounds.top + bounds.height / 2)
    const rawDistance = Math.hypot(rawX, rawY)
    const clampRatio = rawDistance > maxTravel ? maxTravel / rawDistance : 1
    const x = rawX * clampRatio
    const y = rawY * clampRatio
    const distance = Math.hypot(x, y)

    moveKnob(x, y)

    if (distance / maxTravel < DEAD_ZONE_RATIO) {
      emitMovement(EMPTY_MOVEMENT_INPUT)
      return
    }

    const unitX = x / distance
    const unitY = y / distance
    emitMovement({
      up: unitY < -DIRECTION_THRESHOLD,
      down: unitY > DIRECTION_THRESHOLD,
      left: unitX < -DIRECTION_THRESHOLD,
      right: unitX > DIRECTION_THRESHOLD,
    })
  }

  const releasePointer = (event?: ReactPointerEvent<HTMLDivElement>) => {
    if (event && activePointerIdRef.current !== event.pointerId) {
      return
    }

    activePointerIdRef.current = null
    setActive(false)
    moveKnob(0, 0)
    emitMovement(EMPTY_MOVEMENT_INPUT)
  }

  const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (activePointerIdRef.current !== null || (event.pointerType === 'mouse' && event.button !== 0)) {
      return
    }

    event.preventDefault()
    event.stopPropagation()
    activePointerIdRef.current = event.pointerId
    event.currentTarget.setPointerCapture(event.pointerId)
    setActive(true)
    updateFromPointer(event.clientX, event.clientY)
  }

  const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (activePointerIdRef.current !== event.pointerId) {
      return
    }

    event.preventDefault()
    event.stopPropagation()
    updateFromPointer(event.clientX, event.clientY)
  }

  const handlePointerEnd = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (activePointerIdRef.current !== event.pointerId) {
      return
    }

    event.preventDefault()
    event.stopPropagation()
    releasePointer(event)
  }

  return (
    <div
      ref={baseRef}
      className={`mobile-movement-joystick${active ? ' is-active' : ''}`}
      role="group"
      aria-label="Palanca de movimiento"
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerEnd}
      onPointerCancel={handlePointerEnd}
      onLostPointerCapture={handlePointerEnd}
      onContextMenu={(event) => event.preventDefault()}
    >
      <div className="mobile-movement-joystick-ring" aria-hidden="true" />
      <div ref={knobRef} className="mobile-movement-joystick-knob" aria-hidden="true" />
    </div>
  )
}
