# Sistema de animaciones del jugador

Documento técnico del sistema de animaciones por capas: cómo se crean en el editor, cómo se asignan a movimientos y direcciones, cómo se publican en el servidor y cómo las usa el juego. Incluye el plan de migración desde el sistema antiguo.

Estado: el sistema nuevo está **implementado y conviviendo con el antiguo** (el antiguo queda como respaldo). La migración completa descrita en la sección 10 está **pendiente**.

## 1. Resumen

- Una animación es una secuencia de frames; cada frame es una lista de **capas**, y cada capa representa una **parte del avatar** con su posición, rotación y pivote.
- Las animaciones **no guardan imágenes al publicarse**. Solo guardan datos (el "armazón"). El juego busca la imagen de cada capa por una convención de nombres de archivo, según la skin equipada, la parte y la vista (frente o espalda). Por eso una misma animación funciona con cualquier skin.
- Un administrador asigna animaciones a **estados** (Idle, Walk y estados propios) y a **6 direcciones**, agrupadas en **variaciones** (Default, Fly, Fight...). Lo publicado afecta a **todos los jugadores del servidor**.

## 2. Piezas del sistema

| Pieza | Ruta | Qué hace |
|---|---|---|
| Editor de animaciones | `/editor/animations` (`AnimationEditorPage.tsx`) | Crea y edita animaciones por capas y frames. Guarda en el navegador. |
| Asignación de animaciones | `/editor/assignments` (`AnimationAssignmentsPage.tsx`) | Asigna animaciones a estados y direcciones por variación, y publica al servidor. |
| Menú de editores | `/editor` (`RoomEditorMenuPage.tsx`) | Pestaña "Asignar animaciones" con la lista de variaciones y el botón "Crear variación". |
| Almacenamiento del editor | `game/avatar/animationEditorStorage.ts` | IndexedDB `social-sena-animation-editor`, almacén `animations`. |
| Modelo de asignaciones | `game/avatar/animationAssignmentStorage.ts` | Variaciones, estados, direcciones, reflejo (flip) y resolución de casillas. localStorage `social-sena-animation-assignments` (versión 2). |
| Armazón (formato publicado) | `game/avatar/animationSkeleton.ts` | `toSkeleton` convierte una animación del editor en datos sin imágenes. |
| Publicación | `game/avatar/publishAvatarAnimations.ts` | Abre una conexión, verifica el rol real y sube animaciones y asignaciones. |
| Estado en el juego | `game/avatar/avatarAnimationRuntime.ts` | Recibe la configuración del servidor, pide las animaciones que se necesitan y las guarda en caché. |
| Dibujo en el juego | `components/world/EditorLayeredAvatar.tsx`, `WorldPlayer.tsx` | Dibuja el avatar con el armazón y decide cuándo usar el respaldo. |
| Selector de prueba | `components/AvatarAnimationTestSelector.tsx` | Elige la variación activa solo en el navegador (panel de debug, solo admin). |
| Reloj compartido | `game/avatar/animationClock.ts` | Un único reloj para todos los avatares. |

## 3. Convención de nombres de las imágenes

Las capas se resuelven por el nombre del archivo SVG:

```
sk_<tier>_<monedas>_<vista>_<skin>_<parte>.svg
sk_0_10_f_crock_cabeza.svg
```

| Sección | Significado |
|---|---|
| `sk` | Imagen diseñada para usarse en animaciones de skin. |
| `tier` | Grado de rareza de la skin (común, poco común, raro...). Metadato; no interviene al dibujar. |
| `monedas` | Precio de la capa. Metadato; no interviene al dibujar. |
| `vista` | `f` (frente) o `b` (espalda). |
| `skin` | Colección a la que pertenece (por ejemplo `chap`, `crock`). |
| `parte` | `cabeza`, `cuerpo`, `manoIzquierda`, `manoDerecha`, `piernaIzquierda`, `piernaDerecha`, `sombra` o `accesorios`. |

Los archivos viven en `apps/web/src/assets/characters/<Coleccion>/` y se descubren automáticamente (`skinLayerAssets` en `game/avatar/layeredAvatar.ts`). La sombra de Chap es `sk_0_0_f_chap_sombra.svg` y `sk_0_0_b_chap_sombra.svg`. Solo puede haber un archivo por colección, vista y parte; si hubiera varios, se toma el primero.

**Mezclar colecciones:** `buildAnimationEquipment({ cabeza: 'crock' }, 'chap', vista)` arma el equipo con la cabeza de otra colección. Si la colección elegida no tiene esa parte en esa vista, se usa la de la skin por defecto. Esta función existe pero todavía no está conectada a los datos de cada jugador.

## 4. Formato de datos

### 4.1 Animación del editor (solo local)

`EditorFrame` y `EditorImageLayer` incluyen `url` (imagen incrustada) y `part`. Se guarda así en IndexedDB para poder editarla.

### 4.2 Armazón (lo que se publica)

```ts
interface SkeletonLayer {
  id: string
  visible: boolean
  x: number; y: number
  rotation: number; rotationX: number; rotationY: number
  pivotX: number; pivotY: number
  part: AnimationPart   // cabeza, cuerpo, manos, piernas, sombra, accesorios
}
interface SkeletonFrame { id: string; durationMs: number; layers: SkeletonLayer[] } // la capa de más al frente va primero
interface AnimationSkeleton { frames: SkeletonFrame[]; sceneSize: { width: number; height: number } }
```

`toSkeleton` elimina las imágenes. Si una capa no tiene `part`, se intenta deducir del nombre de la capa, que puede ser exactamente una parte (`cabeza`) o seguir la convención (`sk_0_0_b_chap_manoIzquierda`, con o sin `.svg`). Si no se puede, la publicación se detiene indicando la capa y el frame.

### 4.3 Asignaciones

```ts
interface AnimationAssignments {
  version: 2
  customStates: { id: string; name: string }[]
  variations: {
    id: string
    name: string
    assignments: Record<slotKey, animationId>
    settings: Record<slotKey, { flipX?: boolean; flipY?: boolean }>
  }[]
}
```

- **Casilla (`slotKey`):** `${estado}:${direccion}`, por ejemplo `walk:ne`.
- **Estados integrados:** `idle` y `walk`. Los estados propios usan un id generado.
- **Direcciones (6):** `nw`, `ne`, `w`, `e`, `sw`, `se`. No hay arriba ni abajo puros: el personaje siempre se ve de perfil, y el movimiento puramente vertical mantiene la última dirección.
- **Variación `default`:** siempre existe, no se puede eliminar y es la referencia. Una casilla sin asignar en otra variación hereda de Default.
- **Reflejo por convención:** las casillas del lado izquierdo (`w`, `nw`, `sw`) llevan `flipX` activado por defecto. Cada casilla puede cambiarlo, y también activar `flipY`.
- **Resolución (`resolveSlotAnimation`):** casilla propia, luego la de Default, y si no hay ninguna, `null` (el juego usa su respaldo).

## 5. Publicación y roles

- Solo **admin** y **developer** pueden publicar. El servidor valida el rol real de la sesión; el cliente solo oculta o muestra el botón.
- El botón **"Publicar al servidor"** está en `/editor/assignments`. Se habilita cuando no hay cambios sin guardar y pide confirmación porque afecta a todos.
- Se publican solo las animaciones usadas por alguna casilla (más la configuración completa). Se envía una animación por mensaje y al final la configuración.
- Al publicar la configuración, el servidor emite `avatar_animations_updated` a todos los clientes conectados, que la vuelven a pedir.

### Eventos (en `packages/shared/src/events.ts`)

| Evento | Dirección | Quién puede | Contenido |
|---|---|---|---|
| `get_avatar_animation_config` | cliente → servidor | cualquier sesión | Devuelve la configuración publicada o `null`. |
| `get_avatar_animation` | cliente → servidor | cualquier sesión | Devuelve una animación por id. |
| `publish_avatar_animation` | cliente → servidor | admin, developer | Guarda un armazón. |
| `publish_avatar_animation_config` | cliente → servidor | admin, developer | Guarda las asignaciones. |
| `avatar_animations_updated` | servidor → clientes | n/a | Aviso de que hay una configuración nueva. |

Los esquemas (Zod) están en `packages/shared/src/schemas.ts` y rechazan imágenes y valores fuera de rango (hasta 240 frames, 40 capas por frame, 60 variaciones y 60 estados propios, partes de una lista fija).

### Base de datos (`apps/game-server/src/db/schema.sql`)

```
avatar_animation_documents (id text pk, name text, document jsonb, updated_at)
avatar_animation_config    (id text pk, config jsonb, updated_at)   -- una fila con id 'main'
```

Se crean con `create table if not exists`, de forma aditiva, al arrancar el servidor. Sin `DATABASE_URL` el servidor trabaja en memoria y **no puede publicar** ("No hay base de datos disponible").

## 6. Cómo lo usa el juego

1. `GameClient.tsx` llama a `attachAvatarAnimationSocket` al crear el socket. Al recibir `connection_accepted` y `avatar_animations_updated` se pide la configuración.
2. En `WorldPlayer.tsx`, para cada jugador se calcula el estado (`walk` si se mueve, `idle` si no) y la dirección. La dirección se deduce de la vista y el reflejo: espalda más izquierda es `nw`, espalda más derecha es `ne`, frente más izquierda es `sw` y frente más derecha es `se`. Si esa diagonal no tiene animación, se prueba la pura (`e` o `w`).
3. Si hay una animación para esa casilla y su armazón ya se descargó, se dibuja con `EditorLayeredAvatar`, con el reflejo de la casilla. Cada capa muestra la imagen de la skin equipada para su parte y vista.
4. Si no hay nada publicado, aún no cargó, falló o la skin no tiene la parte, se usa el sistema antiguo (`LayeredAvatar` con `avatarAnimations`).
5. La variación activa es `default` salvo que un admin elija otra con el selector (se guarda en localStorage, `social-sena-runtime-animation-variation`, solo en ese navegador).

**Diagnóstico:** pulsa **P** en el juego. Con rol admin aparece "Variación de animación" con una línea de estado (por ejemplo `2 variaciones · 6 casillas en la activa · 4 animaciones cargadas · 0 con error`). Los mensajes de consola llevan el prefijo `[avatar-animations]` y `[avatar-animations:publicar]`; el servidor registra con `[avatar-animations]`.

## 7. Entornos: local y desplegado

| | Local | Desplegado |
|---|---|---|
| Web | Vite en `http://localhost:5173` | Vercel (estática) |
| Servidor | `npm run dev:server` (puerto 3001) | Render o Railway |
| Base de datos | Opcional. Sin ella no se puede publicar. | Postgres (`DATABASE_URL`) |
| URL del servidor | `VITE_GAME_SERVER_URL` | `VITE_GAME_SERVER_URL` en Vercel |
| Rol admin | Página de acceso por rol disponible fuera de producción | Hay que asignar el rol en la base de datos |

Puntos a recordar:
- Las animaciones del editor viven en IndexedDB y es distinto por **origen**: lo creado en `localhost` no existe en el dominio de producción hasta publicarlo allí.
- Las **skins** (SVG) viajan con la web; las **animaciones publicadas** viven en la base de datos. Agregar una skin nueva requiere desplegar la web; publicar o cambiar una animación, no.
- Servidor y web se despliegan por separado. Web antigua con servidor nuevo no cambia nada. Web nueva con servidor antiguo: la petición de configuración no recibe respuesta (hay un tiempo de espera de 8 s) y se usa el respaldo.
- Con `DATABASE_URL` apuntando a la misma base en local y en producción, las animaciones publicadas desde local afectan a los jugadores reales.

## 8. Otros cambios incluidos en esta iteración

- **Presencias duplicadas** (`game-server/src/index.ts`, `joinSessionToRoom`): se evita añadir al jugador si su socket ya se cerró o fue reemplazado, se elimina cualquier presencia anterior del mismo socket y las presencias obsoletas del mismo usuario, y al desconectar se limpia lo que haya quedado. Registro: `[presence] ...`.
- **Personaje bloqueado al entrar a una sala** (`ensureNavigablePlayerPosition`): si la posición cae dentro de una zona bloqueada grande, ahora se busca una celda libre desde el punto de aparición y, si hace falta, por todo el mapa. Antes el movimiento se cancelaba para siempre.
- **Inventario** (`components/inventory/InventoryOverlay.tsx`): dos pestañas arriba (Inventario y Equipamiento) con paleta de tonos melocotón y marrón. El equipamiento es solo estructura; aún no se pueden equipar objetos.
- **Editor de skins (tecla M)** desactivado con `SKIN_EDITOR_ENABLED = false` en `GameClient.tsx`; el código se conserva.
- **Auth0:** `Auth0App.tsx` ahora pasa la sesión a la página de asignaciones (antes el botón de publicar no aparecía).

## 9. Limitaciones conocidas

- El juego solo usa los estados `idle` y `walk`. Los estados propios (por ejemplo, interactuar) se guardan y publican, pero nada los dispara todavía.
- El servidor guarda un solo `skinId` por jugador. La skin por parte (por ejemplo `crock_cabeza`) aún no se guarda ni se envía a los demás jugadores.
- Los NPCs y enemigos usan otro sistema (hojas de sprites con frames definidos en las plantillas de sala) y no pasan por el editor.
- Los spritesheets de skins (`game/avatar/avatarSprites.ts`) siguen siendo la base de la selección inicial, los colores y las vistas previas del menú.
- Cada vez que se republica, los clientes vuelven a descargar las animaciones; durante un instante puede verse el respaldo.

## 10. Plan de migración al sistema nuevo (pendiente)

Objetivo: que el sistema nuevo sea el oficial y retirar el antiguo sin romper el proyecto, tanto en local como desplegado.

| Fase | Qué se hace | Cambio visible |
|---|---|---|
| 0. Red de seguridad | Congelar las animaciones actuales (reposo y caminar, frente y espalda, más la asignación Default) como datos en el formato nuevo dentro de `packages/shared`. Fuente propuesta: exportar del editor las animaciones Idle, Walk, IdleBack y WalkBack, y verificar frame a frame contra el sistema antiguo. Requiere exportar e importar JSON en el editor. | No |
| 1. Resolución nueva | Orden: publicado en el servidor, paquete incluido, sistema antiguo como último recurso. Guardar la última configuración recibida en el navegador. | No |
| 2. Dependencias | Pasar al sistema nuevo la vista previa del inventario, el primer frame de una animación nueva en el editor y "la animación del juego" de la asignación (catálogo con animaciones predeterminadas de solo lectura). | No |
| 3. Interruptor | Variable de entorno de Vite para volver al sistema antiguo sin tocar código. | No |
| 4. Despliegue | Primero el servidor (solo agrega tablas y eventos), luego la web. Un admin importa y publica en el dominio de producción. | Sí, controlado |
| 5. Validación | Pruebas automáticas (conversión, deducción de partes, resolución de casillas) y lista manual en local y producción. | No |
| 6. Retirada | Tras una convivencia estable en producción: quitar `avatarAnimations` y los frames escritos a mano, `LayeredAvatar.tsx`, `useAvatarAnimationFrame.ts`, `idleBackLayerOrder`, el equipo antiguo y los archivos sin uso (`Chap/Escudo.svg`, `Chap/Espada.svg`, `Chap/Sombra_1.svg`, `characters/modular/`, el SVG de nombre irregular en `assets/`). | No |

Fuera de alcance: spritesheets de skins, NPCs y enemigos.

Riesgos y mitigación: diferencia visual al convertir (comparación frame a frame antes de retirar nada); servidor dormido en el plan gratuito de Render (paquete incluido y copia local); `VITE_GAME_SERVER_URL` mal configurada (el juego sigue con el paquete incluido y la consola lo señala); pérdida de animaciones hechas en un solo navegador (exportación).

## 11. Lista de comprobación manual

1. Reiniciar el game-server y confirmar en su consola que el esquema se validó.
2. En `/editor/animations`, comprobar que cada capa tiene "Parte del avatar".
3. En `/editor/assignments`, asignar Idle y Walk en Default, pulsar **Guardar** y luego **Publicar al servidor**; debe decir "Publicado".
4. En el juego, pulsar **P** y revisar la línea de estado; caminar en las 6 direcciones y quedarse quieto.
5. Con otra cuenta, comprobar que ve las mismas animaciones sin recargar.
6. Apagar el servidor y recargar: el juego debe seguir mostrando al personaje.
7. Abrir el inventario con **I** y revisar las dos pestañas.

## Medidas de contingencia

Si el sistema de animaciones falla, el juego sigue funcionando con las animaciones de respaldo (avatar anterior).

| Medida | Que hace | Donde |
| --- | --- | --- |
| Barrera de errores por avatar | Si dibujar un avatar animado lanza una excepcion, ese avatar vuelve al `LayeredAvatar` anterior y la escena no queda en blanco. Se reintenta al cambiar la animacion publicada. | `components/world/AvatarErrorBoundary.tsx`, usada en `WorldPlayer.tsx` |
| Tablas opcionales | Las tablas `avatar_animation_documents` y `avatar_animation_config` ahora estan en `schema.avatar-animations.sql` y se crean en un paso aparte. Si falla, el servidor arranca igual (tambien en produccion), registra el error y la funcion queda desactivada. | `db/client.ts` |
| Interruptor del servidor | `DISABLE_PUBLISHED_AVATAR_ANIMATIONS=true` hace que el servidor no entregue configuracion ni acepte publicaciones. Basta reiniciar el servidor. | `game-server/.env` |
| Interruptor del cliente | `VITE_DISABLE_PUBLISHED_AVATAR_ANIMATIONS=true` hace que el juego ignore las animaciones publicadas. Requiere reconstruir el sitio. | `web/.env` / variables de Vercel |

El estado se ve en el panel de depuracion (tecla P): "desactivadas en el servidor", "almacenamiento de animaciones no disponible" o "desactivadas (VITE_...)".

### Paquete por defecto y caché del navegador

- **Paquete incluido:** si existe `apps/web/src/game/avatar/defaultAnimationPack.json`, el juego lo carga de forma diferida y lo usa cuando no hay animaciones publicadas disponibles (servidor sin respuesta, error, nada publicado o tablas no disponibles). No se usa si algún interruptor de apagado está activo. Si el archivo no existe, se ignora sin error. Se genera con **Exportar paquete** en la pantalla de asignaciones (formato `social-sena-animation-pack`, versión 1).
- **Caché:** la última configuración y sus animaciones se guardan en `localStorage` (`social-sena-avatar-animations-cache-v1`). Al entrar se pinta desde la caché y se verifica con el servidor. El servidor devuelve una `version` de la configuración (cambia al publicar o restaurar); si coincide con la de la caché, no se vuelven a descargar las animaciones. Si el servidor dice que no hay nada publicado o que está desactivado, la caché se borra. Si el servidor no responde, se conserva.

### Historial de versiones y paquetes JSON

- Cada publicación de asignaciones guarda una copia (configuración + animaciones que usa) en `avatar_animation_history`, conservando las últimas 20. Si guardar la copia falla, la publicación igual se aplica.
- En la pantalla de asignaciones, **Historial** lista las versiones y **Restaurar** reescribe animaciones y configuración y avisa a todos los clientes. Solo administradores (validado en el servidor).
- **Exportar paquete** descarga el JSON desde lo guardado en el navegador. **Importar paquete** lo publica para todo el servidor (solo administradores).
- Eventos nuevos: `list_avatar_animation_history`, `restore_avatar_animation_version`.

### Modo de prueba del editor de niveles

El modo Test (boton de probar la sala) no abre conexion con el game-server, asi que el sistema de
animaciones se alimenta ahi con `enableLocalAnimationPreview()`: usa la configuracion publicada que
haya en la cache del navegador, si no el paquete incluido y, si tampoco hay, las animaciones guardadas
en este navegador (asignaciones de localStorage + animaciones de IndexedDB). El aviso inferior del modo
Test indica de donde salieron. Al salir del modo Test se descarta esa vista previa local, de modo que
no afecta a la conexion del juego.
