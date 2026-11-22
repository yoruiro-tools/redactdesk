// ─────────────────────────────────────────────────────────────────────────────
// RedactDesk — hybrid privacy assistant
//
// Pipeline (ALL inference goes through Firebase AI Logic — no other model
// API is ever called):
//
//   Step 1 · REDACTION   Firebase AI Logic, InferenceMode.PREFER_ON_DEVICE
//                        → Gemini Nano on-device (Chrome Prompt API) first;
//                          the SDK falls back to cloud Gemini automatically
//                          when on-device is unavailable, and reports the
//                          truth via response.inferenceSource.
//   Step 2 · SUMMARY     Firebase AI Logic, InferenceMode.ONLY_IN_CLOUD
//                        → cloud Gemini, fed ONLY the redacted text.
//
// If firebase-config.js still holds placeholder values, the app runs in
// MOCK MODE: a local simulator reproduces the same pipeline, badges,
// fallback notice and log so the flow can be demoed end-to-end.
// ─────────────────────────────────────────────────────────────────────────────

import {
  firebaseConfig,
  appCheckConfig,
  CLOUD_MODEL,
  isPlaceholderConfig,
  isPlaceholderSiteKey,
} from "./firebase-config.js";

// ── DOM ─────────────────────────────────────────────────────────────────────
const $ = (id) => document.getElementById(id);
const els = {
  modeBadge: $("modeBadge"),
  connBadge: $("connBadge"),
  appCheckBadge: $("appCheckBadge"),
  fallbackBanner: $("fallbackBanner"),
  mockBanner: $("mockBanner"),
  mockOnDeviceToggle: $("mockOnDeviceToggle"),
  input: $("inputText"),
  charCount: $("charCount"),
  processBtn: $("processBtn"),
  clearBtn: $("clearBtn"),
  entityList: $("entityList"),
  redactedOutput: $("redactedOutput"),
  summaryOutput: $("summaryOutput"),
  cleanedOutput: $("cleanedOutput"),
  actionsOutput: $("actionsOutput"),
  copyRedactedBtn: $("copyRedactedBtn"),
  copySummaryBtn: $("copySummaryBtn"),
  logOutput: $("logOutput"),
  clearLogBtn: $("clearLogBtn"),
};

// ── State ───────────────────────────────────────────────────────────────────
const MOCK_MODE = isPlaceholderConfig();
let ai = null; // Firebase AI Logic service instance (live mode only)
let InferenceMode = null; // enum from firebase/ai (live mode only)

// ── Small helpers ───────────────────────────────────────────────────────────
const now = () =>
  new Date().toLocaleTimeString("en-GB", { hour12: false });

function setBadge(el, text, kind) {
  el.textContent = text;
  el.className = "badge" + (kind ? " badge-" + kind : "");
}

function setModeBadge(source, runningLabel) {
  if (runningLabel) return setBadge(els.modeBadge, runningLabel, "running");
  if (source === "ON_DEVICE") setBadge(els.modeBadge, "ON-DEVICE", "ondevice");
  else if (source === "IN_CLOUD") setBadge(els.modeBadge, "CLOUD", "cloud");
  else setBadge(els.modeBadge, "IDLE", "idle");
}

function setStepBadge(step, text, kind) {
  const el = document.querySelector(`[data-step-badge="${step}"]`);
  if (el) setBadge(el, text, kind);
}

function log(message, cls = "") {
  const empty = els.logOutput.querySelector(".log-empty");
  if (empty) empty.remove();
  const p = document.createElement("p");
  if (cls) p.className = cls;
  const time = document.createElement("span");
  time.className = "log-time";
  time.textContent = `[${now()}] `;
  p.appendChild(time);
  p.appendChild(document.createTextNode(message));
  els.logOutput.appendChild(p);
  els.logOutput.scrollTop = els.logOutput.scrollHeight;
}

function logRun(stepLabel, requestedMode, source, durationMs, extra = "") {
  const srcCls =
    source === "ON_DEVICE"
      ? "log-src-ondevice"
      : source === "IN_CLOUD"
        ? "log-src-cloud"
        : "log-src-mock";
  const empty = els.logOutput.querySelector(".log-empty");
  if (empty) empty.remove();
  const p = document.createElement("p");
  const time = document.createElement("span");
  time.className = "log-time";
  time.textContent = `[${now()}] `;
  p.appendChild(time);
  p.appendChild(
    document.createTextNode(
      `${stepLabel} — requested ${requestedMode} → executed `,
    ),
  );
  const src = document.createElement("span");
  src.className = srcCls;
  src.textContent = source + (MOCK_MODE ? " (mock)" : "");
  p.appendChild(src);
  p.appendChild(
    document.createTextNode(` · ${(durationMs / 1000).toFixed(1)}s${extra}`),
  );
  els.logOutput.appendChild(p);
  els.logOutput.scrollTop = els.logOutput.scrollHeight;
}

function showFallbackBanner(text) {
  els.fallbackBanner.textContent = text;
  els.fallbackBanner.classList.remove("hidden");
}
function hideFallbackBanner() {
  els.fallbackBanner.classList.add("hidden");
  els.fallbackBanner.textContent = "";
}

async function copyText(text, btn) {
  try {
    await navigator.clipboard.writeText(text);
    const orig = btn.textContent;
    btn.textContent = "Copied ✓";
    setTimeout(() => (btn.textContent = orig), 1500);
  } catch {
    log("Clipboard copy failed — select and copy the text manually.", "log-error");
  }
}

// ── Prompts ─────────────────────────────────────────────────────────────────
function redactionPrompt(text) {
  return [
    "You are a privacy redaction engine. Read the document below and replace",
    "every sensitive span with a token, keeping all other text byte-identical.",
    "",
    "Sensitive categories and token formats (number tokens per category, in",
    "order of appearance):",
    "- Person names            → [NAME_1], [NAME_2], …",
    "- Company / client names  → [COMPANY_1], …",
    "- Postal addresses        → [ADDRESS_1], …",
    "- Email addresses         → [EMAIL_1], …",
    "- Phone numbers           → [PHONE_1], …",
    "- Bank account / IBAN     → [ACCOUNT_1], …",
    "- Card numbers            → [CARD_1], …",
    "- Amounts of money        → [AMOUNT_1], …",
    "- Dates of birth          → [DOB_1], …",
    "- Government / tax IDs    → [ID_1], …",
    "- Anything else sensitive → [REDACTED_1], …",
    "",
    "Respond with ONLY a JSON object, no markdown fences, in exactly this shape:",
    '{"redactedText": "<the full document with tokens substituted>",',
    ' "entities": [{"type": "NAME", "count": 2}, {"type": "EMAIL", "count": 1}]}',
    "The entities array lists each category found and how many spans of it",
    "were replaced. Never include the original sensitive values anywhere.",
    "",
    "DOCUMENT:",
    text,
  ].join("\n");
}

function summaryPrompt(redactedText) {
  return [
    "You are an assistant for a freelancer. The document below has ALREADY",
    "been privacy-redacted: tokens like [NAME_1] or [AMOUNT_2] stand in for",
    "sensitive values. Work only with what is visible; never guess or invent",
    "the hidden values.",
    "",
    "Respond with ONLY a JSON object, no markdown fences, in exactly this shape:",
    '{"summary": "<2-4 sentence plain-English summary>",',
    ' "cleanedText": "<the document, lightly cleaned up: fixed line breaks,',
    '   consistent spacing, clear structure — content and tokens unchanged>",',
    ' "nextActions": ["<concrete next step>", "<concrete next step>", "..."]}',
    "Give 2-5 next actions that a freelancer would realistically take next",
    "(e.g. send, record, file, follow up, schedule).",
    "",
    "REDACTED DOCUMENT:",
    redactedText,
  ].join("\n");
}

// ── JSON extraction (models occasionally wrap output in fences) ────────────
function parseModelJSON(raw) {
  if (!raw) throw new Error("The model returned an empty response.");
  let s = raw.trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
  const start = s.indexOf("{");
  const end = s.lastIndexOf("}");
  if (start === -1 || end === -1) throw new Error("The model did not return JSON.");
  return JSON.parse(s.slice(start, end + 1));
}

// ── Live inference via Firebase AI Logic ────────────────────────────────────
// NOTE: per the Firebase AI Logic hybrid docs, getGenerativeModel() with an
// inference mode must be called after/on a user interaction — which is why
// models are created inside the Process button handler, never at page load.
async function runLiveModel(mode, prompt) {
  const { getGenerativeModel } = await import("firebase/ai");
  const model = getGenerativeModel(ai, {
    mode,
    inCloudParams: {
      model: CLOUD_MODEL,
      generationConfig: { temperature: 0.2 },
    },
    // onDeviceParams is intentionally omitted: Chrome's Prompt API picks
    // the on-device Gemini Nano model and its defaults.
  });
  const result = await model.generateContent(prompt);
  const response = result.response;
  return {
    text: response.text(),
    // Available in JS SDK v12.5.0+. 'ON_DEVICE' | 'IN_CLOUD'
    source: response.inferenceSource || null,
  };
}

// ── Mock engine (used only while firebase-config.js has placeholders) ───────
const MOCK_RULES = [
  ["EMAIL", /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g],
  ["CARD", /\b(?:\d[ -]?){13,19}\b/g],
  ["PHONE", /(?:\+\d{1,3}[ -]?)?(?:\(?0\d{1,4}\)?[ -]?)\d{1,4}[ -]?\d{3,4}/g],
  ["AMOUNT", /(?:¥|\$|€|£)\s?[\d,]+(?:\.\d{1,2})?|\b[\d,]+\s?(?:JPY|USD|EUR|GBP|yen|dollars?)\b/gi],
  ["ACCOUNT", /\b(?:IBAN[:\s]*)?[A-Z]{2}\d{2}(?:[ -]?[A-Z0-9]{4}){2,6}\b|\b\d{7,10}\b/g],
  ["DOB", /\b(?:born|DOB|date of birth)[:\s]*\d{4}[-/]\d{1,2}[-/]\d{1,2}\b/gi],
];

function mockRedact(text) {
  let out = text;
  const counts = {};
  const counters = {};
  for (const [type, re] of MOCK_RULES) {
    out = out.replace(re, (m) => {
      // Dates inside a DOB match keep their label; replace whole match.
      counters[type] = (counters[type] || 0) + 1;
      counts[type] = (counts[type] || 0) + 1;
      return `[${type}_${counters[type]}]`;
    });
  }
  // Labelled names: "Name: Jane Smith", "Client: …", "Attn: …"
  out = out.replace(
    /\b(Name|Client|Contact|Attn\.?|Customer)[:\s]+([A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,2})/g,
    (m, label) => {
      counters.NAME = (counters.NAME || 0) + 1;
      counts.NAME = (counts.NAME || 0) + 1;
      return `${label}: [NAME_${counters.NAME}]`;
    },
  );
  // Address-looking lines
  out = out.replace(
    /^[^\n]*\b(Street|St\.|Avenue|Ave\.|Road|Rd\.|City|ZIP|Address)[:\s][^\n]*$/gim,
    () => {
      counters.ADDRESS = (counters.ADDRESS || 0) + 1;
      counts.ADDRESS = (counts.ADDRESS || 0) + 1;
      return `[ADDRESS_${counters.ADDRESS}]`;
    },
  );
  const entities = Object.entries(counts).map(([type, count]) => ({ type, count }));
  return { redactedText: out, entities };
}

function mockSummarize(redactedText) {
  const lines = redactedText.split("\n").map((l) => l.trim()).filter(Boolean);
  const lower = redactedText.toLowerCase();
  const kind = lower.includes("invoice")
    ? "invoice"
    : lower.includes("receipt") || lower.includes("total")
      ? "receipt"
      : lower.includes("subject:") || lower.includes("@") || lower.includes("dear")
        ? "email"
        : "document";
  const tokenCount = (redactedText.match(/\[[A-Z_]+_\d+\]/g) || []).length;
  const subject = lines[0] ? lines[0].slice(0, 90) : "Untitled document";
  const summary =
    `This ${kind} ("${subject}") was processed after ${tokenCount} sensitive ` +
    `span(s) were masked. It contains ${lines.length} non-empty line(s). ` +
    `All names, contact details, account references and amounts were replaced ` +
    `with tokens before this summary was generated, so nothing sensitive was ` +
    `needed — or used — to produce it.`;
  const cleanedText = redactedText
    .replace(/[ \t]+$/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  const actionsByKind = {
    invoice: [
      "Send the invoice to the client and confirm the payment due date",
      "Record the masked amount in your accounting ledger",
      "Set a follow-up reminder a few days before the due date",
    ],
    receipt: [
      "File this receipt under business expenses for the current month",
      "Cross-check the total against your expense tracker",
      "Keep the original in your tax records folder",
    ],
    email: [
      "Draft a reply based on the summary above",
      "Add any promised deliverables to your task list",
      "Archive the thread once the follow-up is sent",
    ],
    document: [
      "Review the cleaned-up version and fix any formatting issues",
      "Save the redacted copy wherever the document needs to be shared",
      "Note any deadlines mentioned in the text",
    ],
  };
  return { summary, cleanedText, nextActions: actionsByKind[kind] };
}

async function runMockModel(step, prompt, sourceText) {
  // Small artificial delay so badges/log read like a real pipeline.
  await new Promise((r) => setTimeout(r, step === 1 ? 650 : 800));
  if (step === 1) {
    const onDeviceAvailable = els.mockOnDeviceToggle.checked;
    const data = mockRedact(sourceText);
    return {
      data,
      source: onDeviceAvailable ? "ON_DEVICE" : "IN_CLOUD",
      fellBack: !onDeviceAvailable,
    };
  }
  return { data: mockSummarize(sourceText), source: "IN_CLOUD", fellBack: false };
}

// ── Rendering ───────────────────────────────────────────────────────────────
function renderEntities(entities) {
  els.entityList.innerHTML = "";
  if (!entities || entities.length === 0) {
    els.entityList.className = "entity-list empty";
    els.entityList.textContent = "No sensitive entities were detected in this text.";
    return 0;
  }
  els.entityList.className = "entity-list";
  let total = 0;
  for (const e of entities) {
    total += e.count || 0;
    const chip = document.createElement("span");
    chip.className = "entity-chip";
    const b = document.createElement("b");
    b.textContent = e.type;
    chip.appendChild(b);
    chip.appendChild(document.createTextNode(` × ${e.count}`));
    els.entityList.appendChild(chip);
  }
  return total;
}

function renderSummary(data) {
  els.summaryOutput.textContent = data.summary || "—";
  els.cleanedOutput.textContent = data.cleanedText || "—";
  els.actionsOutput.innerHTML = "";
  const actions = Array.isArray(data.nextActions) ? data.nextActions : [];
  if (actions.length === 0) {
    const li = document.createElement("li");
    li.textContent = "—";
    els.actionsOutput.appendChild(li);
  } else {
    for (const a of actions) {
      const li = document.createElement("li");
      li.textContent = a;
      els.actionsOutput.appendChild(li);
    }
  }
}

// ── Pipeline ────────────────────────────────────────────────────────────────
async function processDocument() {
  const rawText = els.input.value;
  if (!rawText.trim()) {
    log("Nothing to process — paste some text first.", "log-warn");
    els.input.focus();
    return;
  }
  hideFallbackBanner();
  els.processBtn.disabled = true;
  els.copyRedactedBtn.disabled = true;
  els.copySummaryBtn.disabled = true;
  setStepBadge(1, "RUNNING…", "running");
  setStepBadge(2, "WAITING", "idle");
  setModeBadge(null, "WORKING…");
  log(`Pipeline started (${MOCK_MODE ? "mock" : "live"} mode) — ${rawText.length} characters.`);

  try {
    // ── STEP 1 · Redaction (prefer on-device) ──────────────────────────────
    const t1 = performance.now();
    let step1;
    if (MOCK_MODE) {
      step1 = await runMockModel(1, null, rawText);
    } else {
      const res = await runLiveModel(
        InferenceMode.PREFER_ON_DEVICE,
        redactionPrompt(rawText),
      );
      step1 = {
        data: parseModelJSON(res.text),
        // If an older SDK does not report inferenceSource, PREFER_ON_DEVICE
        // gives us no proof of on-device execution — say so honestly.
        source: res.source || "UNKNOWN",
        fellBack: res.source === "IN_CLOUD",
      };
    }
    const d1 = performance.now() - t1;
    const totalEntities = renderEntities(step1.data.entities);
    els.redactedOutput.textContent = step1.data.redactedText || "";
    els.copyRedactedBtn.disabled = !step1.data.redactedText;
    setStepBadge(
      1,
      step1.source === "ON_DEVICE" ? "ON-DEVICE" : step1.source === "IN_CLOUD" ? "CLOUD" : step1.source,
      step1.source === "ON_DEVICE" ? "ondevice" : step1.source === "IN_CLOUD" ? "cloud" : "warn",
    );
    setModeBadge(step1.source);
    logRun("STEP 1 · REDACTION", "PREFER_ON_DEVICE", step1.source, d1,
      ` · ${totalEntities} sensitive span(s) masked`);

    if (step1.fellBack || step1.source === "IN_CLOUD") {
      showFallbackBanner(
        "⚠ On-device inference was unavailable, so Step 1 (redaction) fell back " +
          "to the cloud: for this run, the RAW text was processed by the cloud " +
          "model. Step 2 still only receives the redacted text. Use a recent " +
          "desktop Chrome with the Prompt API enabled to keep redaction on-device.",
      );
      log("Fallback: on-device unavailable → redaction executed in cloud. Raw text left the device for Step 1 only.", "log-warn");
    }
    if (step1.source === "UNKNOWN") {
      log("The SDK did not report inferenceSource for Step 1, so the execution location cannot be confirmed.", "log-warn");
    }

    // ── STEP 2 · Summary (cloud, redacted text ONLY) ───────────────────────
    setStepBadge(2, "RUNNING…", "running");
    const t2 = performance.now();
    let step2;
    if (MOCK_MODE) {
      step2 = await runMockModel(2, null, step1.data.redactedText);
    } else {
      const res = await runLiveModel(
        InferenceMode.ONLY_IN_CLOUD,
        summaryPrompt(step1.data.redactedText), // ← redacted text, never rawText
      );
      step2 = { data: parseModelJSON(res.text), source: res.source || "IN_CLOUD" };
    }
    const d2 = performance.now() - t2;
    renderSummary(step2.data);
    els.copySummaryBtn.disabled = false;
    setStepBadge(2, "CLOUD", "cloud");
    setModeBadge("IN_CLOUD");
    logRun("STEP 2 · SUMMARY", "ONLY_IN_CLOUD", step2.source, d2,
      " · input was the redacted text only");
    log("Pipeline complete. The raw document was never stored or sent anywhere else.");
  } catch (err) {
    console.error(err);
    setStepBadge(1, "ERROR", "error");
    setModeBadge(null);
    log(`Error: ${err && err.message ? err.message : err}`, "log-error");
    if (!MOCK_MODE) {
      log("Tip: check firebase-config.js, that AI Logic is enabled in the Firebase console, and that App Check is registered for this domain.", "log-warn");
    }
  } finally {
    els.processBtn.disabled = false;
  }
}

// ── Samples (all people, companies and numbers below are fictional) ─────────
const SAMPLES = {
  invoice: [
    "INVOICE MEMO — October work",
    "From: Yuki Tanaka, Tanaka Design Studio",
    "Address: 2-14-6 Sakura Street, Meguro City, Tokyo 152-0002",
    "Email: yuki.tanaka@example-mail.com / Phone: 090-1234-5678",
    "Bill to: Kenji Watanabe, Watanabe Logistics K.K.",
    "",
    "Logo design package: ¥120,000",
    "Extra revisions (2 rounds): ¥30,000",
    "Total due: ¥150,000 by 2026-11-30",
    "Please transfer to: Sakura Bank, Account 1234567, Yuki Tanaka",
  ].join("\n"),
  email: [
    "Subject: Payment confirmation and next project",
    "From: Sarah Mitchell <sarah.mitchell@northwind-retail.com>",
    "",
    "Dear Alex Rivera,",
    "",
    "Thank you — we received your payment of $2,450.00 on 2026-11-18.",
    "For the refund of the cancelled item, we will use the card ending",
    "in 4242 4242 4242 4242 on file.",
    "",
    "Could you send the updated contract to my office at",
    "480 Market Avenue, Springfield? My direct line is +1 555-013-4471.",
    "",
    "Best regards,",
    "Sarah Mitchell",
  ].join("\n"),
  receipt: [
    "RECEIPT — transcribed from paper",
    "Store: Higashi Office Supplies, 1-3-9 Ginza, Chuo City, Tokyo",
    "Date: 2026-11-20 14:32",
    "Customer: Hayato Kamiyama (member no. 8842-1103)",
    "",
    "A4 copy paper x3        ¥1,440",
    "Ink cartridge (black)   ¥3,280",
    "USB-C cable             ¥1,980",
    "------------------------------",
    "Total                   ¥6,700",
    "Paid by card **** 9012",
    "Change                  ¥0",
  ].join("\n"),
};

// ── Live-mode initialisation ────────────────────────────────────────────────
async function initLive() {
  const { initializeApp } = await import("firebase/app");
  const app = initializeApp(firebaseConfig);

  // Firebase App Check — protects the AI Logic backend from abuse.
  // Debug tokens are supported for development/demos (see README).
  if (appCheckConfig.useDebugToken) {
    // Must be set BEFORE initializeAppCheck() is called.
    self.FIREBASE_APPCHECK_DEBUG_TOKEN = appCheckConfig.debugToken
      ? appCheckConfig.debugToken
      : true;
  }
  if (!isPlaceholderSiteKey()) {
    try {
      const { initializeAppCheck, ReCaptchaEnterpriseProvider } = await import("firebase/app-check");
      initializeAppCheck(app, {
        provider: new ReCaptchaEnterpriseProvider(appCheckConfig.recaptchaEnterpriseSiteKey),
        isTokenAutoRefreshEnabled: true,
      });
      setBadge(
        els.appCheckBadge,
        appCheckConfig.useDebugToken ? "ACTIVE · DEBUG TOKEN" : "ACTIVE",
        "live",
      );
      log("Firebase App Check initialised" +
        (appCheckConfig.useDebugToken ? " (debug-token mode for development)." : "."));
    } catch (e) {
      setBadge(els.appCheckBadge, "INIT FAILED", "error");
      log(`App Check failed to initialise: ${e.message || e}`, "log-error");
    }
  } else {
    setBadge(els.appCheckBadge, "SITE KEY NOT SET", "warn");
    log("App Check: reCAPTCHA Enterprise site key is still a placeholder — add it in firebase-config.js to enable App Check.", "log-warn");
  }

  const aiModule = await import("firebase/ai");
  InferenceMode = aiModule.InferenceMode;
  ai = aiModule.getAI(app, { backend: new aiModule.GoogleAIBackend() });
  setBadge(els.connBadge, "LIVE · FIREBASE AI LOGIC", "live");
  log(`Connected to Firebase project "${firebaseConfig.projectId}" — AI Logic ready (cloud model: ${CLOUD_MODEL}).`);
}

async function probePromptApi() {
  // Informational only: Firebase AI Logic makes the real routing decision.
  try {
    const lm =
      (window.ai && window.ai.languageModel) || window.LanguageModel || null;
    if (!lm || typeof lm.availability !== "function") {
      log("Environment probe: Chrome Prompt API not detected in this browser — cloud fallback will be used where needed.");
      return;
    }
    const availability = await lm.availability();
    log(`Environment probe: Chrome Prompt API (Gemini Nano) availability = "${availability}".`);
  } catch {
    log("Environment probe: could not query the Chrome Prompt API (this is informational only).");
  }
}

// ── Wiring ──────────────────────────────────────────────────────────────────
function init() {
  if (MOCK_MODE) {
    els.mockBanner.classList.remove("hidden");
    setBadge(els.connBadge, "MOCK MODE", "mock");
    setBadge(els.appCheckBadge, "N/A · MOCK", "idle");
    log("Mock mode: firebase-config.js contains placeholder values, so inference is simulated locally. Fill in the config to go live.");
    els.mockOnDeviceToggle.addEventListener("change", () => {
      log(els.mockOnDeviceToggle.checked
        ? "Mock setting: on-device model marked AVAILABLE — Step 1 will report ON_DEVICE."
        : "Mock setting: on-device model marked UNAVAILABLE — Step 1 will fall back to CLOUD and show the warning banner.");
    });
  } else {
    els.mockBanner.classList.add("hidden");
    initLive().catch((e) => {
      console.error(e);
      setBadge(els.connBadge, "CONNECTION FAILED", "error");
      log(`Firebase initialisation failed: ${e.message || e}`, "log-error");
    });
  }
  probePromptApi();

  const updateCount = () =>
    (els.charCount.textContent = `${els.input.value.length} characters`);
  els.input.addEventListener("input", updateCount);
  updateCount();

  document.querySelectorAll("[data-sample]").forEach((btn) => {
    btn.addEventListener("click", () => {
      els.input.value = SAMPLES[btn.dataset.sample] || "";
      updateCount();
      els.input.focus();
    });
  });

  els.processBtn.addEventListener("click", processDocument);
  els.clearBtn.addEventListener("click", () => {
    els.input.value = "";
    updateCount();
    els.input.focus();
  });
  els.copyRedactedBtn.addEventListener("click", () =>
    copyText(els.redactedOutput.textContent, els.copyRedactedBtn));
  els.copySummaryBtn.addEventListener("click", () =>
    copyText(
      [
        "SUMMARY",
        els.summaryOutput.textContent,
        "",
        "CLEANED-UP VERSION",
        els.cleanedOutput.textContent,
        "",
        "NEXT ACTIONS",
        ...[...els.actionsOutput.querySelectorAll("li")].map((li) => `- ${li.textContent}`),
      ].join("\n"),
      els.copySummaryBtn,
    ));
  els.clearLogBtn.addEventListener("click", () => {
    els.logOutput.innerHTML = '<p class="log-empty">No inference runs yet.</p>';
  });
}

init();
