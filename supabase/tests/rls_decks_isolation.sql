-- S-02 Guardrails-1: user B must never see user A's decks.
-- Two synthetic users insert decks under their JWT, then each runs a select
-- under the other user's JWT and asserts zero rows. Run via:
--
--   npm run db:test:rls:decks            -- local
--   npm run db:test:rls:decks:linked     -- hosted (after `supabase link`)
--
-- Re-run after any migration touching RLS on the decks table.
--
-- Each transaction first creates the synthetic auth.users row via the
-- postgres superuser (required for the FK), then switches to the
-- authenticated role + JWT claims so RLS policies apply.
-- Use a different UUID range from rls_cards_isolation.sql so the two tests
-- can run back-to-back without colliding.

begin;
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password, created_at, updated_at)
    values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '00000000-0000-0000-0000-000000000000',
            'authenticated', 'authenticated', 'rls-decks-a@example.test', '', now(), now())
    on conflict (id) do nothing;
  set local role authenticated;
  set local request.jwt.claims to '{"sub": "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", "role": "authenticated"}';
  insert into public.decks (user_id, name)
    values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'A-deck');
commit;

begin;
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password, created_at, updated_at)
    values ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '00000000-0000-0000-0000-000000000000',
            'authenticated', 'authenticated', 'rls-decks-b@example.test', '', now(), now())
    on conflict (id) do nothing;
  set local role authenticated;
  set local request.jwt.claims to '{"sub": "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb", "role": "authenticated"}';
  insert into public.decks (user_id, name)
    values ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'B-deck');
commit;

begin;
  set local role authenticated;
  set local request.jwt.claims to '{"sub": "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb", "role": "authenticated"}';
  do $$
    declare
      leaked int;
    begin
      select count(*) into leaked from public.decks
        where user_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
      assert leaked = 0, format('RLS leak: user B saw %s of user A''s deck(s)', leaked);
    end $$;
commit;

begin;
  set local role authenticated;
  set local request.jwt.claims to '{"sub": "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", "role": "authenticated"}';
  do $$
    declare
      leaked int;
    begin
      select count(*) into leaked from public.decks
        where user_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
      assert leaked = 0, format('RLS leak: user A saw %s of user B''s deck(s)', leaked);
    end $$;
commit;

-- Cleanup so the script is idempotent across re-runs and leaves no synthetic
-- rows behind (matters especially against the hosted DB).
begin;
  delete from public.decks
    where user_id in ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
                      'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb');
  delete from auth.users
    where id in ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
                 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb');
commit;
