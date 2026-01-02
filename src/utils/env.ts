import path from 'node:path';
import { config } from 'dotenv';

let initialized = false;

export function loadEnv() {
  if (initialized) return;
  const envFile = process.env.API_ENV_FILE ?? path.join(process.cwd(), '../../.env');
  config({ path: envFile, override: false });
  initialized = true;
}
