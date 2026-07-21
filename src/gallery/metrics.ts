// Anonymous funnel counters — fire-and-forget, count-only (see the metrics
// migration for the whitelist and docs/GALLERY.md for the policy). A failed
// or blocked ping must never affect the editor, so errors are swallowed and
// nothing awaits these.
import { supabase } from "./supabaseClient";

export type MetricKey =
  | "base_loaded"
  | "sample_opened"
  | "blank_opened"
  | "base_exported"
  | "base_published"
  | "gallery_opened";

export function bumpMetric(metric: MetricKey): void {
  if (!supabase) return;
  void supabase.rpc("bump_metric", { metric }).then(
    () => undefined,
    () => undefined,
  );
}
