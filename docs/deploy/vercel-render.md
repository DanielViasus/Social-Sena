# Deploy de Social Sena en Vercel + Render

## Arquitectura recomendada

- `apps/web` se despliega en Vercel
- `apps/game-server` se despliega en Render
- `packages/shared` se compila como dependencia compartida del monorepo

## Como funciona el plan gratis de Render

- El backend gratis entra en reposo si pasa 15 minutos sin trafico
- No se rompe ni se pierde el deploy
- Cuando alguien vuelve a abrir la app, Render lo vuelve a iniciar
- Ese arranque puede tardar hasta 1 minuto
- Durante ese primer arranque, la pagina puede quedarse cargando un momento
- Despues de despertar, el servicio vuelve a funcionar normal

## Que significa eso para Social Sena

- Si abres la app despues de horas o dias sin usarla, el primer intento puede tardar
- No necesitas redeploy manual
- No necesitas tocar botones para revivir el servicio
- Solo debes esperar a que Render levante el backend otra vez
- Una vez despierta, la app vuelve a responder normal

## Variables del frontend en Vercel

- `VITE_AUTH0_DOMAIN`
- `VITE_AUTH0_CLIENT_ID`
- `VITE_AUTH0_CALLBACK_URL=/`
- `VITE_GAME_SERVER_URL=https://TU-BACKEND.onrender.com`

## Variables del backend en Render

- `CORS_ALLOWED_ORIGINS=http://localhost:5173,https://TU-FRONTEND.vercel.app,https://*.vercel.app`

## Archivos de soporte

- `apps/web/vercel.json`
- `render.yaml`
- `apps/web/.env.example`
- `apps/game-server/.env.example`

## Flujo recomendado

1. Hacer push del repositorio a GitHub
2. Crear un Blueprint o Web Service en Render usando `render.yaml`
3. Esperar a que Render publique el dominio del backend
4. Crear el proyecto del frontend en Vercel con `Root Directory = apps/web`
5. Configurar `VITE_GAME_SERVER_URL` en Vercel con el dominio de Render
6. Actualizar Auth0 con URLs locales y de produccion

## Auth0

Agrega como minimo estas URLs:

- `Allowed Callback URLs`: `http://localhost:5173,https://TU-FRONTEND.vercel.app`
- `Allowed Logout URLs`: `http://localhost:5173,https://TU-FRONTEND.vercel.app`
- `Allowed Web Origins`: `http://localhost:5173,https://TU-FRONTEND.vercel.app`

Si luego usas preview deployments de Vercel, puedes mantener `Allowed Web Origins` mas estricto y trabajar primero con el dominio principal de produccion.
