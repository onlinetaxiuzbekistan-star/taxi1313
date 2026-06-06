-- ============================================================================
-- MONEY MIGRATION (DOWN / ROLLBACK): numeric(19,2) -> real (float4)
-- ----------------------------------------------------------------------------
-- Reverts up.sql. NOTE: this re-introduces float imprecision. Only use to roll
-- back if the up migration or the accompanying code deploy must be reverted.
-- Atomic — wrapped in a single transaction.
-- ============================================================================
BEGIN;

-- ---- rides ----------------------------------------------------------------
ALTER TABLE rides ALTER COLUMN price               TYPE real USING price::real;
ALTER TABLE rides ALTER COLUMN commission          TYPE real USING commission::real;
ALTER TABLE rides ALTER COLUMN driver_payout       TYPE real USING driver_payout::real;
ALTER TABLE rides ALTER COLUMN options_total       TYPE real USING options_total::real;
ALTER TABLE rides ALTER COLUMN options_commission  TYPE real USING options_commission::real;
ALTER TABLE rides ALTER COLUMN from_district_charge TYPE real USING from_district_charge::real;
ALTER TABLE rides ALTER COLUMN to_district_charge  TYPE real USING to_district_charge::real;
ALTER TABLE rides ALTER COLUMN base_price          TYPE real USING base_price::real;

-- ---- ride_passengers ------------------------------------------------------
ALTER TABLE ride_passengers ALTER COLUMN price     TYPE real USING price::real;

-- ---- routes ---------------------------------------------------------------
ALTER TABLE routes ALTER COLUMN price_economy        TYPE real USING price_economy::real;
ALTER TABLE routes ALTER COLUMN price_comfort        TYPE real USING price_comfort::real;
ALTER TABLE routes ALTER COLUMN price_business       TYPE real USING price_business::real;
ALTER TABLE routes ALTER COLUMN price_mail           TYPE real USING price_mail::real;
ALTER TABLE routes ALTER COLUMN price_front_economy  TYPE real USING price_front_economy::real;
ALTER TABLE routes ALTER COLUMN price_front_comfort  TYPE real USING price_front_comfort::real;
ALTER TABLE routes ALTER COLUMN price_front_business TYPE real USING price_front_business::real;

-- ---- route_options --------------------------------------------------------
ALTER TABLE route_options ALTER COLUMN price       TYPE real USING price::real;
ALTER TABLE route_options ALTER COLUMN commission  TYPE real USING commission::real;

-- ---- marketplace_listings -------------------------------------------------
ALTER TABLE marketplace_listings ALTER COLUMN price      TYPE real USING price::real;
ALTER TABLE marketplace_listings ALTER COLUMN base_price TYPE real USING base_price::real;

-- ---- addresses / districts ------------------------------------------------
ALTER TABLE addresses ALTER COLUMN extra_price     TYPE real USING extra_price::real;
ALTER TABLE districts ALTER COLUMN extra_charge    TYPE real USING extra_charge::real;

-- ---- tariffs --------------------------------------------------------------
ALTER TABLE tariffs ALTER COLUMN base_rate         TYPE real USING base_rate::real;
ALTER TABLE tariffs ALTER COLUMN per_km_rate       TYPE real USING per_km_rate::real;
ALTER TABLE tariffs ALTER COLUMN intercity_fee     TYPE real USING intercity_fee::real;

-- ---- analytics_daily ------------------------------------------------------
ALTER TABLE analytics_daily ALTER COLUMN avg_order_price TYPE real USING avg_order_price::real;

-- ---- OPTIONAL rate columns ------------------------------------------------
-- ALTER TABLE users  ALTER COLUMN commission_rate          TYPE real USING commission_rate::real;
-- ALTER TABLE routes ALTER COLUMN round_trip_discount_percent TYPE real USING round_trip_discount_percent::real;

COMMIT;
