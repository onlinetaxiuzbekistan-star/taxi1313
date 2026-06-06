// @ts-nocheck
import { defineConfig } from "vitest/config";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";

// The source uses NodeNext-style ".js" import specifiers that actually point at
// ".ts" files (e.g. `import { logger } from "./logger.js"`). Vite doesn't rewrite
// those by default, so map relative "*.js" → "*.ts" when the .ts file exists.
const jsToTsResolver = {
  name: "js-to-ts-resolver",
  enforce: "pre" as const,
  resolveId(source: string, importer: string | undefined) {
    if (importer && source.startsWith(".") && source.endsWith(".js")) {
      const candidate = resolve(dirname(importer), source.slice(0, -3) + ".ts");
      if (existsSync(candidate)) return candidate;
    }
    return null;
  },
};

export default defineConfig({
  plugins: [jsToTsResolver],
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    clearMocks: true,
    // Enforced 95% gate over the deterministic, fully-unit-testable critical
    // modules: constant-time compare, request validation + schemas, error
    // helper, and the resilience (circuit-breaker/retry) layer. DB-bound
    // services/ledger/completion are exercised by the integration suite
    // (vitest.integration.config.ts) instead.
    coverage: {
      provider: "v8",
      include: [
        "src/lib/secure-compare.ts",
        "src/lib/errors.ts",
        "src/lib/circuit.ts",
        "src/middlewares/validate.ts",
        "src/middlewares/request-schemas.ts",
      ],
      reporter: ["text", "text-summary"],
      thresholds: { statements: 95, lines: 95, functions: 95, branches: 80 },
    },
  },
});
