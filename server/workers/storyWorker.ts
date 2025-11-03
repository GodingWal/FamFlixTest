import { Worker } from "bullmq";

import { config } from "../config";
import { redisConnection } from "../queues/connection";
import { STORY_QUEUE_NAME, StorySynthesisJobData } from "../queues/storyQueue";
import { storage } from "../storage";
import { getTTSProvider } from "../tts";

const concurrency = config.STORY_WORKER_CONCURRENCY ?? 2;

export const storyWorker = new Worker<StorySynthesisJobData>(
  STORY_QUEUE_NAME,
  async (job) => {
    const { storyId, voiceId, force = false } = job.data;

    const story = await storage.getStory(storyId);
    if (!story) {
      throw new Error(`Story ${storyId} not found`);
    }

    const voice = await storage.getVoiceProfile(voiceId);
    if (!voice) {
      throw new Error(`Voice profile ${voiceId} not found`);
    }

    if (!voice.providerRef) {
      throw new Error(`Voice profile ${voiceId} does not have a provider reference`);
    }

    const provider = getTTSProvider(voice.provider ?? config.TTS_PROVIDER);

    const sections = await storage.getStorySections(storyId);
    if (sections.length === 0) {
      throw new Error(`Story ${storyId} has no sections to synthesize`);
    }

    const existingAudio = await storage.getStoryAudioForVoice(storyId, voiceId);
    const audioMap = new Map(existingAudio.map((audio) => [audio.sectionId, audio]));

    let completed = 0;

    for (const section of sections) {
      await job.updateProgress(Math.round((completed / sections.length) * 100));

      const currentAudio = audioMap.get(section.id);
      if (!force && currentAudio && currentAudio.status === "COMPLETE" && currentAudio.audioUrl) {
        completed += 1;
        continue;
      }

      await storage.upsertStoryAudio(section.id, voiceId, {
        status: "PROCESSING",
        startedAt: new Date(),
      });

      try {
        const result = await provider.synthesize({
          text: section.text,
          voiceRef: voice.providerRef,
          modelId: voice.modelId ?? undefined,
          storyId,
          sectionId: section.id,
        });

        await storage.upsertStoryAudio(section.id, voiceId, {
          status: "COMPLETE",
          audioUrl: result.url,
          durationSec: result.durationSec,
          checksum: result.checksum,
          completedAt: new Date(),
          metadata: {
            key: result.key,
          },
        });

        completed += 1;
      } catch (error) {
        await storage.upsertStoryAudio(section.id, voiceId, {
          status: "ERROR",
          error: error instanceof Error ? error.message : String(error),
          completedAt: new Date(),
        });

        throw error;
      }
    }

    await job.updateProgress(100);

    return {
      storyId,
      voiceId,
      sections: sections.length,
    };
  },
  {
    connection: redisConnection,
    concurrency,
  }
);

storyWorker.on("completed", (job) => {
  if (config.LOG_LEVEL === "debug") {
    console.debug(`[StoryWorker] Job ${job.id} completed.`);
  }
});

storyWorker.on("failed", (job, err) => {
  console.error(`[StoryWorker] Job ${job?.id ?? "unknown"} failed:`, err);
});
