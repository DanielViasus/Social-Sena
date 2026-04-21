# Social Sena

Base tecnica inicial para el MVP multijugador de Social Sena.

## Estructura

```text
apps/
  web/            Cliente React + Vite
  game-server/    Servidor realtime con Socket.IO
packages/
  shared/         Tipos, eventos y contratos compartidos
_docs/            Documentacion funcional original
docs/             Documentacion tecnica nueva
```

## Scripts principales

- `npm run dev`
- `npm run dev:web`
- `npm run dev:server`
- `npm run dev:full`
- `npm run build`
- `npm run lint`
- `npm run typecheck`

`build` genera el frontend y valida que `game-server` y `shared` sigan tipados correctamente.

`npm run dev` abre el cliente web local en `http://localhost:5173`.
`npm run dev:full` levanta backend y frontend en paralelo para pruebas locales completas.

## Auth0 y deploy

- El frontend lee `VITE_AUTH0_DOMAIN`, `VITE_AUTH0_CLIENT_ID`, `VITE_AUTH0_CALLBACK_URL` y `VITE_GAME_SERVER_URL`
- El backend lee `PORT` y `CORS_ALLOWED_ORIGINS`
- Hay un ejemplo base en `apps/web/.env.example`
- Hay un ejemplo base del backend en `apps/game-server/.env.example`
- Para Vercel, configura el proyecto con `Root Directory = apps/web`
- Para Render, usa `render.yaml` en la raiz del repositorio para desplegar el backend del monorepo
- `apps/web/vercel.json` deja listas las rutas SPA como `/Room_1909`
- `render.yaml` deja listo el arranque y healthcheck del backend en Render
- El frontend puede desplegarse en Vercel, pero el backend actual usa Socket.IO/WebSockets y debe desplegarse aparte
- En Render Free, el backend entra en reposo tras 15 minutos sin trafico y puede tardar hasta 1 minuto en despertar
- En Auth0 debes agregar tanto `http://localhost:5173/` como tu dominio de Vercel en:
- `Allowed Callback URLs`
- `Allowed Logout URLs`
- `Allowed Web Origins`
- Guia paso a paso recomendada: `docs/deploy/vercel-render.md`

## Objetivo de esta base

Esta primera fundacion deja listo el proyecto para iterar sobre el slice inicial del MVP:

- conexion cliente-servidor
- ingreso a sala
- presencia basica
- movimiento sincronizado por click en el mundo
- chat de sala

## Proximo paso recomendado

Instalar dependencias y probar dos clientes conectados contra el servidor local.
