-- F-01 Guardrails-1: user B must never see user A's cards.
-- Two synthetic users insert rows under their JWT, then each runs a select
-- under the other user's JWT and asserts zero rows. Run via:
--
--   npm run db:test:rls            -- local
--   npm run db:test:rls -- --linked -- hosted (after `supabase link`)
--
-- Re-run after any migration touching RLS or any new user-scoped table.
--
-- Each transaction first creates the synthetic auth.users row via the
-- postgres superuser (required for the FK), then switches to the
-- authenticated role + JWT claims so RLS policies apply to the insert
-- and select. UUIDs are inlined (no psql `\set`) so the script runs
-- under `supabase db query`, which doesn't support psql metacommands.

begin;
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password, created_at, updated_at)
    values ('11111111-1111-1111-1111-111111111111', '00000000-0000-0000-0000-000000000000',
            'authenticated', 'authenticated', 'rls-test-a@example.test', '', now(), now())
    on conflict (id) do nothing;
  set local role authenticated;
  set local request.jwt.claims to '{"sub": "11111111-1111-1111-1111-111111111111", "role": "authenticated"}';
  insert into public.cards (user_id, front, back)
    values ('11111111-1111-1111-1111-111111111111', 'A-front', 'A-back');
commit;

begin;
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password, created_at, updated_at)
    values ('22222222-2222-2222-2222-222222222222', '00000000-0000-0000-0000-000000000000',
            'authenticated', 'authenticated', 'rls-test-b@example.test', '', now(), now())
    on conflict (id) do nothing;
  set local role authenticated;
  set local request.jwt.claims to '{"sub": "22222222-2222-2222-2222-222222222222", "role": "authenticated"}';
  insert into public.cards (user_id, front, back)
    values ('22222222-2222-2222-2222-222222222222', 'B-front', 'B-back');
commit;

begin;
  set local role authenticated;
  set local request.jwt.claims to '{"sub": "22222222-2222-2222-2222-222222222222", "role": "authenticated"}';
  do $$
    declare
      leaked int;
    begin
      select count(*) into leaked from public.cards
        where user_id = '11111111-1111-1111-1111-111111111111';
      assert leaked = 0, format('RLS leak: user B saw %s of user A''s card(s)', leaked);
    end $$;
commit;

begin;
  set local role authenticated;
  set local request.jwt.claims to '{"sub": "11111111-1111-1111-1111-111111111111", "role": "authenticated"}';
  do $$
    declare
      leaked int;
    begin
      select count(*) into leaked from public.cards
        where user_id = '22222222-2222-2222-2222-222222222222';
      assert leaked = 0, format('RLS leak: user A saw %s of user B''s card(s)', leaked);
    end $$;
commit;

-- Cleanup so the script is idempotent across re-runs and leaves no synthetic
-- rows behind (matters especially against the hosted DB).
begin;
  delete from public.cards
    where user_id in ('11111111-1111-1111-1111-111111111111',
                      '22222222-2222-2222-2222-222222222222');
  delete from auth.users
    where id in ('11111111-1111-1111-1111-111111111111',
                 '22222222-2222-2222-2222-222222222222');
commit;
