# MVP foundation

## Capas creadas

- `apps/web`: experiencia visible del jugador y cliente realtime
- `apps/game-server`: autoridad de sala, presencia y chat
- `packages/shared`: contratos comunes para no duplicar tipos ni nombres de eventos

## Primer contrato realtime

Cliente a servidor:

- `connect_to_game`
- `join_room`
- `navigate_to`
- `send_chat_message`

Servidor a cliente:

- `connection_accepted`
- `room_joined`
- `room_state`
- `player_joined`
- `player_moved`
- `player_left`
- `chat_message`
- `server_error`

## Render del cliente

- React maneja UI, paneles y chat
- Phaser renderiza la sala y los jugadores dentro del viewport principal
- La escena recibe `RoomState` desde React y actualiza el mundo sin mezclar networking con render
- El click sobre el mundo genera una solicitud de navegacion hacia un destino
- El servidor construye la ruta inicial `origen -> destino` y ejecuta el desplazamiento
- La experiencia visual prioriza mundo fullscreen con chat lateral fijo
- La camara sigue al jugador con un retardo suavizado aproximado de 300 ms

## Plantillas de salas

- Cada sala se resuelve por ruta, por ejemplo `http://localhost:5173/Room_1909`
- Cada plantilla define su tamano de mundo, spawn, camara y objetos estaticos
- `packages/shared/src/rooms/templates` contiene la metadata autoritativa que usa el servidor
- `apps/web/src/rooms/templates` contiene las plantillas cliente que renderiza Phaser
- El chat queda aislado por escena porque cada ruta usa su propio `roomId`

## Limites actuales

- autenticacion todavia mock
- ruta inicial recta, sin pathfinding con obstaculos
- personajes renderizados con formas de Phaser, no sprites finales
- persistencia aun no implementada
