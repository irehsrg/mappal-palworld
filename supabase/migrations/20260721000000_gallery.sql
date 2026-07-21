-- Community base gallery + private saves. Design rationale: docs/GALLERY.md.
-- The anon key is public by design — these policies ARE the security boundary.

-- ---------------------------------------------------------------- bases
create table public.bases (
  id uuid primary key default gen_random_uuid(),
  owner uuid not null references auth.users (id) on delete cascade,
  -- Denormalized display name captured at publish time (Discord/GitHub
  -- username). Avoids exposing auth.users to the client for joins.
  owner_name text not null default '' check (char_length(owner_name) <= 64),
  title text not null check (char_length(title) between 1 and 80),
  description text not null default '' check (char_length(description) <= 2000),
  piece_count integer not null check (piece_count >= 0),
  -- {typeId: count} for the card's "what's in it" line. Client-computed.
  type_breakdown jsonb not null default '{}'::jsonb,
  -- Private save and public gallery entry are the same row, one flag apart.
  is_public boolean not null default false,
  -- storage paths: bases/<uid>/<id>.json.gz and thumbs/<uid>/<id>.jpg
  blob_path text not null,
  thumb_path text,
  downloads integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index bases_public_idx on public.bases (is_public, created_at desc);
create index bases_owner_idx on public.bases (owner);

alter table public.bases enable row level security;

create policy "public bases readable by everyone, private by owner"
  on public.bases for select
  using (is_public or auth.uid() = owner);

create policy "users insert their own bases"
  on public.bases for insert to authenticated
  with check (auth.uid() = owner);

create policy "users update their own bases"
  on public.bases for update to authenticated
  using (auth.uid() = owner)
  with check (auth.uid() = owner);

create policy "users delete their own bases"
  on public.bases for delete to authenticated
  using (auth.uid() = owner);

-- Per-account quota so one account can't fill the free-tier storage.
-- SECURITY DEFINER so the count sees all the user's rows regardless of RLS.
create function public.enforce_base_quota()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if (select count(*) from public.bases where owner = new.owner) >= 100 then
    raise exception 'base limit reached (100 per account)';
  end if;
  return new;
end;
$$;

create trigger bases_quota
  before insert on public.bases
  for each row execute function public.enforce_base_quota();

-- Download counter anonymous visitors can bump without update rights on the
-- row. Only counts public bases so private-save opens don't inflate numbers.
create function public.increment_downloads(base_id uuid)
returns void
language sql
security definer
set search_path = public
as $$
  update public.bases
  set downloads = downloads + 1
  where id = base_id and is_public;
$$;

-- --------------------------------------------------------------- reports
create table public.reports (
  id uuid primary key default gen_random_uuid(),
  base_id uuid not null references public.bases (id) on delete cascade,
  reporter uuid references auth.users (id) on delete set null,
  reason text not null check (char_length(reason) between 1 and 500),
  created_at timestamptz not null default now()
);

alter table public.reports enable row level security;

-- Insert-only for signed-in users. Deliberately NO select policy: reports
-- are read by the operator via the dashboard/service role, not by clients.
create policy "signed-in users can file reports"
  on public.reports for insert to authenticated
  with check (auth.uid() is not null);

-- --------------------------------------------------------------- storage
-- bases: private bucket; blob readable when its row is public, or by owner.
-- thumbs: public bucket (thumbnails are inherently public content).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('bases', 'bases', false, 6291456, array['application/gzip', 'application/octet-stream']),
  ('thumbs', 'thumbs', true, 524288, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

-- Everyone is confined to their own <uid>/ folder for writes.
create policy "upload own base blobs"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'bases'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "read public or own base blobs"
  on storage.objects for select
  using (
    bucket_id = 'bases'
    and (
      (storage.foldername(name))[1] = auth.uid()::text
      or exists (
        select 1 from public.bases b
        where b.blob_path = name and b.is_public
      )
    )
  );

create policy "delete own base blobs"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'bases'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "upload own thumbs"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'thumbs'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "delete own thumbs"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'thumbs'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
