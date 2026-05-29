import { DEFAULT_AUDIO_SETTINGS, type AudioSettings } from '@social-sena/shared'

interface TrackStep {
  durationSteps?: number
  gainMultiplier?: number
  glideFactor?: number
  midi: number
}

interface MusicTrack {
  gain: number
  pattern: Array<TrackStep | null>
  type: OscillatorType
}

export interface AmbientMusicController {
  close: () => Promise<void>
  isUnlocked: () => boolean
  unlock: () => Promise<boolean>
  updateSettings: (settings: Pick<AudioSettings, 'musicEnabled' | 'musicVolume'>) => void
}

const TEMPO_BPM = 96
const STEP_DURATION_SECONDS = (60 / TEMPO_BPM) / 2
const SCHEDULE_AHEAD_SECONDS = 0.6
const SCHEDULER_INTERVAL_MS = 120

// Four-bar lead built around a singable hook so the ambience feels mythic,
// memorable and still light enough to loop in the background.
const LEAD_PATTERN: Array<TrackStep | null> = [
  { midi: 76, durationSteps: 2, gainMultiplier: 1.12 },
  null,
  { midi: 83 },
  { midi: 86 },
  { midi: 83 },
  { midi: 79 },
  { midi: 81 },
  { midi: 83 },
  { midi: 84, durationSteps: 2, gainMultiplier: 1.08 },
  null,
  { midi: 79 },
  { midi: 76 },
  { midi: 74 },
  { midi: 76 },
  { midi: 79 },
  { midi: 81 },
  { midi: 76, durationSteps: 2, gainMultiplier: 1.1 },
  null,
  { midi: 83 },
  { midi: 86 },
  { midi: 91, durationSteps: 2, gainMultiplier: 1.15 },
  null,
  { midi: 86 },
  { midi: 83 },
  { midi: 81, durationSteps: 2, gainMultiplier: 1.06 },
  null,
  { midi: 86 },
  { midi: 88 },
  { midi: 83 },
  { midi: 81 },
  { midi: 79 },
  { midi: 76, durationSteps: 2, gainMultiplier: 1.14 },
]

const ARPEGGIO_PATTERN: Array<TrackStep | null> = [
  { midi: 64 },
  { midi: 71 },
  { midi: 66 },
  { midi: 71 },
  { midi: 64 },
  { midi: 71 },
  { midi: 67 },
  { midi: 71 },
  { midi: 64 },
  { midi: 67 },
  { midi: 71 },
  { midi: 67 },
  { midi: 60 },
  { midi: 67 },
  { midi: 71 },
  { midi: 67 },
  { midi: 55 },
  { midi: 62 },
  { midi: 69 },
  { midi: 62 },
  { midi: 55 },
  { midi: 62 },
  { midi: 71 },
  { midi: 62 },
  { midi: 66 },
  { midi: 69 },
  { midi: 64 },
  { midi: 69 },
  { midi: 62 },
  { midi: 69 },
  { midi: 64 },
  { midi: 69 },
]

const BASS_PATTERN: Array<TrackStep | null> = [
  { midi: 40, durationSteps: 2, gainMultiplier: 1.1 },
  null,
  { midi: 35, durationSteps: 2 },
  null,
  { midi: 40, durationSteps: 2, gainMultiplier: 1.05 },
  null,
  { midi: 35, durationSteps: 2 },
  null,
  { midi: 36, durationSteps: 2, gainMultiplier: 1.08 },
  null,
  { midi: 31, durationSteps: 2 },
  null,
  { midi: 36, durationSteps: 2 },
  null,
  { midi: 31, durationSteps: 2 },
  null,
  { midi: 31, durationSteps: 2, gainMultiplier: 1.06 },
  null,
  { midi: 38, durationSteps: 2 },
  null,
  { midi: 31, durationSteps: 2 },
  null,
  { midi: 38, durationSteps: 2 },
  null,
  { midi: 38, durationSteps: 2, gainMultiplier: 1.1 },
  null,
  { midi: 33, durationSteps: 2 },
  null,
  { midi: 38, durationSteps: 2 },
  null,
  { midi: 35, durationSteps: 2, gainMultiplier: 1.04 },
  null,
]

const MUSIC_TRACKS: MusicTrack[] = [
  { type: 'square', gain: 0.085, pattern: LEAD_PATTERN },
  { type: 'square', gain: 0.03, pattern: ARPEGGIO_PATTERN },
  { type: 'triangle', gain: 0.06, pattern: BASS_PATTERN },
]

function midiToFrequency(midi: number) {
  return 440 * 2 ** ((midi - 69) / 12)
}

export function createAmbientMusicController(): AmbientMusicController {
  let audioContext: AudioContext | null = null
  let masterGain: GainNode | null = null
  let unlocked = false
  let musicEnabled = DEFAULT_AUDIO_SETTINGS.musicEnabled
  let musicVolume = DEFAULT_AUDIO_SETTINGS.musicVolume
  let schedulerId: number | null = null
  let nextStepTime = 0
  let nextStepIndex = 0

  const getAudioContext = () => {
    if (typeof window === 'undefined' || typeof window.AudioContext === 'undefined') {
      return null
    }

    if (!audioContext) {
      audioContext = new window.AudioContext()
    }

    return audioContext
  }

  const ensureMasterGain = () => {
    const context = getAudioContext()
    if (!context) {
      return null
    }

    if (!masterGain) {
      masterGain = context.createGain()
      masterGain.gain.setValueAtTime(0.0001, context.currentTime)
      masterGain.connect(context.destination)
    }

    return masterGain
  }

  const applyMasterVolume = () => {
    const context = audioContext
    const gainNode = masterGain
    if (!context || !gainNode || context.state !== 'running') {
      return
    }

    const targetVolume = musicEnabled && musicVolume > 0.001 ? musicVolume : 0.0001
    gainNode.gain.cancelScheduledValues(context.currentTime)
    gainNode.gain.setTargetAtTime(targetVolume, context.currentTime, 0.08)
  }

  const scheduleTrackStep = (track: MusicTrack, step: TrackStep, startTime: number) => {
    const context = audioContext
    const gainNode = masterGain
    if (!context || !gainNode) {
      return
    }

    const oscillator = context.createOscillator()
    const noteGain = context.createGain()
    const duration = STEP_DURATION_SECONDS * (step.durationSteps ?? 1)
    const endTime = startTime + duration
    const frequency = midiToFrequency(step.midi)

    oscillator.type = track.type
    oscillator.frequency.setValueAtTime(frequency, startTime)
    oscillator.frequency.linearRampToValueAtTime(
      Math.max(110, frequency * (step.glideFactor ?? 0.998)),
      endTime,
    )

    noteGain.gain.setValueAtTime(0.0001, startTime)
    noteGain.gain.linearRampToValueAtTime(
      track.gain * (step.gainMultiplier ?? 1),
      startTime + Math.min(0.025, duration * 0.35),
    )
    noteGain.gain.exponentialRampToValueAtTime(0.0001, endTime)

    oscillator.connect(noteGain)
    noteGain.connect(gainNode)
    oscillator.start(startTime)
    oscillator.stop(endTime)
  }

  const schedulePendingSteps = () => {
    const context = audioContext
    if (!context || !masterGain || !musicEnabled || musicVolume <= 0.001) {
      return
    }

    while (nextStepTime < context.currentTime + SCHEDULE_AHEAD_SECONDS) {
      MUSIC_TRACKS.forEach((track) => {
        const step = track.pattern[nextStepIndex]
        if (step) {
          scheduleTrackStep(track, step, nextStepTime)
        }
      })

      nextStepTime += STEP_DURATION_SECONDS
      nextStepIndex = (nextStepIndex + 1) % LEAD_PATTERN.length
    }
  }

  const startLoop = () => {
    if (schedulerId !== null || !unlocked || !musicEnabled || musicVolume <= 0.001) {
      return
    }

    const context = getAudioContext()
    if (!context || context.state !== 'running') {
      return
    }

    ensureMasterGain()
    applyMasterVolume()
    nextStepIndex = 0
    nextStepTime = context.currentTime + 0.05
    schedulePendingSteps()
    schedulerId = window.setInterval(schedulePendingSteps, SCHEDULER_INTERVAL_MS)
  }

  const stopLoop = () => {
    if (schedulerId !== null) {
      window.clearInterval(schedulerId)
      schedulerId = null
    }
  }

  const unlock = async () => {
    const context = getAudioContext()
    if (!context) {
      unlocked = false
      return false
    }

    ensureMasterGain()

    try {
      if (context.state === 'suspended') {
        await context.resume()
      }

      unlocked = context.state === 'running'
      applyMasterVolume()

      if (unlocked) {
        startLoop()
      }

      return unlocked
    } catch {
      unlocked = false
      return false
    }
  }

  const updateSettings = (settings: Pick<AudioSettings, 'musicEnabled' | 'musicVolume'>) => {
    musicEnabled = settings.musicEnabled
    musicVolume = settings.musicVolume

    applyMasterVolume()

    if (!musicEnabled || musicVolume <= 0.001) {
      stopLoop()
      return
    }

    startLoop()
  }

  const close = async () => {
    stopLoop()

    if (audioContext && audioContext.state !== 'closed') {
      await audioContext.close()
    }

    masterGain = null
    audioContext = null
    unlocked = false
  }

  return {
    close,
    isUnlocked: () => unlocked,
    unlock,
    updateSettings,
  }
}
