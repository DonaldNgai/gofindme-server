import { zodToJsonSchema } from 'zod-to-json-schema';
import type { z } from 'zod';

/**
 * Converts a Zod schema to JSON Schema format for Fastify
 */
export function zodToJsonSchemaFastify<T extends z.ZodTypeAny>(schema: T) {
  return zodToJsonSchema(schema, {
    target: 'openApi3',
    $refStrategy: 'none',
  });
}
