# Matriz de pruebas

| Área | Prueba | Estado inicial |
|---|---|---|
| Dart | `flutter analyze` | Verificado localmente: sin issues |
| Dominio | encode/decode de envelopes y errores | Verificado: tests Flutter pasan |
| Sesión | correlación, timeout, reconexión y deduplicación | Correlación/timeout cubiertos; reconexión E2E pendiente |
| WebSocket | handshake con token válido/inválido y pairing temporal | Verificado: 8 tests Python + proceso real con token de pairing |
| SSH | túnel, fingerprint, caída y cierre | Implementado con `dartssh2`; prueba con OpenSSH real pendiente |
| UI | targets táctiles, lector de pantalla, reduced motion | Pendiente en dispositivo |
| Seguridad | no filtrar tokens en logs/telemetría | Pendiente de instrumentación |
| E2E | móvil → SSH/relay → desktop → agente → móvil | Verificado localmente con procesos reales vía Relay; dispositivo físico/TLS pendientes |

Resultados de esta iteración (23-10-2026): `flutter analyze` sin issues,
`flutter test` 4/4, `flutter build web --release` correcto (con advertencias de
Wasm de `flutter_secure_storage_web`), typecheck y 41 tests de Desktop correctos,
9 tests de Relay/auth Python correctos, smoke `PAIRING_WS_OK` por WebSocket local
y smoke `RELAY_E2E_OK` con Relay + Desktop + agente. El APK local no se pudo
compilar porque esta máquina no tiene Android SDK.

La existencia de los tests del agente/desktop no demuestra paridad móvil. Cada resultado deberá separar simulador, dispositivo físico, red local, túnel SSH y relay.
