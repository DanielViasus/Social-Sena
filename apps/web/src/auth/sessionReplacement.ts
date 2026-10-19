import {
  serverEvents,
  type ServerErrorPayload,
  type SessionReplacedPayload,
} from '@social-sena/shared'
import type { Socket } from 'socket.io-client'

type SessionReplacedAcknowledgement = () => void

export function listenForSessionReplacement(socket: Socket, onSessionReplaced: () => void) {
  let handled = false

  const handleReplacement = (
    _payload: SessionReplacedPayload,
    acknowledge?: SessionReplacedAcknowledgement,
  ) => {
    acknowledge?.()
    if (handled) {
      return
    }

    handled = true
    socket.disconnect()
    onSessionReplaced()
  }

  const handleLegacyServerError = (payload: ServerErrorPayload) => {
    if (payload.code === 'SESSION_REPLACED') {
      handleReplacement({ code: 'SESSION_REPLACED', message: payload.message })
    }
  }

  socket.on(serverEvents.sessionReplaced, handleReplacement)
  socket.on(serverEvents.serverError, handleLegacyServerError)

  return () => {
    socket.off(serverEvents.sessionReplaced, handleReplacement)
    socket.off(serverEvents.serverError, handleLegacyServerError)
  }
}
