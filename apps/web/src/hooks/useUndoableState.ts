import { useCallback, useReducer, type SetStateAction } from 'react'

export interface UndoHistory<T> {
  past: T[]
  present: T
  future: T[]
}

type HistoryAction<T> = { type: 'reset'; value: T } | { type: 'update'; update: SetStateAction<T> } | { type: 'undo' | 'redo' }

export function reduceUndoHistory<T>(history: UndoHistory<T>, action: HistoryAction<T>): UndoHistory<T> {
  if (action.type === 'reset') return { past: [], present: action.value, future: [] }
  if (action.type === 'undo') {
    if (!history.past.length) return history
    return {
      past: history.past.slice(0, -1),
      present: history.past[history.past.length - 1],
      future: [history.present, ...history.future],
    }
  }
  if (action.type === 'redo') {
    if (!history.future.length) return history
    return {
      past: [...history.past, history.present],
      present: history.future[0],
      future: history.future.slice(1),
    }
  }
  if (action.type !== 'update') return history
  const next = typeof action.update === 'function'
    ? (action.update as (previous: T) => T)(history.present)
    : action.update
  // Editor documents contain serializable data. Ignore edits that change no values.
  if (JSON.stringify(next) === JSON.stringify(history.present)) return history
  return { past: [...history.past, history.present].slice(-100), present: next, future: [] }
}

export function useUndoableState<T>(initialize: () => T) {
  const [history, dispatch] = useReducer(reduceUndoHistory<T>, undefined, () => ({
    past: [], present: initialize(), future: [],
  }))
  const setState = useCallback((update: SetStateAction<T>) => dispatch({ type: 'update', update }), [])
  const reset = useCallback((value: T) => dispatch({ type: 'reset', value }), [])
  const undo = useCallback(() => dispatch({ type: 'undo' }), [])
  const redo = useCallback(() => dispatch({ type: 'redo' }), [])
  return { state: history.present, setState, reset, undo, redo, canUndo: history.past.length > 0, canRedo: history.future.length > 0 }
}
