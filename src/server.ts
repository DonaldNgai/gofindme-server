import Fastify from 'fastify';
import { loadEnv } from './utils/env.js';
import { buildApp } from './app.js';
import { env } from './config/env.js';

// Load environment variables before anything else
loadEnv();

async function start() {
  const fastify = Fastify({
    logger: {
      level: env.NODE_ENV === 'production' ? 'info' : 'debug',
      transport:
        env.NODE_ENV === 'development'
          ? {
              target: 'pino-pretty',
              options: {
                translateTime: 'HH:MM:ss Z',
                ignore: 'pid,hostname',
              },
            }
          : undefined,
    },
  });

  try {
    await buildApp(fastify);

    await fastify.listen({
      port: env.PORT,
      host: env.HOST,
    });

    fastify.log.info(`🚀 Server running on http://${env.HOST}:${env.PORT}`);
    fastify.log.info(`📚 API Documentation available at http://${env.HOST}:${env.PORT}/docs`);
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
}

start();
