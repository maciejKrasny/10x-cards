-- cards_baseline: cards table + RLS policies (F-01)

create table public.cards (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  front text not null check (char_length(front) between 1 and 1000),
  back text not null check (char_length(back) between 1 and 1000),
  created_at timestamptz not null default now()
);

create index idx_cards_user_id on public.cards (user_id);

alter table public.cards enable row level security;

create policy cards_select_own on public.cards
  for select to authenticated
  using (user_id = auth.uid());

create policy cards_insert_own on public.cards
  for insert to authenticated
  with check (user_id = auth.uid());

create policy cards_update_own on public.cards
  for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy cards_delete_own on public.cards
  for delete to authenticated
  using (user_id = auth.uid());
