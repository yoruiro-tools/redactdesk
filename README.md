# RedactDesk — Hybrid Privacy Assistant for Freelancers

**Sensitive data never leaves the device unprotected.**

RedactDesk is a text-processing assistant for freelancers and small
businesses who paste client documents — invoice memos, receipt
transcriptions, client emails — into AI tools every day, and who currently
have to choose between convenience and leaking names, addresses, account
numbers and amounts to the cloud.

RedactDesk removes that choice with a two-step pipeline built entirely on
**Firebase AI Logic hybrid inference**:

| Step | What happens | Where it runs | Firebase AI Logic mode |
|---|---|---|---|
| 1 · Redaction | Detects sensitive spans (names, companies, addresses, emails, phones, bank accounts, card numbers, amounts, dates of birth, IDs) and replaces them with tokens such as `[NAME_1]`, `[AMOUNT_2]` | **On-device first** — Gemini Nano via Chrome's Prompt API | `InferenceMode.PREFER_ON_DEVICE` |
| 2 · Summary | Summarizes the document, produces a cleaned-up version, and suggests concrete next actions | **Cloud** — Gemini | `InferenceMode.ONLY_IN_CLOUD`, fed **only the redacted text** |

The raw document is never uploaded when on-device inference is available.
If on-device inference is *not* available, the Firebase AI Logic SDK falls
back to the cloud automatically — and RedactDesk says so, loudly: a warning
banner appears and the inference log records exactly where each step ran,
using the SDK's `response.inferenceSource` (`ON_DEVICE` / `IN_CLOUD`).
No silent uploads, ever.

## Why hybrid inference is the point

- **Privacy by architecture, not by policy.** The redaction step is the
  sensitive one, so it is pinned to prefer the on-device model. The cloud
  step is powerful but only ever sees tokens.
- **100% reach.** On browsers/devices without Gemini Nano, the same code
  path falls back to cloud Gemini — with the fallback disclosed in the UI.
- **Transparency as a feature.** A persistent mode badge
  (`ON-DEVICE` / `CLOUD`), per-step badges, and a timestamped inference log
  show the requested mode, the actual execution source, duration, and how
  many sensitive spans were masked.
- **One SDK, one API.** All inference — on-device and cloud — goes through
  Firebase AI Logic. No other model API is called anywhere in this project.

## Tech stack

- **Firebase AI Logic** (Web SDK, `firebase/ai`) with the Gemini Developer
  API backend (`GoogleAIBackend`)
- **Hybrid inference**: `getGenerativeModel(ai, { mode: InferenceMode.…,
  inCloudParams: { model: "gemini-2.5-flash" } })`
- **Firebase App Check** (Google Cloud Fraud Defense / reCAPTCHA
  Enterprise provider; debug tokens for development/demos) protecting the
  AI Logic backend
- Plain HTML / CSS / JavaScript modules — **no build step**. The Firebase
  SDK is loaded from the official CDN via an import map.

## Quick start

### Option A — Mock mode (no Firebase project needed)

Just open `index.html` (or serve the folder, e.g. `npx serve .`).
While `firebase-config.js` contains placeholder values, the app runs a
local simulator that reproduces the whole pipeline: redaction, summary,
mode badges, the inference log — and, if you untick
*"Simulate on-device model available"*, the cloud-fallback warning banner.

### Option B — Live mode

1. **Create a Firebase project** at
   [console.firebase.google.com](https://console.firebase.google.com) and
   register a Web app.
2. **Enable Firebase AI Logic** in the console (AI Logic → Get started)
   with the Gemini Developer API backend.
3. **Copy your web config** into `firebase-config.js`
   (`apiKey`, `authDomain`, `projectId`, `storageBucket`,
   `messagingSenderId`, `appId`).
4. **Enable App Check** (next section) and paste the reCAPTCHA Enterprise
   site key into `appCheckConfig` in `firebase-config.js`.
5. Serve the folder over HTTP(S) — e.g. Firebase Hosting:
   `firebase init hosting` → public directory `.` → `firebase deploy`.
6. Open the page in a recent **desktop Chrome** (v139+) with the Prompt
   API / Gemini Nano enabled for full on-device inference:
   `chrome://flags/#prompt-api-for-gemini-nano-multimodal-input` → Enabled,
   then relaunch. On any other browser the app still works — step 1 falls
   back to the cloud and the UI discloses it.

> Implementation note: per the Firebase AI Logic hybrid documentation,
> `getGenerativeModel()` with an inference mode is called **on the
> Process button click** (a user interaction), never at page load.

## Enabling Firebase App Check

App Check protects your AI Logic backend from abuse and unauthorized
clients. RedactDesk initializes it in `app.js` before creating the AI
Logic service.

**Production (Google Cloud Fraud Defense / reCAPTCHA Enterprise):**

1. Firebase console → **App Check** → select your Web app → register
   **Fraud Defense** (reCAPTCHA Enterprise) and create a site key in the
   Google Cloud console if prompted. (The reCAPTCHA Classic / v3 provider
   is deprecated and its form is disabled in the Firebase console.)
2. Paste the site key into `appCheckConfig.recaptchaEnterpriseSiteKey` in
   `firebase-config.js`.
3. In the App Check console, **enforce** App Check for **AI Logic**.
4. Add every domain you serve from to the reCAPTCHA key's allowed domains.

**Development / demo (debug tokens):**

1. Leave `appCheckConfig.useDebugToken: true` (the default in this repo).
   The app sets `self.FIREBASE_APPCHECK_DEBUG_TOKEN` before initializing
   App Check.
2. Load the page once and open DevTools → Console: the App Check SDK
   prints a debug token.
3. Firebase console → **App Check** → your Web app → ⋮ → **Manage debug
   tokens** → register that token.
4. Reload. The header badge reads `ACTIVE · DEBUG TOKEN`.
   (You can also pin a pre-registered token in
   `appCheckConfig.debugToken`.)

Never ship a build to end users with debug-token mode as the only
protection — debug tokens are for development and judging demos.

## Project structure

```
.
├── index.html          # UI (English), import map for the Firebase SDK
├── styles.css          # Business-SaaS styling, mode badge colors
├── app.js              # Pipeline, hybrid inference, App Check, mock engine, log
├── firebase-config.js  # ← the only file you edit: Firebase + App Check config
├── description.md      # Devpost submission draft
└── LICENSE             # MIT
```

## Privacy notes

- The app stores nothing server-side; the input lives only in the page.
- In live mode with on-device inference available, the raw text is
  processed by Gemini Nano inside Chrome and never transmitted; only the
  redacted text is sent to cloud Gemini for step 2.
- The entity panel shows **types and counts only** — never the original
  sensitive values.

## License

MIT — see [LICENSE](LICENSE).
