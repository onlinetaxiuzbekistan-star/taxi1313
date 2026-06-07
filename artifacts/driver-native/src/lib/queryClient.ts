import { QueryClient } from "@tanstack/react-query";

// Mirrors the web app's QueryClient defaults (taxi-app/src/App.tsx) so query
// behavior is identical: light retries, 30s freshness, offline-first.
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      staleTime: 30_000,
      networkMode: "offlineFirst",
    },
  },
});
