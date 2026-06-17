-- fsrs_state_and_review_logs (S-03)
--
-- Adds the 10 ts-fsrs Card state columns to public.cards (additive, defaults so
-- existing rows present as fresh "new" cards: state=0, due=now(), all metrics 0).
-- Creates public.review_logs as the append-only review history with
-- UNIQUE(card_id, review) as the idempotency anchor (Guardrails-2 retry safety
-- comes from DB-level ON CONFLICT, no application-side Idempotency-Key needed).
-- Adds the (user_id, due) composite index that powers the next-due queue lookup.
-- Enables RLS on review_logs with select+insert policies gated on
-- user_id = auth.uid() (no update/delete — logs are append-only).
-- Defines record_review(p_card_id, p_rating, p_review_at, p_card_patch jsonb)
-- as the single-transaction primitive the application calls via supabase.rpc —
-- it inserts the log row, applies the patch, and returns the canonical card row,
-- handling the ON CONFLICT (replay) branch by re-reading without re-applying.

-- 1. FSRS state columns on public.cards.

alter table public.cards
  add column difficulty      float8       not null default 0,
  add column due             timestamptz  not null default now(),
  add column elapsed_days    integer      not null default 0,
  add column lapses          integer      not null default 0,
  add column last_review     timestamptz  null,
  add column learning_steps  integer      not null default 0,
  add column reps            integer      not null default 0,
  add column scheduled_days  integer      not null default 0,
  add column stability       float8       not null default 0,
  add column state           smallint     not null default 0;

comment on column public.cards.state is '0=New, 1=Learning, 2=Review, 3=Relearning (ts-fsrs State enum)';

create index idx_cards_user_due on public.cards (user_id, due);

-- 2. review_logs (append-only).

create table public.review_logs (
  id              uuid         primary key default gen_random_uuid(),
  card_id         uuid         not null references public.cards(id) on delete cascade,
  user_id         uuid         not null references auth.users(id) on delete cascade,
  difficulty      float8       not null,
  due             timestamptz  not null,
  learning_steps  integer      not null,
  rating          smallint     not null,
  review          timestamptz  not null,
  scheduled_days  integer      not null,
  stability       float8       not null,
  state           smallint     not null,
  created_at      timestamptz  not null default now(),
  constraint review_logs_card_review_uniq unique (card_id, review)
);

comment on column public.review_logs.rating is '1=Again, 2=Hard, 3=Good, 4=Easy (ts-fsrs Rating enum)';
comment on column public.review_logs.state  is '0=New, 1=Learning, 2=Review, 3=Relearning (ts-fsrs State enum)';

create index idx_review_logs_card_id on public.review_logs (card_id);

alter table public.review_logs enable row level security;

create policy review_logs_select_own on public.review_logs
  for select to authenticated
  using (user_id = auth.uid());

create policy review_logs_insert_own on public.review_logs
  for insert to authenticated
  with check (user_id = auth.uid());

-- 3. record_review: single-transaction insert-log + advance-card with idempotent replay.
--
-- SECURITY INVOKER so RLS on both tables applies to the caller (the rpc cannot
-- be used to leak or write across users). The application computes the FSRS
-- patch in TS and passes it as jsonb so the library stays out of the database.
-- On ON CONFLICT, the function re-reads and returns the current cards row
-- WITHOUT applying the patch — replay returns the canonical post-write state.

create or replace function public.record_review(
  p_card_id     uuid,
  p_rating      smallint,
  p_review_at   timestamptz,
  p_card_patch  jsonb
) returns jsonb
language plpgsql
security invoker
as $$
declare
  v_inserted_id   uuid;
  v_card_user_id  uuid;
  v_card_row      public.cards;
begin
  select user_id into v_card_user_id from public.cards where id = p_card_id;
  if v_card_user_id is null then
    raise exception 'card_not_found' using errcode = 'P0002';
  end if;

  insert into public.review_logs (
    card_id, user_id, difficulty, due, learning_steps, rating, review,
    scheduled_days, stability, state
  )
  values (
    p_card_id,
    v_card_user_id,
    (p_card_patch->>'difficulty')::float8,
    (p_card_patch->>'due')::timestamptz,
    (p_card_patch->>'learning_steps')::integer,
    p_rating,
    p_review_at,
    (p_card_patch->>'scheduled_days')::integer,
    (p_card_patch->>'stability')::float8,
    (p_card_patch->>'state')::smallint
  )
  on conflict (card_id, review) do nothing
  returning id into v_inserted_id;

  if v_inserted_id is not null then
    update public.cards
      set difficulty     = (p_card_patch->>'difficulty')::float8,
          due            = (p_card_patch->>'due')::timestamptz,
          elapsed_days   = (p_card_patch->>'elapsed_days')::integer,
          lapses         = (p_card_patch->>'lapses')::integer,
          last_review    = nullif(p_card_patch->>'last_review', '')::timestamptz,
          learning_steps = (p_card_patch->>'learning_steps')::integer,
          reps           = (p_card_patch->>'reps')::integer,
          scheduled_days = (p_card_patch->>'scheduled_days')::integer,
          stability      = (p_card_patch->>'stability')::float8,
          state          = (p_card_patch->>'state')::smallint
      where id = p_card_id;
  end if;

  select * into v_card_row from public.cards where id = p_card_id;
  return to_jsonb(v_card_row);
end;
$$;

grant execute on function public.record_review(uuid, smallint, timestamptz, jsonb) to authenticated;
