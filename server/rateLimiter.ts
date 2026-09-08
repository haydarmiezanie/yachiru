import { rateLimit } from 'express-rate-limit';
import { RedisStore } from 'rate-limit-redis';
import { getRedisClient, isRedisConnected, closeRedis } from './redisClient.js';

function createStore(prefix: string) {
  const client = getRedisClient();
  if (client) {
    return new RedisStore({
      // @ts-expect-error ioredis call returns compatible Redis reply
      sendCommand: (...args: string[]) => client.call(args[0], ...args.slice(1)),
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
  return isRedisConnected();
}

export { closeRedis };
