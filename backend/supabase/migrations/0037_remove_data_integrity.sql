-- The admin console's Data Integrity page and its admin-data-integrity edge
-- function were removed; drop the SQL function that only they called.
drop function if exists public.admin_data_integrity_checks();
