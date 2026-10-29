# HELIX Cloudflare Mobile Relay

This Worker uses one SQLite-backed Durable Object per randomly generated
Desktop room. The free Cloudflare tier is suitable for a low-volume pilot, not
an uptime or cost guarantee. Review current quotas and billing before inviting
users; this service does not deploy itself when HELIX Desktop is installed.

## Local development and tests

From the repository root:

```powershell
npm install
npm run build --workspace=@helix/relay-worker
npm run test:relay-worker
npm run dev:relay-worker
```

The build type-checks the Worker and runs Wrangler's local dry-run bundle
without deploying it.

The local Worker exposes `/health`. Configure the public `https://` Worker
origin in HELIX Desktop; Desktop and Mobile derive the room-specific REST and
WSS endpoints from it.

## Deploying your own relay

Create a Cloudflare account, authenticate Wrangler, then run:

```powershell
npx wrangler login
npm run deploy:relay-worker
```

The Worker endpoint is specific to the deploying account. HELIX does not ship a
shared relay URL, account credential, or Cloudflare API token. Keep Wrangler
credentials out of the repository and configure deployments through the
operator's Cloudflare account.

## Protocol and security

- Desktop creates a random room ID and an independent, persistent owner
  credential. Only its SHA-256 digest is stored by the Durable Object.
- Pairing invitations are single-use, expire after five minutes, and only
  create a pending request. Desktop must approve the request.
- Approval issues a unique mobile token; only its digest is stored. Desktop
  can list and revoke each device.
- Mobile can send `USER_TEXT` and a narrowly validated
  `CONFIRMATION_RESPONSE` for a pending request. Desktop events are limited to
  agent messages, status, task updates, permission requests/resolutions, and
  errors. The relay is not an execution engine or a replacement for Desktop
  authorization.
- WebSockets use Durable Object hibernation. Secrets are sent only in
  Authorization headers over HTTPS/WSS; no tokens are placed in URLs.

The Cloudflare Worker and the optional self-hosted Tailscale relay must follow
the same protocol and message allowlist. A configured Worker endpoint is not
proof that it has been deployed or is publicly reachable.
