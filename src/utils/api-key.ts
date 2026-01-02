import { FastifyReply, FastifyRequest } from 'fastify';
import { resolveApiKey } from '../services/api-keys.js';

export async function requireApiKey(request: FastifyRequest, reply: FastifyReply) {
  const headerKey = request.headers['x-api-key'];
  const key =
    typeof headerKey === 'string' ? headerKey : Array.isArray(headerKey) ? headerKey[0] : undefined;

  if (!key) {
    reply.code(401);
    throw new Error('Missing X-API-Key header');
  }

  const record = await resolveApiKey(key);
  if (!record) {
    reply.code(401);
    throw new Error('Invalid API key');
  }

  return record as typeof record & { group_id: string };
}
