const KNOWN_WEAK_DEFAULT = "buxtaxi-secret-key-2024";

function resolveJwtSecret(): string {
  const secret = process.env.SESSION_SECRET?.trim();
  const isProd = process.env.NODE_ENV === "production";
  if (isProd) {
    if (!secret || secret.length < 32) {
      throw new Error(
        "SESSION_SECRET must be set to a random string of at least 32 characters in production.",
      );
    }
    if (secret === KNOWN_WEAK_DEFAULT) {
      throw new Error(
        "SESSION_SECRET must not equal the built-in development default in production.",
      );
    }
    return secret;
  }
  if (!secret) {
    console.warn(
      "[security] SESSION_SECRET is not set; JWT signing uses a development-only default. Set SESSION_SECRET before any production deploy.",
    );
    return KNOWN_WEAK_DEFAULT;
  }
  return secret;
}

export const JWT_SECRET = resolveJwtSecret();
