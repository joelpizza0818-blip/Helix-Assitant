---
name: voice-companion
description: Speak HELIX responses with an elegant multilingual voice and a local Windows fallback.
version: 1.0.0
triggers:
  - speak response
  - voice companion
  - read aloud
tools: []
permissions:
  - audio_output
dependencies: []
---

Speak only the assistant response. Prefer the configured neural voice and fall
back to Windows SAPI without requiring an API key. Do not speak twice when the
active interaction already owns the voice conversation.
