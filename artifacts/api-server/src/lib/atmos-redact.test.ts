import { describe, it, expect, vi } from "vitest";

// atmos.ts imports db + circuit at module load; stub the side-effecting deps so
// we can unit-test the pure redaction helper.
vi.mock("@workspace/db", () => ({ db: {}, settingsTable: {} }));
vi.mock("drizzle-orm", () => ({ eq: vi.fn() }));

import { redactAtmos } from "./atmos.js";

describe("redactAtmos", () => {
  it("redacts the OAuth client_id from an Atmos 401 body", () => {
    const body = '{"error_description":"A valid OAuth client could not be found for client_id: 2KDNVRE90uJfpilQ6_Txof1qvlMa","error":"invalid_client"}';
    const out = redactAtmos(body);
    expect(out).not.toContain("2KDNVRE90uJfpilQ6_Txof1qvlMa");
    expect(out).toContain("[REDACTED]");
  });

  it("redacts the bearer access_token from a token response", () => {
    const body = '{"access_token":"eyJhbGciOiJSUzI1NiJ9.secret.sig","expires_in":3600}';
    const out = redactAtmos(body);
    expect(out).not.toContain("eyJhbGciOiJSUzI1NiJ9.secret.sig");
    expect(out).toContain('"access_token":"[REDACTED]"');
    expect(out).toContain("expires_in");
  });

  it("redacts card_number, otp and card_token fields", () => {
    expect(redactAtmos('{"card_number":"8600123412341234","expiry":"2512"}')).toContain('"card_number":"[REDACTED]"');
    expect(redactAtmos('{"transaction_id":123,"otp":"123456"}')).toContain('"otp":"[REDACTED]"');
    expect(redactAtmos('{"card_token":"tok_abc123"}')).toContain('"card_token":"[REDACTED]"');
  });

  it("masks a bare card PAN keeping only the last 4 digits", () => {
    const out = redactAtmos("pan is 8600123412341234 here");
    expect(out).not.toContain("8600123412341234");
    expect(out).toMatch(/\*+1234/);
  });

  it("leaves non-sensitive text untouched and handles empty input", () => {
    expect(redactAtmos("")).toBe("");
    expect(redactAtmos("HTTP 200 store_id=1655")).toBe("HTTP 200 store_id=1655");
  });
});
