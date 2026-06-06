/** Safely extract a message from an unknown caught value (catch clauses are unknown). */
export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
