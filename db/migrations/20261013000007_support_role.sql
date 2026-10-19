-- HMS Returnly — Support role
-- On its own so the new enum value is committed before the next migration
-- uses it (Postgres can't use a new enum value in the transaction that adds it).
alter type public.staff_role add value if not exists 'support';
