// @ts-nocheck
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../../../../");

let container: StartedPostgreSqlContainer | null = null;

/**
 * Spin up a throwaway Postgres container and push the full Drizzle schema into
 * it (drizzle-kit push --force). Returns the connection URI. Callers must set
 * process.env.DATABASE_URL = <uri> BEFORE importing @workspace/db so the db
 * singleton connects to the container.
 */
export async function startTestDb(): Promise<string> {
  container = await new PostgreSqlContainer("postgres:16-alpine")
    .withDatabase("taxi_test")
    .withUsername("test")
    .withPassword("test")
    .start();

  const url = container.getConnectionUri();

  execSync("pnpm --filter @workspace/db push-force", {
    cwd: REPO_ROOT,
    env: { ...process.env, DATABASE_URL: url },
    stdio: "inherit",
  });

  return url;
}

export async function stopTestDb(): Promise<void> {
  if (container) {
    await container.stop();
    container = null;
  }
}
