#!/usr/bin/env tsx
import "dotenv/config";

import { storyWorker } from "../../server/workers/storyWorker";
import { redisConnection } from "../../server/queues/connection";

const shutdown = async () => {
  await storyWorker.close();
  await redisConnection.quit();
  process.exit(0);
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
