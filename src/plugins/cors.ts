import { FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import { env } from '../config/env.js';

export async function registerCors(fastify: FastifyInstance) {
  // In development, allow all localhost origins for easier testing
  // In production, use the configured CORS_ORIGIN
  const corsOrigin =
    env.NODE_ENV === 'development'
      ? (origin: string | undefined, callback: (err: Error | null, allow: boolean) => void) => {
          // Allow all localhost origins in development
          if (!origin || origin.startsWith('http://localhost:') || origin.startsWith('http://127.0.0.1:')) {
            callback(null, true);
            return;
          }
          // Also check configured origins
          const allowedOrigins = env.CORS_ORIGIN.split(',').map((o) => o.trim());
          callback(null, allowedOrigins.includes(origin));
        }
      : env.CORS_ORIGIN.split(',').map((origin) => origin.trim());

  await fastify.register(cors, {
    origin: corsOrigin,
    credentials: true,
  });
}
