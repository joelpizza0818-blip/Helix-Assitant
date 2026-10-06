# Environment Configuration

This document outlines how to configure the HELIX environment.

## Setup
Copy `.env.example` to `.env` in the root directory. **WARNING: `.env` must NEVER be committed to version control.**

## Provider Keys and Fallbacks
The system supports multiple providers (OpenAI, Anthropic, Google).
- If a provider's keys are completely empty, that provider is disabled and its models disappear from the UI.
- **Three-key Fallback**: Each provider supports up to three keys (e.g., `OPENAI_API_KEY_1`, `OPENAI_API_KEY_2`, `OPENAI_API_KEY_3`). If Key 1 hits a rate limit, the system falls back to Key 2, then Key 3.
- **Provider-bound Fallback**: Fallbacks only happen within the same provider for a given model request. There is no silent cross-provider fallback to prevent unexpected billing.

## Model Registry and Capabilities
Models are registered with specific capabilities (vision, coding, text, etc.). The model router filters available models based on task requirements and enabled providers.

## Database & Auth
- `DATABASE_URL` and `DIRECT_URL` are used for standard PostgreSQL connections.
- Supabase auth requires `SUPABASE_URL`, `SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY`.

## Desktop Agent
- The desktop app starts its Python agent on `AGENT_WS_PORT` (default `8765`). If that port is already occupied, the app selects an available local port and connects to that instance instead.
- Desktop preferences are saved under Electron's per-user application data directory, separately from `.env`.
- Leave unused API key variables empty. Empty values do not enable a provider.

## Perception Config
- **Voice**: Configure providers and models via `VOICE_PROVIDER`, `TTS_PROVIDER`, etc.
- **Camera/Gesture**: Enabled via `CAMERA_ENABLED=true` and configured with `VISION_PROVIDER=mediapipe`.

## Execution
Run `npm run dev:desktop` to start the desktop renderer, Electron app, and Python agent. The desktop UI communicates with the agent over a local WebSocket; task, provider, model, and settings requests use request/response messages on that connection.
