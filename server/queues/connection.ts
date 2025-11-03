import IORedis from "ioredis";

import { config } from "../config";

const redisUrl = config.REDIS_URL ?? "redis://127.0.0.1:6379";

export const redisConnection = new IORedis(redisUrl, {
  maxRetriesPerRequest: null,
});
