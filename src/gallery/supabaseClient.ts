// Supabase client for the community gallery (docs/GALLERY.md). The gallery
// is an OPTIONAL layer: with the env vars absent, `supabase` is null,
// `galleryEnabled` is false, and no gallery UI renders — the editor itself
// never depends on this file working. That keeps the amended C3 promise
// visible in code: the editor is client-side; only Publish talks to a server.
//
// The anon key is public by design (it ships in the JS bundle). Postgres
// row-level security policies in supabase/migrations/ are the actual
// security boundary — never treat this key as a secret or add privileged
// logic client-side.
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export const supabase: SupabaseClient | null =
  url && anonKey ? createClient(url, anonKey) : null;

export const galleryEnabled = supabase !== null;

/** Narrow the nullable client at call sites that only run when enabled. */
export function requireSupabase(): SupabaseClient {
  if (!supabase) throw new Error("gallery is not configured (missing VITE_SUPABASE_* env vars)");
  return supabase;
}
