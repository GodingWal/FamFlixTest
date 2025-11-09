import type { StorySynthesisJobData } from "./storyQueue";

type LocalJobStateValue =
  | "waiting"
  | "active"
  | "completed"
  | "failed";

interface LocalJobTimestamps {
  createdAt: Date;
  finishedAt: Date | null;
}

export interface LocalStoryJobState {
  id: string;
  data: StorySynthesisJobData;
  state: LocalJobStateValue;
  progress: number;
  attempts: number;
  failedReason: string | null;
  result: unknown;
  timestamps: LocalJobTimestamps;
  cancelled?: boolean;
}

type RunnerContext = {
  updateProgress: (value: number) => void;
  isCancelled: () => boolean;
};

const jobs = new Map<string, LocalStoryJobState>();
const activeRunners = new Map<string, Promise<void>>();
const JOB_RETENTION_MS = 1000 * 60 * 30; // 30 minutes

function clampProgress(value: number) {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.min(100, Math.max(0, Math.round(value)));
}

function cleanupFinishedJobs() {
  const now = Date.now();
  for (const [jobId, job] of jobs.entries()) {
    if (
      job.state === "completed" ||
      job.state === "failed"
    ) {
      const finishedAt = job.timestamps.finishedAt?.getTime();
      if (finishedAt && now - finishedAt > JOB_RETENTION_MS) {
        jobs.delete(jobId);
      }
    }
  }
}

export function getLocalStoryJob(jobId: string): LocalStoryJobState | undefined {
  cleanupFinishedJobs();
  return jobs.get(jobId);
}

export function cancelLocalStoryJob(jobId: string) {
  const job = jobs.get(jobId);
  if (job) {
    job.cancelled = true;
  }
  jobs.delete(jobId);
  activeRunners.delete(jobId);
}

export function enqueueLocalStoryJob(
  data: StorySynthesisJobData,
  runner: (ctx: RunnerContext) => Promise<unknown>
): LocalStoryJobState {
  cleanupFinishedJobs();
  const jobId = `${data.storyId}:${data.voiceId}`;
  let job = jobs.get(jobId);
  if (!job) {
    job = {
      id: jobId,
      data,
      state: "waiting",
      progress: 0,
      attempts: 0,
      failedReason: null,
      result: null,
      timestamps: {
        createdAt: new Date(),
        finishedAt: null,
      },
    };
    jobs.set(jobId, job);
  }

  // If a runner is already in-flight, just return the existing job state
  if (activeRunners.has(jobId)) {
    return job;
  }

  job.state = "waiting";
  job.progress = 0;
  job.failedReason = null;
  job.result = null;
  job.cancelled = false;
  job.timestamps = {
    createdAt: new Date(),
    finishedAt: null,
  };
  job.attempts += 1;

  const ctx: RunnerContext = {
    updateProgress: (value: number) => {
      const current = jobs.get(jobId);
      if (!current) return;
      current.progress = clampProgress(value);
    },
    isCancelled: () => Boolean(jobs.get(jobId)?.cancelled),
  };

  const runnerPromise = (async () => {
    try {
      const current = jobs.get(jobId);
      if (!current) {
        return;
      }

      current.state = "active";
      const result = await runner(ctx);
      if (current.cancelled) {
        current.state = "failed";
        current.failedReason = "Job cancelled";
      } else {
        current.state = "completed";
        current.progress = 100;
        current.result = result ?? null;
      }
    } catch (error) {
      const current = jobs.get(jobId);
      if (current) {
        current.state = "failed";
        current.failedReason = error instanceof Error ? error.message : String(error);
      }
    } finally {
      const current = jobs.get(jobId);
      if (current) {
        current.timestamps.finishedAt = new Date();
      }
      activeRunners.delete(jobId);
    }
  })();

  activeRunners.set(jobId, runnerPromise);
  runnerPromise.catch(() => {
    // Swallow errors since they are captured above
  });

  return job;
}
