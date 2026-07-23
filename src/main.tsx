import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Analytics } from "@vercel/analytics/react";
import { App } from "./App";
import { initAnalytics } from "./analytics";
import "./index.css";

const rootEl = document.getElementById("root");
if (!rootEl) {
  throw new Error("main.tsx: #root element not found in index.html");
}

// Vercel Web Analytics sends page-view/visitor counts only — no cookies, no
// cross-site tracking, and critically no blueprint data. CLAUDE.md C3 ("client
// side only, no upload") is about the user's base files: those are read via
// FileReader and never leave the browser. That stays true.
// PostHog (src/analytics.ts) adds feature-usage counts and error capture under
// the same contract: counts and flags only, never blueprint content.
initAnalytics();
createRoot(rootEl).render(
  <StrictMode>
    <App />
    <Analytics />
  </StrictMode>,
);
