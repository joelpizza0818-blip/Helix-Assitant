# Estado actual — HELIX (23 Oct 2026)

## ✅ Funcional / Verificado

- **Relay WSS via Tailscale Funnel**: `wss://desktop-7hrsa16.taild4cce1.ts.net` — E2E OK probado en Desktop.
- **Relay Python** (`services/relay/server.py`): servidor WebSocket autenticado con rooms por token. 9/9 tests pasando.
- **Lanzador automático** (`scripts/start-relay.ps1`): detecta Tailscale Funnel → Cloudflare → SSH/TLS.
- **Desktop typecheck**: correcto (sin errores TS).
- **App Mobile (Flutter)**: compila, corre en web (`localhost:53347`). UI funcional con modo Chat/Voice y modo relay.
- **Landing**: desplegada en Vercel. Secciones: Hero, Features, Download, Subscribe.
- **CLI**: publicado en npm como `helix-assistant-cli`.

## ⚠️ Parcialmente funcional / Problemas conocidos

### Bug: "Conectando" infinito en Mobile
- **Síntoma**: al pegar el token de invitación y pulsar "Conectar", el pill queda en "Conectando" indefinidamente.
- **Causa raíz**: `websocket_transport.dart` hace `await channel.ready` sin timeout. Si el relay no responde, el `Future` nunca completa y `_connecting` queda en `true`.
- **Fix aplicado**: wrapping `channel.ready` con `.timeout(Duration(seconds: 12))` + manejo de `TimeoutException` en `_toggleConnection`. Error visible en UI con mensaje descriptivo.
- **Estado**: fix implementado, pendiente prueba en dispositivo físico.

### Bug: Suscripción de email no funciona en producción
- **Síntoma**: "Could not reach the subscription service. Please try again later."
- **Causa raíz 1**: `vercel.json` redirigía `/api/*` a `index.html` en lugar de las funciones serverless.
- **Causa raíz 2**: CORS solo permitía `https://helix-assistant.vercel.app` exacto (falla en preview deployments).
- **Causa raíz 3**: Variables de entorno Supabase pueden no estar configuradas en Vercel.
- **Fix aplicado**: 
  - `vercel.json` ahora tiene `routes` separados para `/api/` y el fallback SPA.
  - `api/updates/subscribe.ts` ahora acepta preview URLs de Vercel y tiene fallback de error descriptivo.
  - Variables requeridas en Vercel: `VITE_SUPABASE_URL` + `VITE_SUPABASE_ANON_KEY` (o `SUPABASE_SERVICE_ROLE_KEY`).
- **Pendiente**: verificar que las env vars están configuradas en el dashboard de Vercel.

## ❌ No implementado / Pendiente

- **APK Mobile**: no hay release publicado con tag `mobile-vX.X.X` en GitHub. La landing ya tiene la infraestructura para detectarlo automáticamente (función `getLatestMobileRelease` en `downloads.ts`).
- **Control del navegador en tiempo real**: Helix actualmente solo puede ver/leer páginas web. Pendiente implementar control remoto real (click, scroll, fill forms) con Playwright o CDP.
- **Notificaciones Nodemailer**: el endpoint actual usa Supabase (almacenamiento), no Nodemailer. La entrega de emails de notificación de releases no está implementada.
- **Prueba Desktop↔Mobile en dispositivo físico**: solo probado en desktop con relay Tailscale.

## 🔧 En progreso (esta sesión)

- [x] Rediseño UI Mobile estilo ChatGPT con colores HELIX (limpieza de layout chatbot, eliminación de botón de ajustes y tabs redundantes)
- [x] Fix bug "Conectando" infinito
- [x] Vault de Obsidian inicializado y documentado
- [x] Arquitectura de control de navegador activo en tiempo real (CDP + Playwright)
- [ ] Publicación del APK en GitHub Releases
- [ ] Configuración final de env vars en Vercel para Suscripciones
