export const clientEvents = {
  connectToGame: 'connect_to_game',
  joinRoom: 'join_room',
  navigateTo: 'navigate_to',
  stopNavigation: 'stop_navigation',
  updateSkin: 'update_skin',
  setTypingState: 'set_typing_state',
  sendChatMessage: 'send_chat_message',
  ping: 'ping',
} as const

export const serverEvents = {
  connectionAccepted: 'connection_accepted',
  roomJoined: 'room_joined',
  roomState: 'room_state',
  playerJoined: 'player_joined',
  playerMoved: 'player_moved',
  playerLeft: 'player_left',
  typingStateChanged: 'typing_state_changed',
  chatMessage: 'chat_message',
  serverError: 'server_error',
} as const
