# RedactDesk — Hybrid Privacy Assistant for Freelancers

## What it does

RedactDesk is a privacy-first text assistant for freelancers and small
businesses. Paste in the kind of text you handle every day — an invoice
memo, a transcribed receipt, a client email thread — and RedactDesk:

1. **Redacts it on-device.** Names, companies, postal addresses, emails,
   phone numbers, bank accounts, card numbers, amounts, dates of birth and
   ID numbers are detected and replaced with tokens like `[NAME_1]`,
   `[ACCOUNT_1]`, `[AMOUNT_2]`.
2. **Summarizes it in the cloud — using only the redacted text.** You get a
   plain-English summary, a cleaned-up version of the document, and a list
   of concrete next actions (send, record, file, follow up).

The header always shows the current inference mode (`ON-DEVICE` /
`CLOUD`), every step carries its own mode badge, and a timestamped
inference log records the requested mode, where inference actually
executed, the duration, and how many sensitive spans were masked.

## The problem

Freelancers constantly paste client documents into AI tools — and every
paste uploads names, addresses, account numbers and amounts to someone
else's server. The usual advice ("just be careful") doesn't scale. The
fix has to be architectural: the sensitive step must run where the data
already is — on the device — and the cloud should only ever see a version
with the sensitive parts removed.

## How we used Firebase AI Logic

**All inference in RedactDesk goes through Firebase AI Logic. No other
model API is called.**

- **Step 1 (redaction)** creates a model with
  `InferenceMode.PREFER_ON_DEVICE`. Firebase AI Logic routes the request
  to Gemini Nano running on-device via Chrome's Prompt API when it is
  available, and automatically falls back to cloud Gemini when it is not.
- **Step 2 (summary)** creates a model with
  `InferenceMode.ONLY_IN_CLOUD` and `inCloudParams` set to a cloud Gemini
  model (`gemini-2.5-flash`). Its prompt contains **only the redacted
  text** produced in step 1 — the raw document is never passed to it.
- **Knowing where inference ran** is a first-class part of the UX: the app
  reads `response.inferenceSource` (`ON_DEVICE` / `IN_CLOUD`) after every
  call and renders it in the badges and the log. If step 1 fell back to
  the cloud, a warning banner tells the user plainly that the raw text
  left the device for that step. Transparency is the feature.
- **Firebase App Check** (Google Cloud Fraud Defense / reCAPTCHA Enterprise
  provider, with debug tokens for development and demos) is initialized
  before the AI Logic service to protect the backend, and its status is
  shown in the header.
- Following the hybrid-inference guidance, models are created **on the
  Process button click** — a user interaction — not at page load.
- Both steps ask the model for strict JSON (redacted text + entity
  counts; summary + cleaned text + next actions), parsed defensively so
  the UI stays structured regardless of which model executed the step.

## Why it matters

- **Privacy by architecture, not by policy.** The step that touches raw
  sensitive data is pinned to prefer on-device execution; the cloud step
  is structurally incapable of leaking what it never receives.
- **Works for everyone.** Devices and browsers without Gemini Nano still
  get the full workflow through the automatic cloud fallback — disclosed,
  not hidden.
- **Trust you can point at.** The mode badge and inference log make the
  privacy claim verifiable in the UI, run by run — important when the
  documents belong to your clients, not just to you.
- **Zero-friction.** No build step, no accounts, nothing stored
  server-side: open the page, paste, process.

## Try it

- **Live demo:** https://yoruiro-hybrid-ai.web.app
- **Source:** https://github.com/yoruiro-tools/redactdesk

The live demo runs against a real Firebase project with Firebase AI Logic
and App Check (Fraud Defense) enabled. If the Firebase config is removed
or left as placeholders, the identical UI automatically drops into a
built-in local simulator ("mock mode") that runs the complete pipeline —
redaction, summary, mode badges, inference log — and can even simulate
"on-device unavailable" to demonstrate the disclosed cloud fallback.
