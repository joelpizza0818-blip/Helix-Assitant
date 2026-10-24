# Tareas pendientes — HELIX

## 🔴 Alta prioridad

- [ ] **Publicar APK Android** — Crear release en GitHub con tag `mobile-vX.X.X` y assets `HELIX-Mobile.apk` + `HELIX-Mobile.apk.sha256`. La landing ya detecta releases automáticamente.
- [ ] **Configurar env vars en Vercel** — Añadir `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` en el dashboard de Vercel para que el subscribe funcione.
- [ ] **Probar conexión Mobile en dispositivo físico** — Verificar que el fix del timeout resuelve el "Conectando" infinito en Android/iOS real.
- [ ] **Implementar entrega de emails (Nodemailer)** — El subscribe solo guarda en Supabase. Faltan los emails de notificación cuando hay nuevo release.

## 🟡 Media prioridad

- [ ] **Control de navegador en tiempo real** — Helix solo ve/lee páginas. Implementar clicks, scroll, fill via Playwright/CDP en el agente Python y exponerlo al desktop/mobile.
- [ ] **Landing: sección APK prominente** — Mientras no haya release, mostrar un "Coming Soon" visual más atractivo para el APK.
- [ ] **Mobile: pruebas de integración** — Test E2E del flujo token → relay → chat en dispositivo real.
- [ ] **Optimizar tiempo de conexión del relay** — Actualmente puede tardar hasta 12s en timeout. Si el relay está caído, mostrar diagnóstico más útil.

## 🟢 Baja prioridad / Mejoras

- [ ] **Modo offline del Mobile** — Mostrar historial de conversación guardado sin conexión activa.
- [ ] **Push notifications** — Notificar al móvil cuando Helix Desktop completa una tarea larga.
- [ ] **Biometría en Mobile** — FaceID/huella para proteger el token almacenado.
- [ ] **Dark/light theme en Landing** — Actualmente solo dark.
- [ ] **macOS y Linux installer** — Solo Windows actualmente.

## ✅ Completadas recientemente

- [x] Tailscale Funnel configurado y probado (`wss://desktop-7hrsa16.taild4cce1.ts.net`)
- [x] E2E Desktop↔Mobile: `AUTO_TAILSCALE_FUNNEL_E2E_OK`
- [x] Lanzador automático `scripts/start-relay.ps1` con fallback SSH/Cloudflare
- [x] Relay Python: 9/9 tests pasando
- [x] Vault de Obsidian inicializado
- [x] UI Mobile rediseñada (estilo ChatGPT + colores HELIX)
- [x] Limpieza de UI disfuncional en Mobile (eliminado botón de ajustes, removido tab switch redundante, scroll automático al enviar, barra de chat reactiva)
- [x] Documentación de Arquitectura de Navegación Activa en tiempo real (CDP + Playwright)
- [x] Documentación de Navegación Aislada con Cursor Virtual y Cero Interrupción (Ghost Pointer + Background Execution)
- [ ] Implementación de inyección de cursor virtual (`virtual_cursor.py`) y streaming de viewport hacia la app móvil
- [x] Fix timeout "Conectando" infinito en WebSocketTransport
- [x] Fix `vercel.json` para routing correcto de API serverless
- [x] Fix CORS en `subscribe.ts` para preview deployments
