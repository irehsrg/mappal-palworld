// Thin wrapper around posthog-js so non-React modules (the zustand store) can
// report usage without knowing whether analytics is initialized. The privacy
// contract, matching the Vercel Analytics note in main.tsx: only counts and
// flags are ever sent — never blueprint contents, file names, coordinates, or
// anything derived from the user's save data.
import posthog from "posthog-js";

// PostHog project tokens (phc_) are public by design — they can capture events
// but cannot read project data (docs/product-analytics/troubleshooting).
const POSTHOG_TOKEN = "phc_rZmqeWt6tUmHRXtG6zeuXn9vs8bF8UHmvKS9jFzoYc87";

export function initAnalytics() {
  if (typeof window === "undefined") return;
  posthog.init(POSTHOG_TOKEN, {
    api_host: "https://us.i.posthog.com",
    defaults: "2026-05-30",
    // Uncaught errors + unhandled rejections; pairs with the fail-loudly
    // loader — schema drift in the wild shows up here instead of in issues.
    capture_exceptions: true,
    // Replay is decided server-side per project settings; if enabled, inputs
    // are masked. The 3D canvas is fine to record — it renders gray-box
    // proxies, not the user's file.
    session_recording: { maskAllInputs: true },
  });
}

// Content-free event capture. Props must be counts/flags only.
export function track(
  event: string,
  props?: Record<string, number | boolean | string>
) {
  if (typeof window === "undefined") return;
  try {
    posthog.capture(event, props);
  } catch {
    // Analytics must never break the editor.
  }
}
