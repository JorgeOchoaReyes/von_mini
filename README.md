# von mini

**Build private AI apps in one sentence, on your phone, even offline.**

von mini is an app builder for Android and the web. You describe a small tool ("a journal that tags my mood", "rewrite my messages in a friendlier tone") and von mini builds a working app in seconds. The apps it builds run their AI **on your device with Gemini Nano**, keep their data **in your device's local storage**, and keep working **in airplane mode**.

It is built on **Firebase AI Logic hybrid inference**: the cloud (Gemini) is used when it adds quality, and the device (Gemini Nano) is used whenever privacy, cost, or connectivity matter.

## Why

Most "AI app" tools send everything you type to a server, charge per request, and stop working without a connection. That rules them out for the things people most want help with: journals, health notes, private messages, money.

von mini flips the default:

- **Private by default:** what you type into your apps is processed by Gemini Nano on the device and stored locally. A 🔒 private mode guarantees nothing is sent to the cloud.
- **Free to use:** on-device inference has no per-request cost, so the apps you build cost nothing to run.
- **Works offline:** the builder itself can build apps with Gemini Nano when there is no network.

## How it uses Firebase AI Logic

Every AI call goes through Firebase AI Logic with an explicit **inference mode**, chosen per task by a small router ([`src/ai/hybrid.ts`](src/ai/hybrid.ts)):

| Task | Online | Offline / private mode |
|---|---|---|
| Build an app | `PREFER_IN_CLOUD`: Gemini designs it, Nano as fallback | `ONLY_ON_DEVICE`: Gemini Nano designs it |
| Change an app | `PREFER_ON_DEVICE` | `ONLY_ON_DEVICE` |
| AI features inside your apps | `PREFER_ON_DEVICE` | `ONLY_ON_DEVICE` |
| "Make it custom ✨" (full HTML app) | `ONLY_IN_CLOUD` | not available |

Each response reports its `inferenceSource`, and the UI shows it with a 📱 On-device or ☁️ Cloud badge, so the hybrid behaviour is visible.

- **Android:** a local Expo native module ([`modules/nano-bridge`](modules/nano-bridge)) uses the Firebase AI Logic Android SDK (`firebase-ai` + `firebase-ai-ondevice`) with `OnDeviceConfig(InferenceMode)`. On-device requests run on Gemini Nano through AICore.
- **Web (Chrome):** [`src/ai/engine.web.ts`](src/ai/engine.web.ts) uses the Firebase JS SDK (`firebase/ai`) with `getGenerativeModel(ai, { mode, inCloudParams, onDeviceParams })`. On-device requests run on Chrome's built-in Gemini Nano.
- **App Check** protects every request: the debug provider on Android (debug tokens are accepted for the hackathon), and reCAPTCHA Enterprise or a debug token on web.

### Why apps are JSON, not code

Gemini Nano is small, so writing working HTML/JS is unreliable for it, but it is good at **structured output**. So von mini asks the model for an **app spec**: a short JSON description of a screen built from prebuilt blocks (inputs, choices, AI buttons, save, history). See [`src/spec/types.ts`](src/spec/types.ts). The runtime renders specs natively ([`src/runtime/SpecRenderer.tsx`](src/runtime/SpecRenderer.tsx)), and every spec is validated and repaired before it is rendered ([`src/spec/validate.ts`](src/spec/validate.ts)). This makes offline, on-device app building dependable.

When online, **"Make it custom ✨"** asks Gemini in the cloud for a fully custom single-file HTML app. It runs in a sandbox (an Android WebView or a web iframe with `sandbox="allow-scripts"`, and a Content Security Policy that blocks all network access). It can reach only a tiny `vonmini` bridge ([`src/runtime/bridge.ts`](src/runtime/bridge.ts)):

```js
await vonmini.ai('Summarize: ...')     // runs PREFER_ON_DEVICE through Firebase AI Logic
await vonmini.store.set('key', value)  // device-local storage
await vonmini.store.get('key')
```

So even cloud-written apps keep their AI and their data on the device.

## Architecture

```
┌──────────────────── von mini (Expo: Android + Web) ────────────────────┐
│ Builder ─► hybrid router ─► Firebase AI Logic                          │
│                               ├─ Android: firebase-ai + ondevice ─► Nano (AICore)
│                               ├─ Web: firebase/ai ─► Chrome built-in Nano
│                               └─ Cloud: Gemini                         │
│ App spec (JSON) ─► validated ─► native building blocks                 │
│ Custom HTML ─► sandboxed WebView/iframe ─► vonmini bridge              │
│ Storage: AsyncStorage (SQLite in Android app storage / localStorage)   │
└────────────────────────────────────────────────────────────────────────┘
```

## Setup

Requirements: Node 20+, and for Android a JDK 17+, the Android SDK, and a phone that supports Gemini Nano (for example a recent Pixel or Galaxy S) to see on-device inference. Other phones fall back to the cloud.

1. **Firebase project**
   - Create a project and enable **Firebase AI Logic** with the Gemini Developer API.
   - Add a **Web app**, then copy `.env.example` to `.env.local` and fill in its config.
   - Add an **Android app** with package `app.vonmini`, then download `google-services.json` into the repo root. It is git-ignored.
   - Enable **App Check**: reCAPTCHA Enterprise for web (put the site key in `.env.local`) and register **debug tokens** for development.
2. **Install:** `npm install`
3. **Run on web:** `npm run web` (use desktop Chrome with built-in AI enabled to get on-device Gemini Nano).
4. **Run on Android:** `npm run android` builds a development build with the native bridge. Expo Go cannot load it.
   - On first launch, the App Check debug token is printed to logcat (`DebugAppCheckProvider`). Add it in the Firebase console under App Check > Manage debug tokens.

**Offline mode:** set `EXPO_PUBLIC_ON_DEVICE_ONLY=true` in `.env.local` to force every AI call to run on-device (`ONLY_ON_DEVICE`). Private mode is locked on and cloud-only features are disabled. This mode needs no App Check or cloud setup.

Useful scripts: `npm run lint`, `npm run typecheck`, `npm run export:web`, `npx expo-doctor`.

## Testing it

1. Open a **built-in starter app** (Mood Journal, Tone Fixer, Meeting Notes, Flashcards). They work immediately.
2. Type an entry and tap an ✨ AI button. The answer shows a 📱 On-device or ☁️ Cloud badge.
3. Tap **Save**. Entries are stored on the device and shown under History.
4. On the home screen, describe a new app and tap **Build**.
5. Turn on **airplane mode** (or 🔒 Private) and build another app. Gemini Nano builds it on-device.
6. Online, open an app and tap **Make it custom ✨** to get a Gemini-written HTML version whose AI still runs on-device.

## Built during #BuildHybridAI 2026

Everything in this repository was written during the submission period (Nov 2026). It was started from the standard `create-expo-app` blank TypeScript template, and its template LICENSE was replaced with Apache-2.0. It uses open-source libraries listed in `package.json`, and AI coding assistants were used during development.

## License

[Apache-2.0](LICENSE)
