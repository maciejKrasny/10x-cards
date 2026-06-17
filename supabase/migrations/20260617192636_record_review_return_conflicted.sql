-- record_review now returns { card, conflicted } instead of just the card row.
--
-- Motivation: applyRating discarded the rpc result, so the route could not
-- distinguish a fresh write from an ON CONFLICT replay. The UI counter therefore
-- ticked on every 2xx, doubling on explicit replay or a stale-tab retry while
-- card state stayed consistent (handled by the existing UNIQUE (card_id, review)
-- dedupe). The conflicted bit closes that loop end-to-end.

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
  return jsonb_build_object(
    'card',       to_jsonb(v_card_row),
    'conflicted', v_inserted_id is null
  );
end;
$$;
