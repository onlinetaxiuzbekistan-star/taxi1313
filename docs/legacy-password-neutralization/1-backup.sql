-- ============================================================================
-- STEP 1 — BACKUP the legacy driver password_hash values BEFORE neutralizing.
-- Read-only export. Run as a DB superuser. The output file is SENSITIVE
-- (contains the current shared placeholder hash) — chmod 600 it afterwards.
--
-- Run:
--   sudo -u postgres psql -d taxi1313 -c "\copy (SELECT id, phone, role, password_hash, created_at FROM users WHERE role='driver' AND password_hash NOT LIKE '\$2%' AND length(password_hash)=10) TO '/tmp/legacy-driver-passwords.csv' WITH CSV HEADER"
--   sudo mv /tmp/legacy-driver-passwords.csv /opt/taxi1313/backups/legacy-driver-passwords-$(date +%Y%m%d-%H%M%S).csv
--   sudo chmod 600 /opt/taxi1313/backups/legacy-driver-passwords-*.csv
--
-- Expected: 8050 rows.
-- ============================================================================

-- Sanity count (read-only) — confirm the target set before backup/neutralization:
SELECT count(*) AS rows_to_backup
FROM users
WHERE role = 'driver'
  AND password_hash NOT LIKE '$2%'
  AND length(password_hash) = 10;
