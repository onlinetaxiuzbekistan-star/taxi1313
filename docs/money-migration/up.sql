-- ============================================================================
-- MONEY MIGRATION (UP): real (float4) -> numeric(19,2)
-- ----------------------------------------------------------------------------
-- WHY: real is single-precision float (~7 significant digits, exact only for
--      integers <= 16,777,216). All money should be exact decimal.
-- SAFE: existing money values are whole-som (Math.round'ed in code), so
--       ::numeric(19,2) rounds away any float noise with no data loss.
-- ATOMIC: wrapped in a single transaction — all columns convert or none do.
-- APPLY ON A DB COPY FIRST. Do NOT run on prod without a fresh backup.
-- ============================================================================
BEGIN;

-- ---- rides ----------------------------------------------------------------
ALTER TABLE rides ALTER COLUMN price               TYPE numeric(19,2) USING price::numeric(19,2);
ALTER TABLE rides ALTER COLUMN commission          TYPE numeric(19,2) USING commission::numeric(19,2);
ALTER TABLE rides ALTER COLUMN driver_payout       TYPE numeric(19,2) USING driver_payout::numeric(19,2);
ALTER TABLE rides ALTER COLUMN options_total       TYPE numeric(19,2) USING options_total::numeric(19,2);
ALTER TABLE rides ALTER COLUMN options_commission  TYPE numeric(19,2) USING options_commission::numeric(19,2);
ALTER TABLE rides ALTER COLUMN from_district_charge TYPE numeric(19,2) USING from_district_charge::numeric(19,2);
ALTER TABLE rides ALTER COLUMN to_district_charge  TYPE numeric(19,2) USING to_district_charge::numeric(19,2);
ALTER TABLE rides ALTER COLUMN base_price          TYPE numeric(19,2) USING base_price::numeric(19,2);

-- ---- ride_passengers ------------------------------------------------------
ALTER TABLE ride_passengers ALTER COLUMN price     TYPE numeric(19,2) USING price::numeric(19,2);

-- ---- routes ---------------------------------------------------------------
ALTER TABLE routes ALTER COLUMN price_economy        TYPE numeric(19,2) USING price_economy::numeric(19,2);
ALTER TABLE routes ALTER COLUMN price_comfort        TYPE numeric(19,2) USING price_comfort::numeric(19,2);
ALTER TABLE routes ALTER COLUMN price_business       TYPE numeric(19,2) USING price_business::numeric(19,2);
ALTER TABLE routes ALTER COLUMN price_mail           TYPE numeric(19,2) USING price_mail::numeric(19,2);
ALTER TABLE routes ALTER COLUMN price_front_economy  TYPE numeric(19,2) USING price_front_economy::numeric(19,2);
ALTER TABLE routes ALTER COLUMN price_front_comfort  TYPE numeric(19,2) USING price_front_comfort::numeric(19,2);
ALTER TABLE routes ALTER COLUMN price_front_business TYPE numeric(19,2) USING price_front_business::numeric(19,2);

-- ---- route_options --------------------------------------------------------
ALTER TABLE route_options ALTER COLUMN price       TYPE numeric(19,2) USING price::numeric(19,2);
ALTER TABLE route_options ALTER COLUMN commission  TYPE numeric(19,2) USING commission::numeric(19,2);

-- ---- marketplace_listings -------------------------------------------------
ALTER TABLE marketplace_listings ALTER COLUMN price      TYPE numeric(19,2) USING price::numeric(19,2);
ALTER TABLE marketplace_listings ALTER COLUMN base_price TYPE numeric(19,2) USING base_price::numeric(19,2);

-- ---- addresses / districts ------------------------------------------------
ALTER TABLE addresses ALTER COLUMN extra_price     TYPE numeric(19,2) USING extra_price::numeric(19,2);
ALTER TABLE districts ALTER COLUMN extra_charge    TYPE numeric(19,2) USING extra_charge::numeric(19,2);

-- ---- tariffs --------------------------------------------------------------
ALTER TABLE tariffs ALTER COLUMN base_rate         TYPE numeric(19,2) USING base_rate::numeric(19,2);
ALTER TABLE tariffs ALTER COLUMN per_km_rate       TYPE numeric(19,2) USING per_km_rate::numeric(19,2);
ALTER TABLE tariffs ALTER COLUMN intercity_fee     TYPE numeric(19,2) USING intercity_fee::numeric(19,2);

-- ---- analytics_daily ------------------------------------------------------
ALTER TABLE analytics_daily ALTER COLUMN avg_order_price TYPE numeric(19,2) USING avg_order_price::numeric(19,2);

-- ---- OPTIONAL: percentage/rate columns (not money, but precision matters) --
-- Uncomment to also fix rate columns. numeric(5,2) = up to 999.99%.
-- ALTER TABLE users  ALTER COLUMN commission_rate          TYPE numeric(5,2) USING commission_rate::numeric(5,2);
-- ALTER TABLE routes ALTER COLUMN round_trip_discount_percent TYPE numeric(5,2) USING round_trip_discount_percent::numeric(5,2);

COMMIT;

-- Verify after apply:
--   SELECT table_name, column_name, data_type, numeric_precision, numeric_scale
--   FROM information_schema.columns
--   WHERE data_type = 'numeric' ORDER BY table_name, column_name;
