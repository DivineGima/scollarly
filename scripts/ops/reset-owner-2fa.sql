-- S10.4: the owner has lost the authenticator app AND every recovery code. Run this once, as the database OWNER role (neondb_owner), in the
-- Neon SQL editor or with psql, after checking in docs/recovery.md that you really are locked out.
--
-- It removes the owner's authenticator secret, recovery codes and 2FA checks, ends the owner's sign-in sessions, and writes an audit row.
-- The owner account and role stay. The next Google sign-in with the owner email lands on the "set up two-factor" page (architecture 16 C0),
-- exactly like the first time. Nothing else is touched. It is safe to run twice.
begin;

delete from public.recovery_code where user_id in (select id from public.app_user where role = 'owner');
delete from public.step_up where user_id in (select id from public.app_user where role = 'owner');
delete from public.owner_totp where user_id in (select id from public.app_user where role = 'owner');
delete from neon_auth.session where "userId"::text in (select id from public.app_user where role = 'owner');

insert into public.audit_log (id, actor_id, action, entity_type, entity_id, meta)
  select gen_random_uuid(), null, 'security.ownerTwoFactorReset', 'app_user', id, '{"by":"recovery procedure"}'::jsonb
    from public.app_user where role = 'owner';

commit;
