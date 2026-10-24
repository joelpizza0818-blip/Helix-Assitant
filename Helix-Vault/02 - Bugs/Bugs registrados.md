# Bugs registrados — HELIX

## BUG-001: "Conectando" infinito en Mobile tras pegar token de invitación

**Severidad**: Alta  
**Componente**: Mobile (`movil/lib/core/transport/websocket_transport.dart`)  
**Reportado**: 23 Oct 2026  
**Estado**: ✅ Fix implementado

### Síntoma
Al pegar el token de invitación en el `_ConnectionSheet` del mobile y pulsar "Abrir sesión segura", el pill de conexión queda en "● Conectando" indefinidamente. La UI no responde y no hay mensaje de error.

### Causa raíz
```dart
// websocket_transport.dart — línea problemática
await channel.ready; // ← Sin timeout. Si el relay no responde, cuelga para siempre.
```
El `Future` `channel.ready` nunca completa si:
- El relay Tailscale no está levantado
- La URL WSS es incorrecta
- Red bloqueada

`_connecting` queda en `true` y no hay catch que lo limpie porque el await nunca termina.

### Fix aplicado
```dart
await channel.ready.timeout(
  const Duration(seconds: 12),
  onTimeout: () => throw TimeoutException('HELIX relay did not respond within 12 seconds'),
);
```

Además, en `_toggleConnection` el catch ahora muestra mensaje descriptivo en la UI durante 6 segundos.

### Archivos modificados
- `movil/lib/core/transport/websocket_transport.dart` — timeout en `channel.ready`
- `movil/lib/features/chat/chat_screen.dart` — error display en `_buildComposer`

---

## BUG-002: Suscripción de email falla en producción

**Severidad**: Alta  
**Componente**: Landing (`apps/landing/api/updates/subscribe.ts`, `vercel.json`)  
**Reportado**: 23 Oct 2026  
**Estado**: ✅ Fix implementado (pendiente verificación en Vercel)

### Síntoma
Al introducir email y pulsar "Subscribe" en la página de Features, aparece:
> "Could not reach the subscription service. Please try again later."

### Causas raíz (múltiples)

1. **`vercel.json` incorrecto**: solo tenía `rewrites` con `/(.*) → /index.html`, lo que intercepta también `/api/updates/subscribe` y devuelve el HTML de la SPA en lugar de ejecutar la serverless function.

2. **CORS hardcodeado**: `ALLOWED_ORIGIN = 'https://helix-assistant.vercel.app'` falla en preview deployments de Vercel (URLs como `helix-assistant-abc123.vercel.app`).

3. **Variables de entorno no configuradas**: `VITE_SUPABASE_URL` y `VITE_SUPABASE_ANON_KEY` pueden no estar en el dashboard de Vercel (solo en `.env` local).

### Fixes aplicados

**`vercel.json`**: ahora tiene `routes` que priorizan `/api/` antes del fallback SPA.

**`api/updates/subscribe.ts`**: 
- CORS aceptaelegantement preview URLs de Vercel
- Lee `SUPABASE_URL` y `SUPABASE_SERVICE_ROLE_KEY` además de las vars `VITE_*`
- Mensaje de error más descriptivo cuando no hay storage configurado

### Acción pendiente
- Añadir en Vercel dashboard (Environment Variables):
  - `VITE_SUPABASE_URL` = URL del proyecto Supabase
  - `VITE_SUPABASE_ANON_KEY` = clave anon de Supabase
  - (Opcional) `SUPABASE_SERVICE_ROLE_KEY` = clave service role para más permisos

---

## BUG-003: Control del navegador limitado a lectura

**Severidad**: Media  
**Componente**: Extension del navegador / Agent  
**Reportado**: 23 Oct 2026  
**Estado**: 🔴 Abierto — no implementado

### Síntoma
Helix puede ver y leer el contenido del navegador (vía extensión o captura de pantalla), pero no puede hacer click, scroll, rellenar formularios ni navegar activamente.

### Impacto
- No puede completar tareas web autónomas
- El usuario tiene que hacer manualmente las acciones web

### Solución propuesta
Implementar control real del navegador via:
1. **Playwright** (Python) corriendo en Desktop — permite control headful del navegador real
2. **CDP (Chrome DevTools Protocol)** — conectarse al navegador ya abierto del usuario
3. **Extensión + mensaje nativo** — la extensión recibe comandos del agente y los ejecuta

La opción más viable a corto plazo: CDP conectándose al Chrome/Edge del usuario con `--remote-debugging-port=9222`.
