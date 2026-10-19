-- HMS Returnly — platform bootstrap for plain Postgres (17+), e.g. Railway.
--
-- Recreates the small part of Supabase the migrations depend on, so the eight
-- migrations and every row-level-security rule work unchanged:
--   * roles anon and authenticated (what requests run as);
--   * auth.users (only the id, so staff.user_id keeps its foreign key);
--   * auth.uid(), reading the user id the app sets per request;
--   * Supabase's default grants on new tables in schema public.
-- Storage (Supabase's storage schema) is NOT recreated: photos move to an S3
-- bucket in Phase 5.
--
-- Roles:
--   app_owner      owns every table and function. Used only by the migration
--                  runner and scheduled jobs. Not a superuser; no BYPASSRLS.
--   app_user       the web app's login. Has NO table privileges of its own
--                  (NOINHERIT); every request must SET LOCAL ROLE to
--                  authenticated or anon inside a transaction.
--   authenticated  signed-in staff (RLS decides which rows).
--   anon           public customer pages (four functions only).
--
-- Run once per database as a superuser (Railway's provisioning user). Safe to
-- run again. Sets no passwords: set them yourself, never in this file.

begin;

-- 1. Roles (shared by the whole server) --------------------------------------
do $$
begin
  if not exists (select from pg_roles where rolname = 'anon') then
    create role anon nologin noinherit;
  end if;
  if not exists (select from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin noinherit;
  end if;
  if not exists (select from pg_roles where rolname = 'app_owner') then
    create role app_owner login nosuperuser nocreatedb nocreaterole nobypassrls;
  end if;
  if not exists (select from pg_roles where rolname = 'app_user') then
    create role app_user login noinherit nosuperuser nocreatedb nocreaterole nobypassrls;
  end if;
end $$;

-- Enforce the attributes even if the roles already existed (e.g. created by
-- an earlier tool with different defaults).
alter role anon nologin noinherit nosuperuser nobypassrls;
alter role authenticated nologin noinherit nosuperuser nobypassrls;
alter role app_owner nosuperuser nocreatedb nocreaterole nobypassrls;
alter role app_user noinherit nosuperuser nocreatedb nocreaterole nobypassrls;

-- app_user may switch to these two roles, and nothing else. INHERIT FALSE means
-- it gets none of their privileges unless it explicitly SETs the role.
grant anon to app_user with inherit false, set true;
grant authenticated to app_user with inherit false, set true;

-- 2. Database and schema access ----------------------------------------------
do $$
begin
  execute format('revoke create, temporary on database %I from public', current_database());
  execute format('grant connect on database %I to app_owner, app_user', current_database());
  execute format('grant create on database %I to app_owner', current_database());
end $$;

revoke create on schema public from public;
grant usage, create on schema public to app_owner;
grant usage on schema public to anon, authenticated;

create schema if not exists auth authorization app_owner;
grant usage on schema auth to anon, authenticated;

-- 3. Objects owned by app_owner -----------------------------------------------
set local role app_owner;

create table if not exists auth.users (
  id uuid primary key
);
comment on table auth.users is
  'Ids of staff logins. Kept so staff.user_id references a real row; the auth library maps its users here.';

create or replace function auth.uid() returns uuid
language sql stable
as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
comment on function auth.uid() is
  'Current staff user id, set per request with set_config(''request.jwt.claim.sub'', id, true).';

-- Supabase grants these by default on everything created in schema public;
-- row-level security then decides what each role can actually see or change.
-- The migrations assume this, so we reproduce it exactly.
alter default privileges in schema public grant all on tables to anon, authenticated;
alter default privileges in schema public grant all on sequences to anon, authenticated;

reset role;

commit;
