export type UiSoundName =
  | 'friend-request'
  | 'chat-bubble'
  | 'menu-open'
  | 'menu-close'
  | 'panel-open'
  | 'panel-close'
  | 'select'
  | 'color'
  | 'confirm'
  | 'cancel'
  | 'send'
  | 'dialogue-blip'

interface ChiptuneLayer {
  type: OscillatorType
  gain: number
  octaveOffset?: number
  detune?: number
}

interface ChiptuneNote {
  frequency: number
  offset: number
  duration: number
  glideFactor?: number
}

interface ChiptunePattern {
  unlockMode: 'gesture' | 'passive'
  layers: ChiptuneLayer[]
  notes: ChiptuneNote[]
  startDelay?: number
}

export interface UiSoundController {
  close: () => Promise<void>
  isUnlocked: () => boolean
  play: (soundName: UiSoundName) => Promise<void>
  unlock: () => Promise<boolean>
}

const UI_SOUND_PATTERNS: Record<UiSoundName, ChiptunePattern> = {
  'friend-request': {
    unlockMode: 'passive',
    startDelay: 0.01,
    layers: [
      { type: 'square', gain: 0.024 },
      { type: 'triangle', gain: 0.01, octaveOffset: -1 },
    ],
    notes: [
      { frequency: 523.25, offset: 0, duration: 0.11, glideFactor: 0.995 },
      { frequency: 659.25, offset: 0.075, duration: 0.11, glideFactor: 0.995 },
      { frequency: 783.99, offset: 0.15, duration: 0.11, glideFactor: 0.995 },
      { frequency: 1046.5, offset: 0.225, duration: 0.18, glideFactor: 0.995 },
    ],
  },
  'chat-bubble': {
    unlockMode: 'passive',
    startDelay: 0.01,
    layers: [
      { type: 'square', gain: 0.016 },
      { type: 'triangle', gain: 0.008, octaveOffset: -1 },
    ],
    notes: [
      { frequency: 659.25, offset: 0, duration: 0.06, glideFactor: 1.01 },
      { frequency: 783.99, offset: 0.05, duration: 0.09, glideFactor: 1.015 },
    ],
  },
  'menu-open': {
    unlockMode: 'gesture',
    startDelay: 0.008,
    layers: [
      { type: 'square', gain: 0.022 },
      { type: 'triangle', gain: 0.008, octaveOffset: -1 },
    ],
    notes: [
      { frequency: 392, offset: 0, duration: 0.055, glideFactor: 1.01 },
      { frequency: 523.25, offset: 0.04, duration: 0.06, glideFactor: 1.01 },
      { frequency: 659.25, offset: 0.085, duration: 0.085, glideFactor: 1.015 },
    ],
  },
  'menu-close': {
    unlockMode: 'gesture',
    startDelay: 0.008,
    layers: [
      { type: 'square', gain: 0.018 },
      { type: 'triangle', gain: 0.007, octaveOffset: -1 },
    ],
    notes: [
      { frequency: 659.25, offset: 0, duration: 0.05, glideFactor: 0.99 },
      { frequency: 523.25, offset: 0.035, duration: 0.05, glideFactor: 0.985 },
      { frequency: 392, offset: 0.07, duration: 0.075, glideFactor: 0.98 },
    ],
  },
  'panel-open': {
    unlockMode: 'gesture',
    startDelay: 0.008,
    layers: [
      { type: 'square', gain: 0.02 },
      { type: 'triangle', gain: 0.009, octaveOffset: -1 },
    ],
    notes: [
      { frequency: 440, offset: 0, duration: 0.055, glideFactor: 1.012 },
      { frequency: 554.37, offset: 0.045, duration: 0.06, glideFactor: 1.012 },
      { frequency: 659.25, offset: 0.095, duration: 0.1, glideFactor: 1.015 },
    ],
  },
  'panel-close': {
    unlockMode: 'gesture',
    startDelay: 0.008,
    layers: [
      { type: 'square', gain: 0.017 },
      { type: 'triangle', gain: 0.007, octaveOffset: -1 },
    ],
    notes: [
      { frequency: 659.25, offset: 0, duration: 0.05, glideFactor: 0.99 },
      { frequency: 554.37, offset: 0.035, duration: 0.05, glideFactor: 0.985 },
      { frequency: 440, offset: 0.07, duration: 0.085, glideFactor: 0.98 },
    ],
  },
  select: {
    unlockMode: 'gesture',
    startDelay: 0.006,
    layers: [{ type: 'square', gain: 0.015 }],
    notes: [{ frequency: 880, offset: 0, duration: 0.055, glideFactor: 0.985 }],
  },
  color: {
    unlockMode: 'gesture',
    startDelay: 0.006,
    layers: [
      { type: 'square', gain: 0.014 },
      { type: 'triangle', gain: 0.006, octaveOffset: -1 },
    ],
    notes: [
      { frequency: 698.46, offset: 0, duration: 0.045, glideFactor: 1.012 },
      { frequency: 932.33, offset: 0.038, duration: 0.06, glideFactor: 1.008 },
    ],
  },
  confirm: {
    unlockMode: 'gesture',
    startDelay: 0.008,
    layers: [
      { type: 'square', gain: 0.023 },
      { type: 'triangle', gain: 0.01, octaveOffset: -1 },
    ],
    notes: [
      { frequency: 523.25, offset: 0, duration: 0.07, glideFactor: 1.01 },
      { frequency: 659.25, offset: 0.05, duration: 0.07, glideFactor: 1.01 },
      { frequency: 783.99, offset: 0.1, duration: 0.08, glideFactor: 1.012 },
      { frequency: 1046.5, offset: 0.16, duration: 0.12, glideFactor: 1.015 },
    ],
  },
  cancel: {
    unlockMode: 'gesture',
    startDelay: 0.008,
    layers: [
      { type: 'triangle', gain: 0.018 },
      { type: 'square', gain: 0.009, octaveOffset: -1 },
    ],
    notes: [
      { frequency: 659.25, offset: 0, duration: 0.065, glideFactor: 0.94 },
      { frequency: 493.88, offset: 0.055, duration: 0.075, glideFactor: 0.92 },
      { frequency: 392, offset: 0.12, duration: 0.11, glideFactor: 0.88 },
    ],
  },
  send: {
    unlockMode: 'gesture',
    startDelay: 0.006,
    layers: [
      { type: 'square', gain: 0.016 },
      { type: 'triangle', gain: 0.007, octaveOffset: -1 },
    ],
    notes: [
      { frequency: 440, offset: 0, duration: 0.05, glideFactor: 1.008 },
      { frequency: 659.25, offset: 0.04, duration: 0.08, glideFactor: 1.012 },
    ],
  },
  'dialogue-blip': {
    unlockMode: 'passive',
    startDelay: 0,
    layers: [{ type: 'square', gain: 0.018 }],
    notes: [{ frequency: 880, offset: 0, duration: 0.045, glideFactor: 0.75 }],
  },
}

export function createUiSoundController(): UiSoundController {
  let audioContext: AudioContext | null = null
  let unlocked = false

  const getAudioContext = () => {
    if (typeof window === 'undefined' || typeof window.AudioContext === 'undefined') {
      return null
    }

    if (!audioContext) {
      audioContext = new window.AudioContext()
    }

    return audioContext
  }

  const unlock = async () => {
    const context = getAudioContext()
    if (!context) {
      unlocked = false
      return false
    }

    try {
      if (context.state === 'suspended') {
        await context.resume()
      }

      unlocked = context.state === 'running'
      return unlocked
    } catch {
      unlocked = false
      return false
    }
  }

  const play = async (soundName: UiSoundName) => {
    const pattern = UI_SOUND_PATTERNS[soundName]

    if (pattern.unlockMode === 'gesture') {
      const audioUnlocked = await unlock()
      if (!audioUnlocked) {
        return
      }
    }

    const context = audioContext
    if (!unlocked || !context || context.state !== 'running') {
      return
    }

    const startTime = context.currentTime + (pattern.startDelay ?? 0.01)

    pattern.notes.forEach((note) => {
      const toneStart = startTime + note.offset
      const toneEnd = toneStart + note.duration

      pattern.layers.forEach((layer) => {
        const oscillator = context.createOscillator()
        const gainNode = context.createGain()
        const targetFrequency = note.frequency * 2 ** (layer.octaveOffset ?? 0)

        oscillator.type = layer.type
        oscillator.detune.setValueAtTime(layer.detune ?? 0, toneStart)
        oscillator.frequency.setValueAtTime(targetFrequency, toneStart)
        oscillator.frequency.linearRampToValueAtTime(
          Math.max(120, targetFrequency * (note.glideFactor ?? 1)),
          toneEnd,
        )

        gainNode.gain.setValueAtTime(0.0001, toneStart)
        gainNode.gain.linearRampToValueAtTime(layer.gain, toneStart + Math.min(0.012, note.duration * 0.3))
        gainNode.gain.exponentialRampToValueAtTime(0.0001, toneEnd)

        oscillator.connect(gainNode)
        gainNode.connect(context.destination)
        oscillator.start(toneStart)
        oscillator.stop(toneEnd)
      })
    })
  }

  const close = async () => {
    if (audioContext && audioContext.state !== 'closed') {
      await audioContext.close()
    }

    audioContext = null
    unlocked = false
  }

  return {
    close,
    isUnlocked: () => unlocked,
    play,
    unlock,
  }
}
