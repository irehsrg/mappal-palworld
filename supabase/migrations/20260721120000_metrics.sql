-- Anonymous funnel counters (docs/GALLERY.md "Metrics"). Count-only: no user
-- ids, no sessions, no timestamps per event — a single integer per key. The
-- point is to see the load → export funnel that page-view analytics can't.

create table public.metrics (
  key text primary key,
  count bigint not null default 0
);

alter table public.metrics enable row level security;

-- Anyone may read the totals (they're on the public dashboard anyway).
create policy "metrics readable by everyone"
  on public.metrics for select
  using (true);

-- No insert/update policies: the ONLY write path is this RPC, which
-- whitelists keys so anonymous callers can't create junk rows.
create function public.bump_metric(metric text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if metric not in (
    'base_loaded',        -- a user file parsed successfully (drag or picker)
    'sample_opened',      -- sample base button
    'blank_opened',       -- blank base button
    'base_exported',      -- export button produced a download
    'base_published',     -- publish/save completed
    'gallery_opened'      -- browse modal opened
  ) then
    return;
  end if;
  insert into public.metrics as m (key, count)
  values (metric, 1)
  on conflict (key) do update set count = m.count + 1;
end;
$$;
