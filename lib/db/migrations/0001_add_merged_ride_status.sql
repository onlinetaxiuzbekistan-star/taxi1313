-- Add 'merged' to the ride_status enum.
-- Idempotent: IF NOT EXISTS makes a re-run a no-op (already present in prod,
-- but declared here so the value exists on any newly-provisioned DB).
ALTER TYPE ride_status ADD VALUE IF NOT EXISTS 'merged';
