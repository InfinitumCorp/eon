# E(O)N™ MIL device stack (planned)

The wearable and its companion app do not exist yet. This repo is the exercise backend: a TypeScript Cloudflare Worker with no Python, Go, C, React Native or Swift code. Nothing below is a dependency of this repo, so none of it is in a `THIRD_PARTY_NOTICES.md` here.

When the device or app repo starts, use these as dependencies (not copied code). Add each one's license text, and its NOTICE file where it has one, to that repo's `THIRD_PARTY_NOTICES.md` at the same time.

Candidates come from the OSS reuse survey in InfinitumCorp/RULES (`reports/oss-reuse.md`). Licenses were checked against each GitHub repository on 2026-11-07.

| Need | Candidate | License | NOTICE | Notes |
|---|---|---|---|---|
| Private speech-to-text on the device | `openai/whisper` (pip `openai-whisper`) | MIT (code and weights) | none | Small or turbo model, run locally. Audio stays on the device. |
| Wearable voice loop on a microcontroller | `openai/openai-realtime-embedded` | MIT | none | Reference for the ESP32-class loop only. |
| Fully open voice pipeline (VAD → STT → LLM → TTS) | `huggingface/speech-to-speech` | Apache-2.0 | none | Check every model checkpoint's own license before use. |
| Text-to-speech | `huggingface/parler-tts` | Apache-2.0 | none | Check the checkpoint license. Disclose synthetic speech to the listener. |
| Voice over narrow links | `facebookresearch/encodec` | MIT | none | Low-bitrate codec for the team link. |
| Small crypto on the device | `teslamotors/liblithium` | Apache-2.0 | **NOTICE** | Gimli and X25519. Keep its NOTICE. Independent crypto review before shipping. |
| Pairing and signed commands, wearable ↔ phone | `teslamotors/vehicle-command` (Go `pkg/protocol`, `pkg/sign`) | Apache-2.0 | none | A model for authenticated BLE pairing and signed commands. Write our own schema; do not reuse Tesla's vehicle protobufs. |
| On-device language model | `microsoft/BitNet` (bitnet.cpp) | MIT | none | 1-bit inference on the edge. |
| Companion app UI (React Native) | `Shopify/restyle` | MIT | none | Themed components to BUILD_RULES tokens. |
| Companion app crypto (iOS) | `apple/swift-crypto` | Apache-2.0 | **NOTICE.txt** | Keep its NOTICE. |

## Not used

- `microsoft/VibeVoice`: no voice cloning. Its repository is MIT, but the survey flags misuse restrictions on its voice models, and cloning a person's voice has no place in this product.

## Rules that carry over

- Device-integrity checks (root, debugger, hooking, emulator) run on the device and share only the result, as the exercise does today (`src/lib/eon/integrity.ts`).
- Synthetic speech is always disclosed.
- Treat local clones of these repositories as untrusted input: build from pinned releases, not from a working copy.
- No pricing, no data sale, private ledger.

## Backend note

The survey describes the stack as a Cloudflare domain with a Supabase backend. E(O)N's backend is a Cloudflare Worker with one Durable Object (see the main README), and that stays the source of truth for the exercise. Any Supabase use for the device or app is a separate decision.
