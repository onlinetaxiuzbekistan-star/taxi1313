// Single entry point for the shared API client. We reuse the monorepo package
// @workspace/api-client-react (lib/api-client-react) — it is already RN-aware
// (setBaseUrl / setAuthTokenGetter, RN-safe response parsing). configureApi()
// wires it to our backend + token store; call it once before any query runs.
import { setBaseUrl, setAuthTokenGetter } from "@/lib/api-client";
import { API_BASE_URL } from "@/config";
import { tokenStore } from "@/lib/storage";

let configured = false;

export function configureApi(): void {
  if (configured) return;
  configured = true;
  setBaseUrl(API_BASE_URL);
  // Attach the bearer token to every request that doesn't set one explicitly.
  setAuthTokenGetter(() => tokenStore.get());
}

export * from "@/lib/api-client";
