import { z } from 'zod';

const envSchema = z.object({
  PORT: z.coerce.number().default(3000),
  HOST: z.string().default('0.0.0.0'),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  API_PREFIX: z.string().default('/api/v1'),
  INTERNAL_API_PREFIX: z.string().default('/api/internal'),
  CORS_ORIGIN: z.string().default('http://localhost:3000'),
  RATE_LIMIT_MAX: z.coerce.number().optional(),
  RATE_LIMIT_WINDOW: z.string().optional(),
  API_VERSION: z.string().optional(),
  README_API_KEY: z.string().optional(),
  DATABASE_URL: z.string().optional(),
  AUTH0_DOMAIN: z.string().url().optional(),
  AUTH0_ISSUER_BASE_URL: z.string().url().optional(),
  AUTH0_AUDIENCE: z.string().optional(),
  AUTH0_M2M_CLIENT_ID: z.string().optional(),
  AUTH0_M2M_CLIENT_SECRET: z.string().optional(),
  // Test Auth0 tokens (optional, only needed for tests)
  TEST_AUTH0_TOKEN_USER_1: z.string().optional(),
  TEST_AUTH0_TOKEN_USER_2: z.string().optional(),
});

export type Env = z.infer<typeof envSchema>;

export function validateEnv(): Env {
  try {
    return envSchema.parse(process.env);
  } catch (error) {
    if (error instanceof z.ZodError) {
      console.error('❌ Invalid environment variables:');
      error.errors.forEach((err) => {
        console.error(`  ${err.path.join('.')}: ${err.message}`);
      });
      process.exit(1);
    }
    throw error;
  }
}

export const env = validateEnv();

