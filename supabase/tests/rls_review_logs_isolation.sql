-- S-03 Guardrails-1: user B must never see or insert into user A's review_logs.
-- Two synthetic users insert a review log under their JWT, then each runs a
-- select under the other user's JWT and asserts zero rows. User B also tries
-- to insert a log that references user A's card and asserts the policy blocks it.
-- Run via:
--
--   npm run db:test:rls:review-logs           -- local
--   npm run db:test:rls:review-logs:linked    -- hosted (after `supabase link`)
--
-- Re-run after any migration touching RLS on review_logs.
--
-- Each transaction first creates the synthetic auth.users row via the
-- postgres superuser (required for the FK), then switches to the
-- authenticated role + JWT claims so RLS policies apply.
-- Uses a different UUID range from the cards/decks tests so all three can
-- run back-to-back without colliding.

-- User A: create user, deck, card, and a review_log.
begin;
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password, created_at, updated_at)
    values ('cccccccc-cccc-cccc-cccc-cccccccccccc', '00000000-0000-0000-0000-000000000000',
            'authenticated', 'authenticated', 'rls-rlogs-a@example.test', '', now(), now())
    on conflict (id) do nothing;
  set local role authenticated;
  set local request.jwt.claims to '{"sub": "cccccccc-cccc-cccc-cccc-cccccccccccc", "role": "authenticated"}';
  with d as (
    insert into public.decks (user_id, name)
      values ('cccccccc-cccc-cccc-cccc-cccccccccccc', 'A-deck')
      returning id
  ),
  c as (
    insert into public.cards (user_id, deck_id, front, back)
      select 'cccccccc-cccc-cccc-cccc-cccccccccccc', d.id, 'A-front', 'A-back' from d
      returning id
  )
  insert into public.review_logs (
    card_id, user_id, difficulty, due, learning_steps, rating, review,
    scheduled_days, stability, state
  )
  select c.id, 'cccccccc-cccc-cccc-cccc-cccccccccccc',
         5.0, now() + interval '1 day', 0, 3, now(), 1, 2.5, 1
    from c;
commit;

-- User B: create user, deck, card, and a review_log.
begin;
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password, created_at, updated_at)
    values ('dddddddd-dddd-dddd-dddd-dddddddddddd', '00000000-0000-0000-0000-000000000000',
            'authenticated', 'authenticated', 'rls-rlogs-b@example.test', '', now(), now())
    on conflict (id) do nothing;
  set local role authenticated;
  set local request.jwt.claims to '{"sub": "dddddddd-dddd-dddd-dddd-dddddddddddd", "role": "authenticated"}';
  with d as (
    insert into public.decks (user_id, name)
      values ('dddddddd-dddd-dddd-dddd-dddddddddddd', 'B-deck')
      returning id
  ),
  c as (
    insert into public.cards (user_id, deck_id, front, back)
      select 'dddddddd-dddd-dddd-dddd-dddddddddddd', d.id, 'B-front', 'B-back' from d
      returning id
  )
  insert into public.review_logs (
    card_id, user_id, difficulty, due, learning_steps, rating, review,
    scheduled_days, stability, state
  )
  select c.id, 'dddddddd-dddd-dddd-dddd-dddddddddddd',
         5.0, now() + interval '1 day', 0, 3, now(), 1, 2.5, 1
    from c;
commit;

-- User B's session must not see user A's review_logs.
begin;
  set local role authenticated;
  set local request.jwt.claims to '{"sub": "dddddddd-dddd-dddd-dddd-dddddddddddd", "role": "authenticated"}';
  do $$
    declare
      leaked int;
    begin
      select count(*) into leaked from public.review_logs
        where user_id = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
      assert leaked = 0, format('RLS leak: user B saw %s of user A''s review_log(s)', leaked);
    end $$;
commit;

-- User A's session must not see user B's review_logs.
begin;
  set local role authenticated;
  set local request.jwt.claims to '{"sub": "cccccccc-cccc-cccc-cccc-cccccccccccc", "role": "authenticated"}';
  do $$
    declare
      leaked int;
    begin
      select count(*) into leaked from public.review_logs
        where user_id = 'dddddddd-dddd-dddd-dddd-dddddddddddd';
      assert leaked = 0, format('RLS leak: user A saw %s of user B''s review_log(s)', leaked);
    end $$;
commit;

-- User B must not be able to INSERT a review_log row that references user A's card
-- (with check policy gates on user_id = auth.uid()).
begin;
  set local role authenticated;
  set local request.jwt.claims to '{"sub": "dddddddd-dddd-dddd-dddd-dddddddddddd", "role": "authenticated"}';
  do $$
    declare
      v_card_a uuid;
      v_inserted int := 0;
    begin
      -- Fetch user A's card id via the postgres superuser context (bypasses RLS).
      -- We can't see it under user B's JWT, but we need it to attempt the malicious insert.
      set local role postgres;
      select id into v_card_a from public.cards
        where user_id = 'cccccccc-cccc-cccc-cccc-cccccccccccc' limit 1;
      set local role authenticated;

      begin
        insert into public.review_logs (
          card_id, user_id, difficulty, due, learning_steps, rating, review,
          scheduled_days, stability, state
        ) values (
          v_card_a, 'cccccccc-cccc-cccc-cccc-cccccccccccc',
          5.0, now() + interval '1 day', 0, 3, now() + interval '1 second', 1, 2.5, 1
        );
        v_inserted := 1;
      exception
        when insufficient_privilege or check_violation then
          v_inserted := 0;
      end;
      assert v_inserted = 0, 'RLS leak: user B inserted a review_log impersonating user A';
    end $$;
commit;

-- Cleanup so the script is idempotent across re-runs.
begin;
  delete from public.review_logs
    where user_id in ('cccccccc-cccc-cccc-cccc-cccccccccccc',
                      'dddddddd-dddd-dddd-dddd-dddddddddddd');
  delete from public.cards
    where user_id in ('cccccccc-cccc-cccc-cccc-cccccccccccc',
                      'dddddddd-dddd-dddd-dddd-dddddddddddd');
  delete from public.decks
    where user_id in ('cccccccc-cccc-cccc-cccc-cccccccccccc',
                      'dddddddd-dddd-dddd-dddd-dddddddddddd');
  delete from auth.users
    where id in ('cccccccc-cccc-cccc-cccc-cccccccccccc',
                 'dddddddd-dddd-dddd-dddd-dddddddddddd');
commit;
