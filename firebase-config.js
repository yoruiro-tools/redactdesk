// ─────────────────────────────────────────────────────────────────────────────
// RedactDesk — Firebase configuration (PLACEHOLDER VALUES)
//
// Replace every "YOUR_..." value with the real values from your Firebase
// project: Firebase console → Project settings → General → Your apps →
// SDK setup and configuration.
//
// While the placeholders are in place, the app automatically runs in
// MOCK MODE: the full two-step pipeline, mode badges, fallback notice and
// inference log all work locally so the flow can be demoed and judged
// without a live Firebase project.
// ─────────────────────────────────────────────────────────────────────────────

export const firebaseConfig = {
  apiKey: "AIzaSyCxIO9rdQKnqMxsZ4VpqNMhGZmk2ywP_dI",
  authDomain: "yoruiro-hybrid-ai.firebaseapp.com",
  projectId: "yoruiro-hybrid-ai",
  storageBucket: "yoruiro-hybrid-ai.firebasestorage.app",
  messagingSenderId: "648574823526",
  appId: "1:648574823526:web:9bc6bd5537e5bedff351a7",
};

// Firebase App Check settings.
//
// The web app is registered in Firebase App Check with the Google Cloud
// Fraud Defense (reCAPTCHA Enterprise) provider — the reCAPTCHA Classic
// (v3) provider is deprecated and its form is disabled in the Firebase
// console, so the Enterprise site key below is the registered one.
//
// For local development / demos, App Check debug tokens are supported:
// set `useDebugToken: true`, load the page once, copy the debug token that
// the App Check SDK prints to the browser console, and register it in
// Firebase console → App Check → Apps → ⋮ → Manage debug tokens.
// You may also pin a pre-registered token in `debugToken`.
export const appCheckConfig = {
  recaptchaEnterpriseSiteKey: "6LeSiSwuAAAAAHqHsR-RFmbwjJnxnVXpEiC4CzKd",
  useDebugToken: false,
  debugToken: "", // optional: a pre-registered debug token (UUID string)
};

// Model used for the cloud step (and as the cloud fallback for step 1).
// Any Gemini model enabled for your Firebase AI Logic backend works.
export const CLOUD_MODEL = "gemini-2.5-flash";

// Returns true while the config still contains placeholder values.
export function isPlaceholderConfig() {
  return (
    !firebaseConfig.apiKey ||
    firebaseConfig.apiKey.startsWith("YOUR_") ||
    !firebaseConfig.projectId ||
    firebaseConfig.projectId.startsWith("YOUR_") ||
    !firebaseConfig.appId ||
    firebaseConfig.appId.startsWith("YOUR_")
  );
}

export function isPlaceholderSiteKey() {
  return (
    !appCheckConfig.recaptchaEnterpriseSiteKey ||
    appCheckConfig.recaptchaEnterpriseSiteKey.startsWith("YOUR_")
  );
}
