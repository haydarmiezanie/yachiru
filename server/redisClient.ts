import Redis from 'ioredis';
import { logger } from './logger.js';

let redisClient: Redis | null = null;
let isConnected = false;

// Initialize shared Redis client if REDIS_URL is provided (supports Cloud Memorystore, Upstash, Redis Cloud, Docker)
if (process.env.REDIS_URL && process.env.NODE_ENV !== 'test') {
  try {
    redisClient = new Redis(process.env.REDIS_URL, {
      maxRetriesPerRequest: 3,
      enableOfflineQueue: false,
      connectTimeout: 5000,
      lazyConnect: false,
    });

    redisClient.on('connect', () => {
      logger.info('Connected to Redis: shared auth profile cache and distributed rate limiting enabled');
      isConnected = true;
    });

    redisClient.on('ready', () => {
      isConnected = true;
    });

    redisClient.on('error', (err) => {
      logger.warn({ err: err.message }, 'Redis connection error (operating in in-memory fallback mode)');
      isConnected = false;
    });

    redisClient.on('close', () => {
      isConnected = false;
    });

    redisClient.on('end', () => {
      isConnected = false;
    });
  } catch (err: any) {
    logger.warn({ err: err?.message }, 'Failed to initialize Redis client, using in-memory fallback');
  }
} else if (process.env.NODE_ENV !== 'test') {
  logger.info(
    'REDIS_URL not configured. Auth profile caching and rate limiting are operating in in-memory mode. ' +
    'For multi-instance horizontal scaling on Cloud Run, provide REDIS_URL.'
  );
}

/**
 * Returns the active shared Redis client instance, or null if unavailable.
 */
export function getRedisClient(): Redis | null {
  return redisClient;
}

/**
 * Checks if Redis is currently connected and healthy.
 */
export function isRedisConnected(): boolean {
  return isConnected && redisClient !== null && (redisClient.status === 'ready' || redisClient.status === 'connect');
}

/**
 * Helper to inject or reset the Redis client for unit and integration testing.
 */
export function setRedisClientForTesting(client: Redis | null, connected: boolean = true): void {
  redisClient = client;
  isConnected = connected;
}

/**
 * Closes the active Redis connection gracefully (useful during server shutdown and testing).
 */
export async function closeRedis(): Promise<void> {
  if (redisClient) {
    await redisClient.quit().catch(() => {});
    redisClient = null;
    isConnected = false;
  }
}
