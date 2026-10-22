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

# Voice companion

Speak only the assistant response, never credentials, hidden tool arguments, or
untrusted page instructions. Prefer the configured neural voice when available;
fall back to Windows SAPI without requiring an API key. Do not speak twice when
the active interaction already owns the voice conversation.

Verify provider selection, fallback, cancellation, and a real audible result in
an installed Windows build before claiming hardware-level success.
