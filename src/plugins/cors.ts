import { FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import { env } from '../config/env.js';

export async function registerCors(fastify: FastifyInstance) {
  // In development, allow all origins for easier testing
  // In production, use the configured CORS_ORIGIN
  const corsConfig =
    env.NODE_ENV === 'development'
      ? {
          origin: true, // Allow all origins in development
          credentials: true,
        }
      : {
          origin: env.CORS_ORIGIN.split(',').map((origin) => origin.trim()),
          credentials: true,
        };

  await fastify.register(cors, corsConfig);
}
