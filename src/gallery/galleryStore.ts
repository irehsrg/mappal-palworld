// Session + gallery UI state (zustand, same pattern as the other stores).
// Auth is Supabase OAuth (Discord first — this community lives on Discord).
// The store is inert when the gallery isn't configured: init() no-ops and
// nothing subscribes.
import { create } from "zustand";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "./supabaseClient";

interface GalleryUiState {
  session: Session | null;
  /** Browse modal open? */
  galleryOpen: boolean;
  /** Publish dialog open? */
  publishOpen: boolean;
  setGalleryOpen(open: boolean): void;
  setPublishOpen(open: boolean): void;
  signIn(provider: "discord" | "github"): Promise<void>;
  signOut(): Promise<void>;
}

export const useGalleryStore = create<GalleryUiState>((set) => ({
  session: null,
  galleryOpen: false,
  publishOpen: false,

  setGalleryOpen: (open) => set({ galleryOpen: open }),
  setPublishOpen: (open) => set({ publishOpen: open }),

  async signIn(provider) {
    if (!supabase) return;
    // Redirect flow: leaves the page, comes back with a session in the URL
    // hash which supabase-js picks up automatically (detectSessionInUrl).
    await supabase.auth.signInWithOAuth({
      provider,
      options: { redirectTo: window.location.origin },
    });
  },

  async signOut() {
    if (!supabase) return;
    await supabase.auth.signOut();
  },
}));

// Subscribe once at module load — mirrors how autosave wires itself up.
if (supabase) {
  void supabase.auth.getSession().then(({ data }) => {
    useGalleryStore.setState({ session: data.session });
  });
  supabase.auth.onAuthStateChange((_event, session) => {
    useGalleryStore.setState({ session });
  });
}

/** Display name for the signed-in user (Discord/GitHub username), or "". */
export function sessionDisplayName(session: Session | null): string {
  if (!session) return "";
  const meta = session.user.user_metadata as Record<string, unknown>;
  const name = meta.full_name ?? meta.name ?? meta.user_name ?? meta.preferred_username;
  return typeof name === "string" ? name : (session.user.email ?? "");
}
