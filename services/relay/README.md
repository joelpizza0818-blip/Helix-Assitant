# HELIX Mobile Relay

This service is a transport-only WebSocket bridge. It joins one HELIX Desktop
connector with one or more HELIX Mobile clients that present the same temporary
pairing token. It never runs tools, stores prompts, or exposes the Desktop
agent's loopback port.

## Local run

From the repository root, with the agent virtual environment active:

```powershell
$env:HELIX_RELAY_HOST = "127.0.0.1"
$env:HELIX_RELAY_PORT = "8787"
\.venv\Scripts\python.exe -m services.relay.server
```

For a deployed endpoint, put the process behind TLS and use `wss://`; the
mobile client must receive that URL in the Toolbox invitation through
`HELIX_MOBILE_RELAY_WSS_URL`.

## Container deployment

The repository includes `services/relay/Dockerfile` for a minimal stateless
container. Build and run it behind an existing TLS reverse proxy:

```powershell
docker build -f services/relay/Dockerfile -t helix-relay .
docker run --rm -p 8787:8787 helix-relay
```

The container intentionally does not terminate TLS. Configure the proxy to
forward `/` as WebSocket traffic, apply connection/rate limits, and expose the
result as `wss://...` before putting that URL into Desktop Toolbox.

## Relay gratis para pruebas: Cloudflare Quick Tunnel

La opción predeterminada de `start-relay.ps1` usa Cloudflare Quick Tunnel. No
requiere cuenta Cloudflare, dominio, servidor propio ni pago:

```powershell
.\scripts\start-relay.ps1
```

El script descarga `cloudflared` desde su publicación oficial si hace falta,
inicia el relay local y obtiene una URL WSS `*.trycloudflare.com`. La máquina
Desktop debe permanecer encendida, conectada y con ambas ventanas/procesos
activos. La URL cambia al reiniciar el túnel. Cualquier persona que conozca esa
URL puede alcanzar el endpoint. El pairing actual reutiliza el mismo token para
Desktop y móvil; el rol se declara en un header, y todavía no hay permisos por
dispositivo. No compartas el token ni uses datos sensibles o dispositivos no
confiables. El script pide confirmación explícita antes de abrir el túnel.

Cloudflare documenta Quick Tunnels como herramienta de pruebas/desarrollo, sin
garantía de uptime y con un límite de 200 solicitudes en vuelo. No es un relay
permanente ni una promesa de disponibilidad de producto. Ver
https://developers.cloudflare.com/tunnel/get-started/quick-tunnels/.

Puedes elegir otros proveedores explícitamente:

```powershell
.\scripts\start-relay.ps1 -Provider Ssh
.\scripts\start-relay.ps1 -Provider Cloudflare
```

`Cloudflare` usa el mismo Quick Tunnel directo:

```powershell
.\scripts\start-relay-quick-tunnel.ps1
```

La URL se guarda temporalmente en `.helix-relay-url.json` y se puede pegar en
Toolbox > Mobile Link. Para producción, detener esta opción y evaluar un
servicio con disponibilidad/operación adecuadas y coste aprobado; no reutilizar
la URL efímera en anuncios, releases o configuración compartida.

## Desktop connector

When `HELIX_MOBILE_RELAY_WSS_URL` is set, the Desktop agent watches its
`HELIX_WS_PAIRING_FILE`, registers the active pairing token with the relay, and
forwards messages to its authenticated local agent WebSocket. Rotating the
pairing file closes the old connector.

## Security boundaries

- Pairing tokens expire and are rotated by Desktop.
- The current pairing token is shared by Desktop and Mobile; the role is
  asserted in a request header, not proven by a separate Desktop credential.
- Per-device permissions and revocation are not implemented. Use this only
  with trusted personal devices and non-sensitive test data.
- Expired rooms are rejected with a private WebSocket close code.
- Production deployment must provide TLS, network rate limiting and log
  redaction at the edge.

## Alternativa temporal: localhost.run por SSH

Windows ya incluye OpenSSH. La opción más ligera para una sesión temporal es:

```powershell
.\scripts\start-relay-ssh-tunnel.ps1
```

El script inicia el Relay y ejecuta `ssh -R` contra `localhost.run`; el servicio
entrega una URL `https://*.lhr.life` con terminación TLS, que se transforma en
`wss://` para HELIX. Guarda la URL en `.helix-relay-url.json`, la muestra en
pantalla y la mantiene activa mientras la ventana permanezca abierta. No se
requiere cuenta ni dominio, pero la URL es efímera y depende de la disponibilidad
de localhost.run.
