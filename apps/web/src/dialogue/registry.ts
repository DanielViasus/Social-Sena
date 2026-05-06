import promptE0 from '../assets/npc/icons/interaction/INTERACTION_E_0.svg'
import promptE1 from '../assets/npc/icons/interaction/INTERACTION_E_1.svg'

export interface DialoguePromptFrame {
  key: string
  url: string
}

export interface DialogueDefinition {
  id: string
  lines: string[]
  promptFrames?: DialoguePromptFrame[]
  promptFrameDurationMs?: number
  promptWidth?: number
  promptHeight?: number
  promptFallbackColor?: string
  cooldownMs?: number
  onComplete?: () => void
}

const DEFAULT_PROMPT_FRAMES: DialoguePromptFrame[] = [
  { key: 'dialogue-prompt-e-0', url: promptE0 },
  { key: 'dialogue-prompt-e-1', url: promptE1 },
]

const dialogueRegistry: Record<string, DialogueDefinition> = {
  'lobby-guide-intro': {
    id: 'lobby-guide-intro',
    lines: [
      'Bienvenido al mundo Sena, soy el guardian de este castillo.',
      'Puedo ayudarte a entender este lobby y a encontrar puntos clave del mundo.',
      'Acercate a los elementos del mapa y sigue explorando. Siempre podras volver si necesitas orientacion.',
    ],
    promptFrames: DEFAULT_PROMPT_FRAMES,
    promptFrameDurationMs: 320,
    promptWidth: 128,
    promptHeight: 128,
    promptFallbackColor: '#6e738f',
    cooldownMs: 1500,
  },
}

export function getDialogueById(dialogueId: string | null | undefined) {
  if (!dialogueId) {
    return null
  }

  return dialogueRegistry[dialogueId] ?? null
}
