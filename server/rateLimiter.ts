import { rateLimit } from 'express-rate-limit';
import { RedisStore } from 'rate-limit-redis';
import Redis from 'ioredis';
import { logger } from './logger.js';

let redisClient: Redis | null = null;
let isDistributed = false;

// Initialize Redis client if REDIS_URL is provided (supports Cloud Memorystore, Upstash, Redis Cloud)
if (process.env.REDIS_URL && process.env.NODE_ENV !== 'test') {
  try {
    redisClient = new Redis(process.env.REDIS_URL, {
      maxRetriesPerRequest: 3,
      enableOfflineQueue: false,
      connectTimeout: 5000,
      lazyConnect: false,
    });

    redisClient.on('connect', () => {
      logger.info('Connected to Redis: distributed rate limiting enabled across instances');
      isDistributed = true;
    });

    redisClient.on('error', (err) => {
      logger.warn({ err: err.message }, 'Redis rate limiter connection error');
    });
  } catch (err: any) {
    logger.warn({ err: err?.message }, 'Failed to initialize Redis client, falling back to in-memory rate limiting');
  }
} else if (process.env.NODE_ENV !== 'test') {
  logger.info(
    'REDIS_URL not configured. Rate limiting is operating in in-memory mode. ' +
    'For multi-instance horizontal scaling on Cloud Run, provide REDIS_URL.'
  );
}

function createStore(prefix: string) {
  if (redisClient) {
    return new RedisStore({
      // @ts-expect-error ioredis call returns compatible Redis reply
      sendCommand: (...args: string[]) => redisClient!.call(args[0], ...args.slice(1)),
      prefix: `yachiru:rl:${prefix}:`,
    });
  }
  return undefined; // defaults to in-memory store
}

export const apiLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 120, // 120 requests per minute
  standardHeaders: true,
  legacyHeaders: false,
  validate: false,
  passOnStoreError: true,
  store: createStore('api'),
  message: { error: 'Too many requests, please slow down.' },
});

export const scanLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 30, // 30 scans per minute
  standardHeaders: true,
  legacyHeaders: false,
  validate: false,
  passOnStoreError: true,
  store: createStore('scan'),
  message: { error: 'Scan request limit exceeded. Please wait a moment before initiating another cluster scan.' },
});

export function isDistributedRateLimitActive(): boolean {
  return isDistributed && redisClient !== null;
}

export async function closeRedis(): Promise<void> {
  if (redisClient) {
    await redisClient.quit().catch(() => {});
    redisClient = null;
    isDistributed = false;
  }
}
