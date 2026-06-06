-- ============================================================================
-- STEP 2 — NEUTRALIZE the shared legacy driver password placeholder.
-- Replaces the single shared 10-char non-bcrypt value (present on 8050 driver
-- rows) with a PER-ROW unique, unusable bcrypt hash of random bytes.
--
-- Why safe:
--   * Drivers authenticate by operator code only; password login for role=driver
--     is rejected (auth.ts: 403 driver_code_only). This field is unused for auth.
--   * Each row gets a distinct salt + distinct random input -> distinct $2a$10$ hash
--     that no one knows -> field becomes valid (NOT NULL) but permanently unusable.
--   * No effect on driver login. No SMS / no user disruption.
--
-- Pre-req: pgcrypto extension (already enabled). RUN STEP 1 (backup) FIRST.
-- Atomic: wrapped in a transaction.
-- ============================================================================
BEGIN;

-- Guard: show how many rows will change (should be 8050).
SELECT count(*) AS rows_to_neutralize
FROM users
WHERE role = 'driver'
  AND password_hash NOT LIKE '$2%'
  AND length(password_hash) = 10;

-- bcrypt cost 6 (not 10): these hashes are deliberately unusable (random input nobody
-- knows; driver password login is rejected anyway), so KDF strength is irrelevant — and
-- cost 6 keeps the locking UPDATE to ~30s instead of ~13min on a live DB.
UPDATE users
SET password_hash = crypt(encode(gen_random_bytes(18), 'hex'), gen_salt('bf', 6)),
    updated_at = now()
WHERE role = 'driver'
  AND password_hash NOT LIKE '$2%'
  AND length(password_hash) = 10;

-- Post-check: every targeted row should now be bcrypt, and the old shared value gone.
SELECT
  count(*) FILTER (WHERE password_hash LIKE '$2%')                       AS now_bcrypt,
  count(*) FILTER (WHERE length(password_hash) = 10
                     AND password_hash NOT LIKE '$2%')                   AS remaining_legacy,
  count(DISTINCT password_hash)                                          AS distinct_hashes
FROM users
WHERE role = 'driver';

-- Inspect the counts above. If correct (remaining_legacy = 0, distinct_hashes large),
-- COMMIT. Otherwise ROLLBACK.
COMMIT;
