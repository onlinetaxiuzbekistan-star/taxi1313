# Legacy driver password neutralization

## What this is
8050 `driver` accounts share **one identical** 10-character non-bcrypt `password_hash`
(a NOT-NULL placeholder from data import). Analysis (read-only, aggregates only):

| metric | value |
|---|---|
| total affected | 8050 (all role=driver) |
| distinct values | **1** (single shared placeholder) |
| equals phone / last-10 / digits-only | 0 |
| has uppercase / special | all 8050 |

→ Not per-user plaintext, not phone-derived: a single fixed placeholder.
The field is **never used for auth** (drivers log in by operator code; password login
for role=driver returns 403 `driver_code_only`).

## Risk
Low. The value is one constant, useless for login. Neutralizing is hygiene
(remove a shared known-ish credential value at rest), not an incident fix.

## Procedure (run in order — NOTHING here has been executed yet)
1. **Backup** — `1-backup.sql` (export id+phone+hash to a 600-perm file in `backups/`).
2. **Neutralize** — `2-neutralize.sql` (per-row unique `bcrypt(random)`, in a transaction;
   review the post-check counts before COMMIT).
3. No code deploy or service restart needed. No driver impact.

## Rollback
Restore from the Step-1 CSV backup:
```
-- create a temp table from the CSV, then:
UPDATE users u SET password_hash = b.password_hash
FROM legacy_backup b WHERE u.id = b.id;
```
(Only needed if some unforeseen process actually relied on the old value — none does.)

## Notes
- pgcrypto extension was enabled on the DB (needed for `crypt`/`gen_salt`/`gen_random_bytes`).
- bcrypt cost = 10, matching the app (`bcrypt.hash(pw, 10)`); output `$2a$10$…` is
  recognized by the app's `$2a/$2b/$2y` check.
