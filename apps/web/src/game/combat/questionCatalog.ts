// Catalogo de preguntas del combate. Cada pregunta tiene cuatro respuestas y una sola correcta:
// esas respuestas son las opciones de ataque del jugador.
export type CombatQuestionCategory = 'ciencias-basicas'
export type CombatQuestionDifficulty = 'facil' | 'media' | 'dificil'

export interface CombatQuestionOption {
  id: string
  label: string
}

export interface CombatQuestion {
  id: string
  category: CombatQuestionCategory
  difficulty: CombatQuestionDifficulty
  prompt: string
  options: CombatQuestionOption[]
  correctOptionId: string
}

export const COMBAT_QUESTIONS: readonly CombatQuestion[] = [
  {
    id: 'mat-suma-2-mas-2',
    category: 'ciencias-basicas',
    difficulty: 'facil',
    prompt: '¿Cuánto es 2 + 2?',
    options: [
      { id: 'a', label: '2' },
      { id: 'b', label: '4' },
      { id: 'c', label: '6' },
      { id: 'd', label: '8' },
    ],
    correctOptionId: 'b',
  },
]

export function isCorrectCombatAnswer(question: CombatQuestion, optionId: string) {
  return question.correctOptionId === optionId
}

// Elige una pregunta del nivel pedido evitando repetir la anterior cuando hay mas de una.
export function pickCombatQuestion(
  difficulty: CombatQuestionDifficulty = 'facil',
  previousQuestionId?: string | null,
): CombatQuestion {
  const byDifficulty = COMBAT_QUESTIONS.filter((question) => question.difficulty === difficulty)
  const pool = byDifficulty.length > 0 ? byDifficulty : COMBAT_QUESTIONS
  const withoutPrevious = pool.length > 1
    ? pool.filter((question) => question.id !== previousQuestionId)
    : pool

  return withoutPrevious[Math.floor(Math.random() * withoutPrevious.length)] ?? COMBAT_QUESTIONS[0]
}
