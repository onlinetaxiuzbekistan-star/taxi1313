import type { User } from "@/lib/api-client";

export type { User } from "@/lib/api-client";

// The backend's /api/auth/me returns more fields for drivers than the generated
// OpenAPI `User` schema describes (the web app reads them via `user as any`).
// Model them explicitly here so the native shell is type-safe.
export interface DriverUser extends User {
  balance?: number;
  bannedUntil?: string | null;
  city?: string | null;
  driverPhoto?: string | null;
  updatedAt?: string | null;
  carModel?: string;
  carNumber?: string;
}
