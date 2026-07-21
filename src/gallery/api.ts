// Gallery data access. Thin, typed wrappers over supabase-js — RLS policies
// (supabase/migrations/) enforce every rule these functions rely on; nothing
// here is trusted for security.
import { requireSupabase } from "./supabaseClient";
import { gzipText, gunzipToText } from "./compress";

/** Row shape of public.bases (see the migration for authoritative DDL). */
export interface GalleryRow {
  id: string;
  owner: string;
  owner_name: string;
  title: string;
  description: string;
  piece_count: number;
  type_breakdown: Record<string, number>;
  is_public: boolean;
  blob_path: string;
  thumb_path: string | null;
  downloads: number;
  created_at: string;
}

const ROW_COLUMNS =
  "id, owner, owner_name, title, description, piece_count, type_breakdown, is_public, blob_path, thumb_path, downloads, created_at";

export async function listPublicBases(limit = 60): Promise<GalleryRow[]> {
  const sb = requireSupabase();
  const { data, error } = await sb
    .from("bases")
    .select(ROW_COLUMNS)
    .eq("is_public", true)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(`gallery list failed: ${error.message}`);
  return (data ?? []) as GalleryRow[];
}

export async function listMyBases(): Promise<GalleryRow[]> {
  const sb = requireSupabase();
  const { data: userData } = await sb.auth.getUser();
  const uid = userData.user?.id;
  if (!uid) return [];
  const { data, error } = await sb
    .from("bases")
    .select(ROW_COLUMNS)
    .eq("owner", uid)
    .order("created_at", { ascending: false });
  if (error) throw new Error(`my bases list failed: ${error.message}`);
  return (data ?? []) as GalleryRow[];
}

export interface PublishInput {
  title: string;
  description: string;
  isPublic: boolean;
  ownerName: string;
  /** Exactly what exportBlueprint() produced — published file ≡ exported file. */
  blueprintText: string;
  pieceCount: number;
  typeBreakdown: Record<string, number>;
  /** JPEG snapshot of the viewport canvas; null if capture failed. */
  thumbnail: Blob | null;
}

export async function publishBase(input: PublishInput): Promise<GalleryRow> {
  const sb = requireSupabase();
  const { data: userData } = await sb.auth.getUser();
  const uid = userData.user?.id;
  if (!uid) throw new Error("sign in to publish");

  // Id generated client-side so the storage paths and the row agree without
  // a round-trip. Blob first, row second (see docs/GALLERY.md on orphans).
  const id = crypto.randomUUID();
  const blobPath = `${uid}/${id}.json.gz`;
  const thumbPath = input.thumbnail ? `${uid}/${id}.jpg` : null;

  const gz = await gzipText(input.blueprintText);
  const { error: blobErr } = await sb.storage.from("bases").upload(blobPath, gz, {
    contentType: "application/gzip",
  });
  if (blobErr) throw new Error(`upload failed: ${blobErr.message}`);

  if (input.thumbnail && thumbPath) {
    // Thumbnail failure shouldn't sink a publish — the card just renders
    // without a preview.
    await sb.storage.from("thumbs").upload(thumbPath, input.thumbnail, {
      contentType: "image/jpeg",
    });
  }

  const { data, error } = await sb
    .from("bases")
    .insert({
      id,
      owner: uid,
      owner_name: input.ownerName.slice(0, 64),
      title: input.title,
      description: input.description,
      piece_count: input.pieceCount,
      type_breakdown: input.typeBreakdown,
      is_public: input.isPublic,
      blob_path: blobPath,
      thumb_path: thumbPath,
    })
    .select(ROW_COLUMNS)
    .single();
  if (error) {
    // Best-effort cleanup of the just-uploaded blob so a quota rejection
    // doesn't leave storage junk behind.
    await sb.storage.from("bases").remove([blobPath]);
    throw new Error(`publish failed: ${error.message}`);
  }
  return data as GalleryRow;
}

/** Download + decompress a base; returns blueprint JSON text ready for loadFile(). */
export async function openBase(row: GalleryRow): Promise<string> {
  const sb = requireSupabase();
  const { data, error } = await sb.storage.from("bases").download(row.blob_path);
  if (error || !data) throw new Error(`download failed: ${error?.message ?? "no data"}`);
  if (row.is_public) {
    // Fire-and-forget; a lost count is not worth failing the open.
    void sb.rpc("increment_downloads", { base_id: row.id });
  }
  return gunzipToText(data);
}

export async function deleteBase(row: GalleryRow): Promise<void> {
  const sb = requireSupabase();
  // Storage first (paths are only discoverable via the row), then the row.
  const paths = [row.blob_path];
  await sb.storage.from("bases").remove(paths);
  if (row.thumb_path) await sb.storage.from("thumbs").remove([row.thumb_path]);
  const { error } = await sb.from("bases").delete().eq("id", row.id);
  if (error) throw new Error(`delete failed: ${error.message}`);
}

export async function reportBase(baseId: string, reason: string): Promise<void> {
  const sb = requireSupabase();
  const { data: userData } = await sb.auth.getUser();
  const { error } = await sb.from("reports").insert({
    base_id: baseId,
    reporter: userData.user?.id ?? null,
    reason,
  });
  if (error) throw new Error(`report failed: ${error.message}`);
}

export function thumbUrl(row: GalleryRow): string | null {
  if (!row.thumb_path) return null;
  const sb = requireSupabase();
  return sb.storage.from("thumbs").getPublicUrl(row.thumb_path).data.publicUrl;
}
