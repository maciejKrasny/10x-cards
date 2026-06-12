-- decks_baseline: decks table + RLS policies, cards.deck_id FK + backfill into per-user "My Deck" (S-02).
--
-- The whole file runs as one transaction (Supabase CLI wraps each migration in BEGIN/COMMIT),
-- so a failure at any step rolls everything back — no half-applied state on the cards table.

create table public.decks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 100),
  created_at timestamptz not null default now()
);

create index idx_decks_user_id on public.decks (user_id);

alter table public.decks enable row level security;

create policy decks_select_own on public.decks
  for select to authenticated
  using (user_id = auth.uid());

create policy decks_insert_own on public.decks
  for insert to authenticated
  with check (user_id = auth.uid());

create policy decks_update_own on public.decks
  for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy decks_delete_own on public.decks
  for delete to authenticated
  using (user_id = auth.uid());

-- Add FK column to cards as nullable so the backfill can populate it before we lock NOT NULL.
alter table public.cards
  add column deck_id uuid references public.decks(id) on delete cascade;

-- One "My Deck" per user who already has cards from S-01.
insert into public.decks (user_id, name)
  select distinct user_id, 'My Deck' from public.cards;

-- Bind every pre-existing card to its owner's "My Deck".
update public.cards
  set deck_id = (select id from public.decks
                  where decks.user_id = cards.user_id
                    and decks.name = 'My Deck'
                  limit 1)
  where deck_id is null;

alter table public.cards alter column deck_id set not null;

create index idx_cards_deck_id on public.cards (deck_id);
