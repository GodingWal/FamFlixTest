import { Queue } from "bullmq";

import { redisConnection } from "./connection";

// BullMQ queue names cannot contain ':', so use an underscore.
export const STORY_QUEUE_NAME = "story_synthesize";

export const storyQueue = new Queue(STORY_QUEUE_NAME, {
  connection: redisConnection,
  defaultJobOptions: {
    removeOnComplete: 100,
    removeOnFail: 50,
  },
});

export interface StorySynthesisJobData {
  storyId: string;
  voiceId: string;
  force?: boolean;
}

export function enqueueStorySynthesis(data: StorySynthesisJobData) {
  return storyQueue.add("synthesize", data, {
    jobId: `${data.storyId}:${data.voiceId}`,
  });
}
