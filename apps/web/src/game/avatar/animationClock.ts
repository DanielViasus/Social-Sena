// One clock for every mounted layered avatar. React reads a frame index rather
// than elapsed milliseconds, so clock ticks only render a new animation frame.
let elapsedMs = 0
let startedAtMs = 0
let requestId: number | null = null
const listeners = new Set<() => void>()

function tick(nowMs: number) {
  requestId = null
  elapsedMs = Math.max(0, nowMs - startedAtMs)
  for (const listener of [...listeners]) listener()
  if (listeners.size > 0) requestId = window.requestAnimationFrame(tick)
}

export function subscribeAnimationClock(listener: () => void) {
  listeners.add(listener)
  if (listeners.size === 1) {
    startedAtMs = performance.now() - elapsedMs
    requestId = window.requestAnimationFrame(tick)
  }

  return () => {
    listeners.delete(listener)
    if (listeners.size === 0 && requestId !== null) {
      window.cancelAnimationFrame(requestId)
      requestId = null
    }
  }
}

export function getAnimationElapsedMs() {
  return elapsedMs
}

// Calculate from total elapsed time to avoid timer drift and skip directly to
// the correct frame after a delayed tick or a background tab resumes.
export function getAnimationFrameIndex(animation: { frames: readonly { durationMs: number }[] }, timeMs: number) {
  const durationMs = animation.frames.reduce((total, frame) => total + frame.durationMs, 0)
  if (durationMs <= 0) return 0

  let cycleTimeMs = Math.max(0, timeMs) % durationMs
  for (let index = 0; index < animation.frames.length; index += 1) {
    cycleTimeMs -= animation.frames[index].durationMs
    if (cycleTimeMs < 0) return index
  }
  return 0
}
