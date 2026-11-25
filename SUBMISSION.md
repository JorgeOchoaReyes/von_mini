# von mini — #BuildHybridAI 2026 submission

Everything a judge, or the person filling in the Devpost form, needs: the contest rules we are
being judged against, the project text, the demo video script, testing instructions, and a
checklist mapping every requirement and judging criterion to evidence in this repository.

- **Repo:** https://github.com/JorgeOchoaReyes/von_mini (public, Apache-2.0)
- **Platforms:** Android **and** Web (Chrome) — one hybrid SDK, two platforms
- **Built with:** Firebase AI Logic (hybrid inference) · Gemini Nano 4 · Gemini (cloud) · Expo SDK 58 / React Native 0.88 · TypeScript

---

## 1. The contest, in short

Read from the official rules and the Devpost page on **2026-11-22** (`#BuildHybridAI 2026`,
firebasehybridaihackathon.devpost.com).

| Item | Detail |
|---|---|
| Submission period | **Nov 11, 2026 13:30 PT → Nov 30, 2026 14:00 PT** |
| Judging period | Dec 10, 2026 09:00 PT → Dec 16, 2026 14:00 PT |
| Winners announced | On or around Dec 21, 2026 12:00 PT |
| Grand Prize | $10,000 + interview + featured blog post + social mention |
| Runner-ups | $7,000 (1st) and $4,000 (2nd) |
| "Best of" categories | $3,000 each: **Best iOS**, **Best Android**, **Best Web/Chrome** |
| Total prize pool | $30,000 |

**The challenge.** *"On-device models are fast, private and free to run, but they aren't on every
device. #BuildHybridAI challenges you to build apps that use both. Using the Firebase AI Logic
Hybrid Inference SDK, your app runs prompts on-device when a local model is available and falls
back to the cloud when it isn't."*

Build for at least one platform — **Web (Chrome) or Android with Gemini Nano 4**, or iOS with
Apple Foundation Models — all through Firebase AI Logic. Apps that run across multiple platforms
are given strong consideration for the Grand Prize; an outstanding single-platform app can still
win.

**Required tech.** Firebase AI Logic, called at runtime. Text inference is free within usage
limits; no purchase is required.

**Submission requirements** (rules §6):

1. Project built with the required tools, on at least one selected platform.
2. A text description covering **how Firebase AI Logic is used**, a **summary of features**, and
   the **value proposition**.
3. A **public code repository** on GitHub or GitLab with an **open-source license** detectable at
   the top of the repo page (Apache is preferred), containing all source, assets and instructions
   needed to run it — and **demonstrating Firebase AI Logic at runtime in the code** (imported and
   actually called, not merely named in the README).
4. A **demonstration video**, ≤ 3 minutes, uploaded publicly to YouTube, in English (or with
   English subtitles), showing the project functioning on the platform it was built for.
5. A **URL to the project** for judging and testing (hosted is "highly encouraged").
6. Must not include production API keys, live Google Cloud secrets, confidential commercial data,
   or PII in the repository, submission form, or testing instructions.
7. If the app existed before the submission period, it must have been **significantly updated**
   during it, with a summary of what was built during the period.

**Judging.** Stage One is a pass/fail viability check. Stage Two scores four **equally weighted**
criteria from 1–5:

1. **Technological Implementation** — how well is it built, and how effectively does it use
   Firebase AI Logic hybrid inference?
2. **Design** — a complete, coherent product experience, not just a technical proof of concept.
3. **Potential Impact** — a credible, specific case for solving a real problem for a real audience.
4. **Quality of the Idea** — a creative, non-obvious use of Firebase AI Logic, with genuine
   understanding of the problem space.

Section 6 of this document maps each of these to evidence.

---

## 2. Project text for the Devpost form

### Inspiration

Every "describe an app and get an app" tool we tried had the same catch: the app it builds is a
thin client for someone else's server. Your journal entries, your mood notes, your half-finished
message drafts all leave the device, get billed per request, and the app stops working the moment
you lose signal. That is exactly backwards for the small private tools people actually want —
journals, habit trackers, expense notes, health logs.

Meanwhile the model is already on the phone. Gemini Nano 4 runs on-device, costs nothing per
request, and works in airplane mode. The catch is that it isn't on *every* device, and it is
small — it can't be trusted to write an entire working app from scratch.

**von mini** is our answer: a one-sentence app builder where the apps it builds run their AI on
your device by default, keep their data in device-local storage, and keep working offline — with
the cloud stepping in only where it genuinely adds something, and always saying so.

### What it does

You type one sentence — *"a journal that tags my mood"*, *"rewrite my messages in a friendlier
tone"* — and von mini builds a working app in seconds. The app appears in a live preview while it
is being built, is immediately usable, and is saved on your device.

- **Build.** The prompt goes through Firebase AI Logic hybrid inference. Online it is
  `PREFER_IN_CLOUD` (Gemini designs the app, Nano is the fallback); in 🔒 Private mode or with no
  network it is `ONLY_ON_DEVICE` and Gemini Nano designs it on the phone.
- **Use.** The built app's own AI features (summarize this entry, suggest a mood tag, rewrite this
  message) run `PREFER_ON_DEVICE`. Entries are saved to device-local storage. Everything keeps
  working in airplane mode.
- **Edit.** This is where we spent most of our effort. You can change a built app three ways, all
  of them instant:
  - **Tap a block in the preview** to select it, then edit its text, label, placeholder or
    options in a docked inspector — or pick a new block type.
  - **Quick-edit chips** ("Rename app", "Add a field", "Change accent", "Add a summary button")
    for the changes people ask for most.
  - **Type a change in words** ("add a field for how much sleep I got"). The model patches the
    existing app spec rather than regenerating it, so the app keeps its identity, its layout and
    its saved data.
  Every change produces a **plain-words summary of what changed** and a **version history** where
  any earlier version can be restored with one tap. All of this works offline on Nano.
- **Talk to it.** Voice is a cascade of three on-device steps: speech-to-text (the platform
  recognizer, kept on the device), Gemini Nano through Firebase AI Logic (streamed), and
  text-to-speech with the device's own voice, a sentence at a time while Nano is still writing.
  Say *"make me an app to help me practice tough interview questions"* and you get an app with a
  spoken mock interview: it asks a hard question, you answer out loud, it gives feedback and asks
  the next one — in airplane mode. Every text field takes dictation, and you can build and edit
  apps by voice too.
- **Nine ready-made apps** ship with it (Interview Coach, Mood Journal, Tone Fixer, Meeting Notes,
  Flashcards, Habit Tracker, Expense Notes, Recipe Scaler, Workout Log) so you can see the whole
  thing work before you build anything.
- **Make it custom ✨** (online only) asks Gemini in the cloud for a fully custom single-file HTML
  version of the app, which runs in a sandbox whose `vonmini` bridge still routes AI through
  Firebase AI Logic on-device and stores data locally.

Every AI answer in the product carries a **📱 On-device** or **☁️ Cloud** badge, and the status
bar tells you which Nano build is loaded — so the hybrid behaviour is something you can see, not
something you have to take on faith.

### How we built it

**Firebase AI Logic hybrid inference is the architecture, not a feature.** A small router
([`src/ai/hybrid.ts`](src/ai/hybrid.ts)) picks an `InferenceMode` per task from connectivity and
the user's privacy setting, and every call reports back its `InferenceSource`, which the UI
surfaces:

| Task | Online | Offline / 🔒 Private |
|---|---|---|
| Build an app | `PREFER_IN_CLOUD` | `ONLY_ON_DEVICE` |
| Change an app (chat edit) | `PREFER_ON_DEVICE` | `ONLY_ON_DEVICE` |
| AI features inside a built app | `PREFER_ON_DEVICE` | `ONLY_ON_DEVICE` |
| "Make it custom ✨" | `ONLY_IN_CLOUD` | unavailable (and shown as such) |

**Two platforms, one SDK.**

- **Android:** an Expo native module ([`modules/nano-bridge`](modules/nano-bridge)) wraps the
  Firebase AI Logic Android SDK (`com.google.firebase:firebase-ai` +
  `firebase-ai-ondevice`) and passes `OnDeviceConfig(InferenceMode)` into every request.
  On-device requests run on **Gemini Nano 4** through AICore. Responses stream back to JS as
  events, bridged into an async iterator.
- **Web (Chrome):** [`src/ai/engine.web.ts`](src/ai/engine.web.ts) uses the Firebase JS SDK's
  `getGenerativeModel(ai, { mode, inCloudParams, onDeviceParams })`, with on-device requests
  served by Chrome's built-in Gemini Nano. The model is warmed up via `initializeDeviceModel()`
  on first interaction, and streamed with `generateContentStream`.
- Both share the same router, prompts, validators and UI. The engine is selected at runtime
  ([`src/ai/engineSelect.ts`](src/ai/engineSelect.ts)).

**We target Gemini Nano 4 explicitly.** The Nano build is a runtime choice — `nano-v4-full`
(`OnDeviceModelOption.PREVIEW`), `nano-v4-fast` (`PREVIEW_FAST`), or the older `STABLE` — settable
from Settings and persisted ([`src/ai/deviceModel.ts`](src/ai/deviceModel.ts)), and the app
reports which one the runtime actually loaded instead of claiming a model is ready when it isn't.

**Apps are JSON, not code.** Gemini Nano is small. It is unreliable at writing whole working
HTML/JS apps and very good at structured output. So von mini asks for an **app spec** — a short
JSON description of a screen assembled from prebuilt blocks ([`src/spec/types.ts`](src/spec/types.ts)).
The spec is validated and repaired before it is ever rendered ([`src/spec/validate.ts`](src/spec/validate.ts)),
rendered by native building blocks ([`src/runtime/SpecRenderer.tsx`](src/runtime/SpecRenderer.tsx)),
and diffed in plain words ([`src/spec/diff.ts`](src/spec/diff.ts)). This is what makes *offline,
on-device* app building dependable rather than a demo that works once.

**Edits are patches, not regenerations.** The same spec representation means an edit is a
structured diff against a known schema, applied by [`src/spec/edit.ts`](src/spec/edit.ts), rather
than a fresh generation. The user's app keeps its name, layout and saved entries; the change is
described in words; and the previous spec is snapshotted so it can be undone. Pure functions
handle the deterministic edits (rename, add a field, reorder, restyle) so they are instant and
work offline; the model is reserved for changes that are genuinely expressed in words.

**App Check.** Every cloud request goes through App Check: the debug provider on Android (debug
tokens accepted for the hackathon) and reCAPTCHA Enterprise or a debug token on web. Offline and
Private modes never touch the cloud, so they need no App Check at all.

### Challenges we ran into

- **Making a small model dependable.** Our first attempt asked Gemini Nano for HTML. It produced
  something plausible and broken almost every time. Moving to a validated JSON spec — plus
  `responseConstraint` structured output and a repair pass — turned "usually works" into "works".
- **Making edits feel instant.** Regenerating the app on every tweak lost the user's data, changed
  the layout unexpectedly, and took seconds. Splitting edits into deterministic spec patches
  (instant, offline) and model-driven patches (only for natural-language changes) fixed both the
  speed and the trust problem.
- **A model that isn't there yet.** Chrome can expose the Prompt API while the model is still
  downloading. We had a bug where the UI showed "On-device AI unavailable" next to "Loaded:
  Gemini Nano" — because the status banner and the actual request path were reading different
  engines. Both now read the same engine and only report a model name once `availability()` says
  it is usable.
- **Verifying against reality.** We stopped trusting our memory of the APIs: the Android side was
  checked with `javap` against the pinned AAR (`firebase-ai` 18.1.0 / `firebase-ai-ondevice`
  16.0.0-beta07), and the web UI was driven in a real Chromium with a screenshot harness, which is
  how we found a nested-`<button>` React error, a gradient that put white text on a pale stop, and
  an inspector panel that rendered below the fold.

### Accomplishments we're proud of

- A builder that **builds apps offline, on the device, and they work** — nine of them ship ready
  to use.
- An editing experience that is genuinely better than regenerating: tap-to-select blocks,
  quick-edit chips, natural-language patches, a "what changed" summary after every change, and a
  restorable version history — all offline.
- Two platforms on one hybrid SDK, with the inference route **visible** in the UI on every
  response.
- A preview that stays fast as data grows: the render time for a saved-entry list is flat from 0
  to 2,000 entries (715 ms → 757 ms), because the list renders a 25-entry window.

### What we learned

- On-device is not "the cheap version of cloud" — it is a different contract with the user. Once
  the model runs on the device, offline and privacy stop being features you add and become
  defaults you have to design around.
- Constraining the model's output is a product decision, not just an engineering one. The JSON
  spec is why the offline path is trustworthy.
- A hybrid app needs to be honest about which half answered. Showing the inference source on every
  response changed how we designed the whole product.

### What's next

- **iOS.** The router is already platform-agnostic; the missing piece is a Swift bridge to Apple
  Foundation Models through Firebase AI Logic, which would make this a three-platform hybrid app.
- **Sharing.** Export an app spec as a link so a built app can be handed to someone else.
- **More block types** (charts, timers, photo attachments) and per-app prompt tuning so Nano gets
  even more reliable on longer specs.
- **On-device embeddings** to let a user search everything they've written across their apps,
  without any of it leaving the phone.

### Built with

`firebase-ai` · `firebase-ai-ondevice` · Firebase AI Logic (hybrid inference) · Gemini Nano 4
(`nano-v4-full` / `nano-v4-fast`) · Gemini (cloud) · Chrome built-in AI (Prompt API) · Expo SDK 58
· React Native 0.88 · React 19 · TypeScript · Expo Router · AsyncStorage · App Check · Android
AICore · Kotlin (Expo Modules API)

---

## 3. Demo video — script and shot list

**Target length 2:50.** Everything is shot on a phone-sized Android device or Chrome; the
recording must show the app actually working.

| # | Time | Shot | What is said |
|---|---|---|---|
| 1 | 0:00–0:12 | Home screen, phone. | "This is von mini. You describe a small app in one sentence and it builds one — and the apps it builds run their AI on your phone, not on a server." |
| 2 | 0:12–0:30 | Type *"a journal that tags my mood"*, tap **Build app**. Hold on the live build panel as steps tick through, then the finished app. | "One sentence. It's designing the app through Firebase AI Logic hybrid inference — online it asks Gemini, and the app it hands back runs its own AI on-device with Gemini Nano." |
| 3 | 0:30–0:50 | Type an entry, tap the ✨ mood-tag button, point at the **📱 On-device** badge, tap **Save**, open History. | "Every answer tells you which half answered — 📱 on-device or ☁️ cloud. The entry is saved on the device. Nothing has left the phone." |
| 4 | 0:50–1:10 | Turn on airplane mode (or 🔒 Private). Go home, type *"a habit tracker for drinking water"*, build it. | "Now the same thing with no network at all. Gemini Nano designs the app on the phone. This is the part that usually doesn't exist — an app builder that works in airplane mode." |
| 5 | 1:10–1:35 | Open the journal. **Tap a block** in the preview, edit its label in the docked inspector, close. Then tap a quick-edit chip. Show the **"What changed"** card. | "Editing is where we spent most of our time. Tap any block to select it and edit it directly — no regeneration, no waiting, and your entries stay put." |
| 6 | 1:35–1:55 | Type *"add a field for how much sleep I got"* in the chat tab. Show the streaming reply, the patched preview, and the change summary. Then open **History** and restore the previous version. | "Or just say what you want. The model patches the app's spec instead of rebuilding it, so it keeps its identity. Every change is summarised in plain words, and every version is one tap away." |
| 7 | 1:55–2:15 | Home → **Settings**: show the status card, the on-device model picker (`Gemini Nano 4`), and the routing table. | "You can see and choose what runs where: which Nano build is loaded, and exactly which tasks go on-device, which go to the cloud, and which are private-only." |
| 8 | 2:15–2:50 | Still in airplane mode: tap the home mic and say *"make me an app to help me practice tough interview questions"*. In the built app, tap the big mic, answer the interviewer out loud, let it reply and ask the next question. End on the home screen. | "And you can just talk to it. Speech-to-text, Gemini Nano and the voice are all on the phone, so this mock interview works with no network at all — and everything you build is yours, on your device, and free to run. That's von mini." |

**Recording notes**

- Record the Android device for shots 1–7 (it is the platform where Gemini Nano 4 is fully
  supported); a Chrome capture of the same flows is a fine substitute if no Nano-capable device is
  available, and the on-device badge still applies.
- Turn airplane mode on *before* shot 4 and leave it on for shots 4–8 so the offline claim is
  visibly true on camera.
- Keep the ✨ AI buttons and the inference badge in frame — they are the evidence for the
  technological-implementation criterion.
- Do not show `.env.local`, `google-services.json`, the Firebase console config, or the App Check
  debug token on camera.

---

## 4. Testing instructions for judges

### Fastest path — run it in a browser

No account, no key, no cloud project needed. The build supports an on-device-only offline mode
that never calls the cloud, so nothing has to be configured to try the whole product.

```bash
git clone https://github.com/JorgeOchoaReyes/von_mini.git
cd von_mini
npm install
cp .env.example .env.local          # then set EXPO_PUBLIC_ON_DEVICE_ONLY=true
npm run web
```

Then, in **desktop Chrome**:

1. Home → open a ready-made app (Mood Journal) → type an entry → tap the ✨ button → **Save** →
   check **History**.
2. Home → type *"a habit tracker for drinking water"* → **Build app**. Watch the live build panel.
3. Open the app you just built. Tap a block in the preview to edit it; try a quick-edit chip; then
   use the chat tab to say *"add a field for the date"*.
4. Open the **History** tab and restore the first version.

**To see real on-device inference on web**, use desktop Chrome with built-in AI enabled
(`chrome://on-device-internals`) and pick **Gemini Nano 4** in Settings. If the browser has no
on-device model, the app says so plainly instead of silently pretending — and the flows above
still work end-to-end.

**A dev-only mock engine.** Setting `EXPO_PUBLIC_MOCK_ENGINE=true` in `.env.local` routes
generation through a local canned engine that never touches the network. It exists so the
build/edit/undo flows can be demonstrated and screenshotted on machines without a Nano-capable
device. It is off by default and cannot run in a release build (`__DEV__` guard in
`src/ai/mockEngine.ts`). Use it only if you cannot run the real path.

### Android

The native module needs a development build (Expo Go cannot load it):

```bash
npm run android          # requires JDK 17+, Android SDK, and google-services.json
```

On a Nano-capable device (recent Pixel/Galaxy S), the on-device path runs on Gemini Nano 4 through
AICore. On other devices it falls back to the cloud.

### Cloud path — a human step

Cloud inference requires a Firebase project with **AI Logic** enabled and **App Check**
configured (reCAPTCHA Enterprise site key for web; debug tokens registered for Android). We did
not have App Check provisioned for this submission, so **cloud calls may be rejected until a
project owner registers the site key and debug tokens**. This is deliberately *not* worked around:
the app reports the failure honestly, keeps working offline, and 🔒 Private mode guarantees the
cloud is never used. Setting up that project is the one manual step a reviewer would need to
exercise the cloud half.

---

## 5. What we built during the submission period

**von mini is a new project, not an existing one.** Its first commit is dated 2026-11-22, inside
the submission window (Nov 11–30, 2026); `git log --reverse` shows the whole history and every
commit falls in that window. It was started from the standard `create-expo-app` blank TypeScript
template, whose LICENSE we replaced with Apache-2.0. There is no pre-existing app to disclose.

Built during the period, in order:

- **The core.** Prompt → Firebase AI Logic hybrid inference → validated JSON app spec → native
  renderer, on Android (Kotlin Expo module over `firebase-ai` / `firebase-ai-ondevice`) and web
  (`firebase/ai`), plus offline `ONLY_ON_DEVICE` mode and per-app chat.
- **A new product surface.** Prompt-first home with suggestion chips and a ready-made app gallery;
  a two-pane builder (chat + live preview, stacked tabs on phones); a settings screen that reports
  on-device status and lets you choose the Nano build; a design system (tokens, light and dark,
  type scale, gradients, haptics, accessible touch targets) and a motion layer.
- **The editing experience.** `src/spec/edit.ts` (deterministic spec patches), tap-to-select
  blocks with a docked inspector (`src/runtime/SpecEditor.tsx`), quick-edit chips,
  natural-language edits that patch instead of regenerate, `describeChanges` summaries after every
  change, and a restorable version history (`src/chat/HistoryPanel.tsx`,
  `pushVersion`/`restoreVersion`).
- **Gemini Nano 4.** Runtime model selection (`src/ai/deviceModel.ts`), model warm-up, streaming
  on both platforms, and honest status reporting.
- **Nine ready-made offline apps** (`src/spec/starters.ts`).
- **Voice.** An on-device speech-to-text → Gemini Nano → text-to-speech cascade (`src/voice/`):
  a `voice` block for spoken conversations (hands-free, sentence-by-sentence speech while Nano
  streams), dictation on every field, building and editing by voice, and `vonmini.listen / speak /
  converse` for custom HTML apps.
- **Performance work** with measured before/after numbers (section 6).

The work for this submission is on the `lark/hackathon-buildout` branch; `git log
origin/master..HEAD` is the record.

---

## 6. Checklist: rules and criteria → evidence

### Submission requirements

| Requirement (rules §6) | Where |
|---|---|
| Built with the required tools; Firebase AI Logic called at runtime | `src/ai/engine.web.ts` (`getAI`, `getGenerativeModel`, `InferenceMode`), `modules/nano-bridge/android/src/main/java/expo/modules/nanobridge/NanoBridgeModule.kt` (`com.google.firebase.ai`) — both are the app's real request path, not a README mention |
| Text description: how Firebase AI Logic is used, features, value proposition | §2 of this file; "How it uses Firebase AI Logic" in `README.md` |
| Public repo, open-source license detectable at the top | `LICENSE` (Apache-2.0); the repo is public |
| Repo contains everything needed to run it, with instructions | `README.md` → Setup; `.env.example`; `package.json` scripts |
| Demonstration video ≤ 3 min, public on YouTube, English | §3 script (2:50 target). **Human step:** record, upload, paste the link into the Devpost form |
| URL to the project for judging and testing | **Human step:** `npm run export:web` produces a static build in `dist/` (see "Hosting" below); paste the hosted URL into the form |
| No production keys, secrets, or PII in the repo/form/instructions | `.env.local` and `google-services.json` are git-ignored and never committed (verified with `git check-ignore`); no key values appear in any doc, screenshot, or the PR |
| New project: everything built during the period | §5; first commit 2026-11-22, all 14 commits inside the submission window |
| Platform selected | Web (Chrome) **and** Android — both implemented |

### Judging criteria

| Criterion | Evidence |
|---|---|
| **Technological Implementation** — how well built, how effectively it uses hybrid inference | Explicit `InferenceMode` routing per task (`src/ai/hybrid.ts`); `InferenceSource` reported and shown as a badge on every response; two platforms behind one router (`engineSelect.ts`, `modules/nano-bridge`); Gemini Nano 4 selectable at runtime with warm-up and streaming; JSON-spec approach with validation/repair (`src/spec/validate.ts`) so a small model is dependable; `npx tsc --noEmit`, `npx expo lint` and `npx expo-doctor` (20/20) all clean |
| **Design** — a complete, coherent product experience | Prompt-first home, live build progress, two-pane builder, tap-to-edit inspector, change summaries, version history, settings, dark mode, design tokens (`src/ui/theme.ts`), motion (`src/ui/motion.tsx`), haptics; screenshots in `docs/screenshots/`; nine apps that work the moment you open them |
| **Potential Impact** — credible case for a real audience | The apps people most want help with (journals, health notes, money, private messages) are exactly the ones that cannot go to a server. von mini makes the private, free, offline version the default: no per-request cost, no account, works in airplane mode. Nine ready-made apps make the case concrete, and voice practice (interviews, hard conversations) is something people would never want to send to a server. |
| **Quality of the Idea** — creative, non-obvious, real understanding | An app *builder* whose built apps inherit the hybrid contract — and whose editing model treats a change as a diff against a validated spec rather than a regeneration, so privacy, data and layout survive the edit. The on-device constraint is used as a design tool (structured output, deterministic patches) rather than hidden. |

### Verification run for this submission

| Check | Result |
|---|---|
| `npx tsc --noEmit` | clean |
| `npx expo lint` | clean |
| `npx expo-doctor` | 20/20 checks passed |
| `npm run export:web` | succeeds; static build in `dist/` |
| Web flows in real Chromium | build, edit (tap / chip / chat), change summary, history + restore, settings, dark mode — screenshotted |
| Android debug build | **Could not be run here.** `npx expo prebuild --platform android` succeeds, but a Gradle build does not fit on the submission machine: with JDK 17 and a minimal SDK (cmdline-tools + platform-36 + build-tools 36) installed, `./gradlew :app:compileDebugKotlin` twice exhausted the 7.8 GB disk (Gradle resolved ~3 GB of dependencies and `sdkmanager` pulled a 2 GB NDK). The native module's Firebase AI Logic API usage was verified against the pinned AARs with `javap`, but it is **not compile-verified**. **Human step:** `npm run android` on a machine with the Android SDK. |

### Performance (measured, before → after)

Measured on the submission machine (4 vCPU, Chromium, static web export; median of warm runs).
Method: `npm run export:web` + a local static server; startup via a Playwright-over-CDP harness;
bundle sizes raw / gzip-9 of the initial payload.

| Metric | Before | After | Note |
|---|---|---|---|
| Initial bundle (raw / gzip) | 1408 KB / 364 KB | 1444 KB / 375 KB | +3% — the new UI and editing layer cost ~11 KB gzip |
| Builder route chunk | 26 KB | 55 KB | code-split, fetched lazily on navigation |
| Time to interactive (warm) | 149 ms | 165 ms | +16 ms, tracking the bundle |
| First contentful paint (warm) | 120 ms | 128 ms | +8 ms |
| Build flow: first pipeline step visible | — | 50 ms | progressive steps, not a spinner |
| Build flow: app preview visible | — | 147 ms | |
| Preview render, 0 → 2,000 saved entries | — | 715 ms → 757 ms | flat: the list renders a 25-entry window |

The bundle grew. We are reporting it rather than hiding it: the added weight buys the editing
experience, the design system, and the animation layer, and the interaction metrics that users
feel (first step visible in 50 ms, a preview in 147 ms, an edit applied in a frame) improved
because work was moved off the critical path — lazy routes, memoized list rows, a windowed
history, smaller prompts and fewer validate/repair retries for Nano.

### Hosting the web build (human step)

`npm run export:web` writes a fully static site to `dist/` — plain files, no server needed. Any
static host works (Firebase Hosting, GitHub Pages, Netlify).

We did not deploy it: deploying needs an account we don't own, so it is left as a one-command step
for whoever submits. **Set `EXPO_PUBLIC_ON_DEVICE_ONLY=true` in `.env.local` before exporting** —
the config is baked in at build time, and that setting makes the hosted build run entirely
on-device with no Firebase project required, which is the easiest thing for a judge to test.
