# Environment Configuration

This document outlines how to configure the HELIX environment.

## Setup
Copy `.env.example` to `.env` in the root directory. The Python agent loads that root file regardless of its working directory. **WARNING: `.env` must NEVER be committed to version control.**

## Provider Keys and Fallbacks
The system supports multiple providers (OpenAI, Anthropic, Google).
- If a provider's keys are completely empty, that provider is disabled and its models disappear from the UI.
- **Three-key Fallback**: Each provider supports up to three keys (e.g., `OPENAI_API_KEY_1`, `OPENAI_API_KEY_2`, `OPENAI_API_KEY_3`). If Key 1 hits a rate limit, the system falls back to Key 2, then Key 3.
- **Provider fallback**: The configured/preferred provider and model are tried first. After eligible keys/models are exhausted, fallback may use another configured provider only when one of its models satisfies every required capability. Unconfigured providers are never candidates. Cross-provider fallback can incur charges with another provider.
- **Runtime model failures**: A confirmed `MODEL_UNAVAILABLE` response (HTTP 404) excludes that provider/model from routing for the rest of the agent process. `QUOTA_EXCEEDED` and `BILLING_EXHAUSTED` do not remove models from the registry: quota errors skip that provider/model for the rest of the current ReAct execution, while billing errors skip that key for the rest of the execution. The key remains available in later executions; rate limits still apply the key's normal cooldown.

## Model Registry and Capabilities
Models are registered with specific capabilities (vision, coding, text, etc.). The model router filters available models based on task requirements and enabled providers. The current agent registry uses Claude Sonnet 5.5 / Opus 5.5 / Haiku 4.5 and Gemini 2.5 Flash / Flash-Lite / Pro; provider availability, account access, and quota still depend on the configured API key. Check the [Anthropic model list](https://platform.claude.com/docs/en/models/overview) and [Gemini model list](https://ai.google.dev/gemini-api/docs/models) when refreshing these IDs.

## Database & Auth
- `DATABASE_URL` and `DIRECT_URL` are used for standard PostgreSQL connections.
- Supabase auth requires `SUPABASE_URL`, `SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY`.

## Desktop Agent
- The desktop app starts its Python agent on `AGENT_WS_PORT` (default `8765`). If that port is already occupied, the app selects an available local port and connects to that instance instead.
- Desktop preferences are saved under Electron's per-user application data directory, separately from `.env`.
- Leave unused API key variables empty. Empty values do not enable a provider.

## Perception Config
- **Voice**: `STT_PROVIDER=whisper_local` and `STT_MODEL=base` enable local speech recognition without an API key. The local backend uses faster-whisper on CPU with int8 quantization and preloads the model in the background after the wake-word listener starts. The first run downloads the model to the local cache; later starts still load it into memory in the background. HELIX's captured audio is 16 kHz mono PCM WAV and is passed directly to the model without FFmpeg. Other audio formats are decoded through PyAV (`av>=11,<19`). If faster-whisper is unavailable but openai-whisper is installed, HELIX logs a warning and uses that slower backend instead. `TTS_PROVIDER=system` uses the local Windows speech engine. After each spoken reply, HELIX listens for a follow-up for up to 10 seconds; after that, say the wake phrase again. Audio recognition and playback do not incur API charges; the conversation's language-model provider still uses the key configured for HELIX.
- **Camera/Gesture**: Enabled via `CAMERA_ENABLED=true` and configured with `CAMERA_DEVICE_INDEX`, `GESTURE_SENSITIVITY`, and `VISION_PROVIDER=mediapipe`. Gesture events require confidence at or above `GESTURE_CONFIDENCE_THRESHOLD` for `GESTURE_STABILITY_FRAMES` consecutive frames, then use `GESTURE_COOLDOWN_SECONDS`; defaults are 0.8, 4 frames, and 2 seconds. Context-sensitive gestures are ignored unless the corresponding task, confirmation, or voice interaction is active. When enabled, the Python agent starts `GestureEngine`, which captures camera frames locally and publishes recognized gesture events. The selected camera must be available and OpenCV/MediaPipe must be installed in the agent environment. The bundled `services/agent/models/gesture/hand_landmarker.task` supports MediaPipe's current Tasks API; older MediaPipe versions that provide `solutions.hands` use that API. The model is from [MediaPipe's official model collection](https://ai.google.dev/edge/mediapipe/solutions/vision/hand_landmarker) and is distributed under the [MediaPipe license](https://github.com/google-ai-edge/mediapipe/blob/master/LICENSE). Camera and gesture preferences saved in the desktop settings take precedence over `.env`.
- **VAD**: `webrtcvad` is optional; HELIX logs the import failure and continues with its existing energy-threshold fallback.
- **Wake word**: `WAKE_WORD_PROVIDER=openwakeword` selects OpenWakeWord. The custom phrase `WAKE_WORD="hey helix"` needs a matching ONNX classifier at `WAKE_WORD_MODEL_PATH` (default: `services/agent/models/wakeword/hey_helix.onnx`). Voice activation starts only when this file exists; no built-in OpenWakeWord model recognizes “Hey Helix”. See the [Hey Helix model training guide](./WAKE_WORD_TRAINING.md) to generate and install it. The official automated training workflow currently supports Linux, not native Windows.

## Execution
Run `npm run dev:desktop` to start the desktop renderer, Electron app, and Python agent. The desktop UI communicates with the agent over a local WebSocket; task, provider, model, and settings requests use request/response messages on that connection.
