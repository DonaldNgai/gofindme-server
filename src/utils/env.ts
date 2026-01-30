import path from 'node:path';
import { config } from 'dotenv';

// Load .env as soon as this module is imported (before config/env validates)
const envFile = process.env.API_ENV_FILE ?? path.join(process.cwd(), '.env');
config({ path: envFile, override: false });

export function loadEnv() {
  // No-op; dotenv already loaded on import. Kept for backwards compatibility.
}
