# Community Base Gallery

The base library: sign in, publish a base to a public gallery anyone can
browse and open in the editor, or save bases privately to your account.
Requested by Geezusotl (r/Palworld, 2026-07-21): "is it possible to build a
library of bases in the site? theres literally none as far as i know besides
the few that are in the pst discord."

## The C3 amendment (read this first)

CLAUDE.md C3 said: client-side only, no backend, no upload. The gallery
deliberately amends that — decided by Alex on 2026-07-21, not drifted into.
The amended rule:

> **The editor remains fully client-side.** Parsing, editing, and export
> never touch a server. A blueprint leaves the machine in exactly one case:
> the user clicks **Publish** (or **Save to account**) on a base they chose
> to share. Everything else about C3 stands.

Every public claim ("your files never leave your machine") must be updated to
this wording wherever it appears: README, Nexus description, Steam guide,
in-app copy.

## Architecture

- The site stays a static Vite SPA on Vercel. **No server code of ours.**
- [Supabase](https://supabase.com) provides auth, Postgres, and file storage
  as a hosted API the browser calls directly via `@supabase/supabase-js`.
- Security is Postgres **row-level security** (RLS), not an API layer:
  the anon key is public by design; the policies are the boundary.
- Auth: Discord OAuth first (this community lives on Discord), GitHub as
  the fallback. Both are dashboard config, zero code difference.

### Why Supabase over the field

| Option | Verdict |
|---|---|
| Supabase | Auth + DB + storage integrated, Discord OAuth built in, generous free tier. **Chosen.** |
| Cloudflare (Workers/D1/R2) | Most generous storage/egress long-term, but auth is DIY. Documented scale path for blobs (R2 has zero egress fees). |
| Firebase | Storage now effectively requires a billing card. Out. |
| Vercel storage products | Thin wrappers over other vendors, less integrated auth. Out. |

### Free-tier budget (Supabase, as of 2026-07)

| Resource | Limit | Our math |
|---|---|---|
| Auth MAU | 50,000 | non-issue |
| Postgres | 500 MB | metadata only; ~100K+ rows |
| Storage | 1 GB | blueprints stored **gzipped** (~16× smaller: 29MB tower → ~1.8MB; typical base 100–500KB). ≈2–5K bases |
| Egress | 5 GB/mo | **first real ceiling**: ≈15–25K downloads/mo. Fix: Supabase Pro $25/mo, or move blobs to Cloudflare R2 (zero egress) keeping auth/DB on Supabase |
| Edge functions | 500K/mo | reserved for future server-side revalidation |

Free projects pause after ~7 days of zero API activity. Real traffic
prevents it; a scheduled Vercel cron ping is the belt-and-suspenders.

## Data model

One table, one flag: a private save and a public gallery entry are the same
row with `is_public` toggled. See
`supabase/migrations/*_gallery.sql` for the source of truth.

- `bases`: id, owner (auth.users FK), owner_name (denormalized display name
  captured at publish), title, description, piece_count, type_breakdown
  (jsonb `{typeId: count}`), is_public, blob_path, thumb_path, downloads,
  timestamps.
- `reports`: base_id, reporter, reason. Insert-only for signed-in users; no
  select policy — reports are read by the operator in the dashboard.
- Quota: a before-insert trigger caps each account at 100 bases.
- Downloads: `increment_downloads(base_id)` SECURITY DEFINER RPC so
  anonymous visitors can bump the counter without update rights.

### Storage

Two buckets:

- `bases` (private): gzipped blueprint JSON at `<uid>/<baseId>.json.gz`,
  6 MB/file cap. Readable when the matching row is public, or by the owner.
- `thumbs` (public): JPEG thumbnail at `<uid>/<baseId>.jpg`, 512 KB cap,
  captured client-side from the three.js canvas at publish time.

Upload/delete policies restrict everyone to their own `<uid>/` folder.
Blob is uploaded first, then the row inserted (id generated client-side);
a failed insert can orphan a blob — acceptable at MVP, the owner's folder
is theirs to overwrite and quota is enforced on rows, not blobs.

## Publish flow

1. User has a base loaded (which means it already passed the loader and
   lints — you can only publish what the editor accepted).
2. Publish dialog: title, description, public/private toggle, and the
   **privacy disclosure** (below).
3. On submit: `exportBlueprint()` produces exactly the text an Export
   download would — published file ≡ exported file, no separate path —
   then gzip via native `CompressionStream`, snapshot the canvas for the
   thumbnail, upload both, insert the row.

Opening a gallery base: download blob → `DecompressionStream` → same
`loadFile()` as drag-and-drop. The gallery is just another way files arrive.

## Privacy: disclose, never transform

PST exports carry player-identifying fields. Observed in real fixtures
(C4: these names are from files, not guessed): `build_player_uid`,
`pickupdable_player_uid`, `private_lock_player_uid` per map object, a
`characters` array (pals, potentially with owner data), and the base camp
`name`. In our fixtures the UIDs are sentinel-looking (all-zeros /
`…0001`) and `characters` is empty, but multiplayer worlds will differ.

The publish dialog runs `scanForPersonalData()` and shows what the file
carries (N pals, M distinct player IDs). **We do not strip or rewrite
anything** — editing opaque fields risks producing a file that imports
broken (C5), and any transform would need its own in-game verification
before we could trust it. The tool warns; the user decides. A verified
"strip characters" option is future work gated on an in-game import test.

## Moderation

- RLS: users touch only their own rows/files. Operator (dashboard/service
  role) can remove anything.
- Report button on every public base → `reports` row.
- Blueprints are inert JSON rendered as gray boxes; the abuse surface is
  titles/descriptions/thumbnails. Discord sign-in is the spam friction.

## Setup checklist (Alex)

One-time, ~15 minutes total:

1. **Supabase project**: dashboard → New project (org from the liftlog
   account is fine) → name `mappal`. Copy the project ref.
2. **Link + push schema**: `npx supabase login`, then
   `npx supabase link --project-ref <ref>` and `npx supabase db push`
   (runs the migration in `supabase/migrations/`).
3. **Discord OAuth**: Discord Developer Portal → New Application →
   OAuth2 → copy Client ID/Secret → Supabase dashboard → Auth →
   Providers → Discord → paste both. Add Supabase's callback URL
   (shown on that page) to the Discord app's redirect list.
   GitHub provider: same dance on github.com/settings/developers.
4. **Auth URLs**: Supabase → Auth → URL Configuration → Site URL
   `https://mappal-palworld.vercel.app`, plus `http://localhost:5173`
   in Additional Redirect URLs.
5. **Env vars**: project Settings → API → copy Project URL and anon key →
   Vercel dashboard → mappal project → Environment Variables →
   `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` → redeploy.
   Locally: same two keys in `.env.local` (see `.env.example`).

The app runs fine with the env vars absent — gallery UI simply doesn't
render. That keeps dev, CI, and forks working with zero setup.

## Metrics (anonymous funnel counters)

Vercel Analytics shows reach (visitors/referrers) but not activation. The
`metrics` table holds a single integer per event key — `base_loaded`,
`sample_opened`, `blank_opened`, `base_exported`, `base_published`,
`gallery_opened` — bumped via a whitelisting SECURITY DEFINER RPC.
**Count-only by design**: no user ids, no sessions, no per-event timestamps,
nothing joinable. Fire-and-forget on the client; failures never affect the
editor. Totals are publicly readable:

```
curl "https://<ref>.supabase.co/rest/v1/metrics?select=*" -H "apikey: <anon>"
```

The number that matters is base_loaded → base_exported: the difference
between a pretty landing page and a tool people actually use.

## Deep links

`/?base=<id>` opens a public gallery base straight in the editor. Every
card has Copy link; the publish success screen offers the same. This is the
distribution loop: a base shared in any Discord is one click from being
open in MapPal.

## Future hardening (not MVP)

- Edge-function revalidation of submissions with the same `src/parse`
  loader (it's framework-agnostic TS; runs in Deno as-is).
- R2 for blobs when egress approaches 5 GB/mo.
- Search/tags/sort beyond newest-first.
- Verified character-strip option (needs an in-game import test first).
