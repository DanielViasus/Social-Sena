# Deploy de Social Sena en Vercel + Railway

## Arquitectura recomendada

- `apps/web` se despliega en Vercel
- `apps/game-server` se despliega en Railway
- `packages/shared` se compila como dependencia compartida del monorepo

## Variables del frontend en Vercel

- `VITE_AUTH0_DOMAIN`
- `VITE_AUTH0_CLIENT_ID`
- `VITE_AUTH0_CALLBACK_URL=/`
- `VITE_GAME_SERVER_URL=https://TU-BACKEND.up.railway.app`

## Variables del backend en Railway

- `PORT=3001`
- `CORS_ALLOWED_ORIGINS=http://localhost:5173,https://TU-FRONTEND.vercel.app`

## Root directories

- Vercel: `apps/web`
- Railway: usar la raiz del repositorio porque este backend depende de `packages/shared`

## Archivos de soporte

- `apps/web/vercel.json`
- `railway.json`
- `apps/web/.env.example`
- `apps/game-server/.env.example`

## Flujo recomendado

1. Hacer push del repositorio a GitHub
2. Crear proyecto en Railway apuntando al repo completo
3. Configurar variables del backend y generar dominio publico
4. Crear proyecto en Vercel apuntando al repo y al directorio `apps/web`
5. Configurar variables del frontend usando el dominio publico de Railway
6. Actualizar Auth0 con URLs de callback, logout y web origins para localhost y produccion
