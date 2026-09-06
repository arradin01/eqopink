# Sasha Band — PRD

## Overview
Sasha Band is a pink, girly companion mobile app for a wearable wristband
(Seeed Studio XIAO ESP32-C3). It is a copy of the uploaded "EQOband" app with
the AI assistant and all voice features removed, re-themed in soft light pink
with rose/magenta accents, and personalised for the demo user
**Sasha Giyu Bau Hasem**. Bilingual (English + Bahasa Indonesia) is kept.

## Original problem statement
"Build a mobile app: like this [uploaded EQOband zip] but remove the AI and
make the color theme pink and girly, then make the user demo name to
Sasha Giyu Bau Hasem."

## User choices (from clarification)
- Remove the EQO AI chat tab completely → 4 tabs.
- Remove all voice/AI features (mic, TTS, STT, talkback, volume).
- Theme: soft light pink background with rose/magenta accents (+ pink-accented dark mode).
- Demo name in Settings profile AND as a greeting on Health.
- Keep bilingual English / Indonesian.

## Tech Stack
- Frontend: Expo SDK 57, React Native, expo-router (single route + custom bottom tab bar),
  @expo/vector-icons (MaterialCommunityIcons), expo-linear-gradient, react-native-ble-plx (native builds only).
- Backend: FastAPI + MongoDB (motor).
- Local storage via `@/src/utils/storage`.
- Theme tokens in `src/theme.tsx` (pink light + pink dark), styles in `src/styles.ts`, strings in `src/i18n.ts`.

## Screens (4-tab custom bottom navigation)
1. **Health (Kesehatan)** — greeting card "Hello/Halo, Sasha", live BPM hero card,
   battery bar (when connected), metric tiles (Steps, Active time, Calories, Goals %),
   daily briefing. Cards lock when band disconnected.
2. **Goals (Target)** — weekly movement score gradient banner, 7-day steps bar chart,
   3 daily goal progress bars (steps / heart-zone minutes / calories).
3. **Device (Gelang)** — hold-to-connect (2s), reconnect button, gesture simulator
   (Double Tap = track, Long Press = disconnect), auto-connect + remembered device card,
   tracking control, recent sessions, device UUID info, Real BLE (beta) scan panel.
4. **Settings (Pengaturan)** — profile "Sasha Giyu Bau Hasem", theme toggle (light/dark),
   language toggle (EN/ID), bluetooth mirror, notifications toggle, edit daily goals modal, about.

## API Endpoints
- GET /api/ → health check
- GET /api/telemetry → demo band telemetry (device_name "Sasha Band")
- GET /api/insights → 3 static insight cards
- POST /api/tracking/session → save a completed tracking session
- GET /api/tracking/sessions → list recent sessions
- DELETE /api/tracking/sessions → clear sessions
- GET/POST /api/status → status checks

## Removed vs original
- EQO AI chat tab, LLM /api/ai/chat, /api/tts, /api/stt endpoints, emergentintegrations/emoji.
- Voice assistant overlay, mic/TTS/STT utils, talkback & volume settings, single-tap voice gesture.

## Implemented (2026-06)
- Full re-theme to pink (light default + pink dark) via theme tokens.
- 4-tab app, AI/voice fully removed.
- Demo name "Sasha Giyu Bau Hasem" in Settings + "Sasha" greeting on Health.
- Bilingual EN/ID retained and persisted.
- Backend trimmed to non-AI endpoints; 7/7 backend tests passed.
- Fixed: RealBLEPanel unmount no longer drops the simulated connection on tab switch.

## Persistence
Language, notifications, and custom step/active/calorie goals + tracking sessions and
last-paired device via `@/src/utils/storage`.

## Notes / Future Work
- Real BLE (react-native-ble-plx) only works on a native build (Publish → generate build),
  not in Expo Go / web preview (panel shows "Preview build · Real BLE is disabled").

## Backlog (P1/P2)
- P1: Persist connection state across app relaunch.
- P2: Split index.tsx into per-screen modules.
- P2: Editable profile (name/avatar) for the user.
