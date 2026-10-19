import { useEffect, useLayoutEffect, useRef, useState } from 'react'

export interface MobileMovementInput {
  up: boolean
  down: boolean
  left: boolean
  right: boolean
}

interface MobileMovementJoystickProps {
  onMovementChange: (input: MobileMovementInput) => void
}

interface JoystickOrigin {
  x: number
  y: number
}

const EMPTY_MOVEMENT_INPUT: MobileMovementInput = {
  up: false,
  down: false,
  left: false,
  right: false,
}

const JOYSTICK_SIZE_PX = 150
const KNOB_SIZE_RATIO = 0.46
const EDGE_INSET_RATIO = 0.03
const MAX_KNOB_TRAVEL_PX =
  (JOYSTICK_SIZE_PX * (1 - KNOB_SIZE_RATIO)) / 2 - JOYSTICK_SIZE_PX * EDGE_INSET_RATIO
const DEAD_ZONE_RATIO = 0.18
const DIRECTION_THRESHOLD = 0.38

function areInputsEqual(left: MobileMovementInput, right: MobileMovementInput) {
  return left.up === right.up && left.down === right.down && left.left === right.left && left.right === right.right
}

export default function MobileMovementJoystick({ onMovementChange }: MobileMovementJoystickProps) {
  const knobRef = useRef<HTMLDivElement | null>(null)
  const activePointerIdRef = useRef<number | null>(null)
  const capturedViewportRef = useRef<Element | null>(null)
  const originRef = useRef<JoystickOrigin | null>(null)
  const knobOffsetRef = useRef({ x: 0, y: 0 })
  const latestMovementRef = useRef<MobileMovementInput>(EMPTY_MOVEMENT_INPUT)
  const onMovementChangeRef = useRef(onMovementChange)
  const [origin, setOrigin] = useState<JoystickOrigin | null>(null)

  useEffect(() => {
    onMovementChangeRef.current = onMovementChange
  }, [onMovementChange])

  useLayoutEffect(() => {
    if (!knobRef.current) {
      return
    }

    knobRef.current.style.setProperty('--mobile-joystick-x', `${knobOffsetRef.current.x}px`)
    knobRef.current.style.setProperty('--mobile-joystick-y', `${knobOffsetRef.current.y}px`)
  }, [origin])

  useEffect(() => {
    const emitMovement = (nextInput: MobileMovementInput) => {
      if (areInputsEqual(latestMovementRef.current, nextInput)) {
        return
      }

      latestMovementRef.current = nextInput
      onMovementChangeRef.current(nextInput)
    }

    const moveKnob = (x: number, y: number) => {
      knobOffsetRef.current = { x, y }
      knobRef.current?.style.setProperty('--mobile-joystick-x', `${x}px`)
      knobRef.current?.style.setProperty('--mobile-joystick-y', `${y}px`)
    }

    const releasePointerCapture = () => {
      const pointerId = activePointerIdRef.current
      const viewport = capturedViewportRef.current
      if (pointerId === null || !viewport) {
        return
      }

      try {
        if (viewport.hasPointerCapture(pointerId)) {
          viewport.releasePointerCapture(pointerId)
        }
      } catch {
        // El navegador puede liberar la captura automáticamente antes de este punto.
      }
    }

    const resetJoystick = () => {
      releasePointerCapture()
      activePointerIdRef.current = null
      capturedViewportRef.current = null
      originRef.current = null
      moveKnob(0, 0)
      setOrigin(null)
      emitMovement(EMPTY_MOVEMENT_INPUT)
    }

    const updateFromPointer = (clientX: number, clientY: number) => {
      const currentOrigin = originRef.current
      if (!currentOrigin) {
        return
      }

      const rawX = clientX - currentOrigin.x
      const rawY = clientY - currentOrigin.y
      const rawDistance = Math.hypot(rawX, rawY)
      const clampRatio = rawDistance > MAX_KNOB_TRAVEL_PX ? MAX_KNOB_TRAVEL_PX / rawDistance : 1
      const x = rawX * clampRatio
      const y = rawY * clampRatio
      const distance = Math.hypot(x, y)

      moveKnob(x, y)

      if (distance / MAX_KNOB_TRAVEL_PX < DEAD_ZONE_RATIO) {
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

    const handlePointerDown = (event: PointerEvent) => {
      if (
        activePointerIdRef.current !== null ||
        event.pointerType === 'mouse' ||
        event.button !== 0 ||
        !(event.target instanceof Element)
      ) {
        return
      }

      const worldViewport = event.target.closest('.react-world-viewport')
      if (!worldViewport) {
        return
      }

      event.preventDefault()
      const nextOrigin = { x: event.clientX, y: event.clientY }
      activePointerIdRef.current = event.pointerId
      capturedViewportRef.current = worldViewport
      originRef.current = nextOrigin
      moveKnob(0, 0)
      setOrigin(nextOrigin)

      try {
        worldViewport.setPointerCapture(event.pointerId)
      } catch {
        // El seguimiento global mantiene activo el control si la captura no está disponible.
      }
    }

    const handlePointerMove = (event: PointerEvent) => {
      if (activePointerIdRef.current !== event.pointerId) {
        return
      }

      event.preventDefault()
      updateFromPointer(event.clientX, event.clientY)
    }

    const handlePointerEnd = (event: PointerEvent) => {
      if (activePointerIdRef.current !== event.pointerId) {
        return
      }

      event.preventDefault()
      resetJoystick()
    }

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        resetJoystick()
      }
    }

    const listenerOptions: AddEventListenerOptions = { capture: true, passive: false }
    window.addEventListener('pointerdown', handlePointerDown, listenerOptions)
    window.addEventListener('pointermove', handlePointerMove, listenerOptions)
    window.addEventListener('pointerup', handlePointerEnd, listenerOptions)
    window.addEventListener('pointercancel', handlePointerEnd, listenerOptions)
    window.addEventListener('blur', resetJoystick)
    window.addEventListener('pagehide', resetJoystick)
    window.addEventListener('orientationchange', resetJoystick)
    document.addEventListener('visibilitychange', handleVisibilityChange)

    return () => {
      window.removeEventListener('pointerdown', handlePointerDown, true)
      window.removeEventListener('pointermove', handlePointerMove, true)
      window.removeEventListener('pointerup', handlePointerEnd, true)
      window.removeEventListener('pointercancel', handlePointerEnd, true)
      window.removeEventListener('blur', resetJoystick)
      window.removeEventListener('pagehide', resetJoystick)
      window.removeEventListener('orientationchange', resetJoystick)
      document.removeEventListener('visibilitychange', handleVisibilityChange)
      releasePointerCapture()

      if (!areInputsEqual(latestMovementRef.current, EMPTY_MOVEMENT_INPUT)) {
        onMovementChangeRef.current(EMPTY_MOVEMENT_INPUT)
      }
    }
  }, [])

  if (!origin) {
    return null
  }

  return (
    <div
      className="mobile-movement-joystick is-active"
      style={{ left: `${origin.x}px`, top: `${origin.y}px` }}
      aria-hidden="true"
    >
      <div className="mobile-movement-joystick-ring" />
      <div ref={knobRef} className="mobile-movement-joystick-knob" />
    </div>
  )
}
