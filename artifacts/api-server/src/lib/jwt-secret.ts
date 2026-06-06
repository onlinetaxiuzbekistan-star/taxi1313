import { config } from "./config.js";

// Resolution (incl. production strength checks) lives in config.ts now.
export const JWT_SECRET = config.sessionSecret;
