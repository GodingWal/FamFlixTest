import { Router, type RequestHandler } from "express";

import { config } from "../config";
import { storage } from "../storage";
import { authenticateToken, type AuthRequest } from "../middleware/auth";
import {
  storyCategories,
  rightsStatuses,
  type Story,
  type StorySection,
  type StoryAudio,
  type StoryCategory,
  type RightsStatus,
} from "../db/schema";
import { enqueueStorySynthesis, storyQueue, type StorySynthesisJobData } from "../queues/storyQueue";
import { hasTTSProvider } from "../tts";

const router = Router();

const STORY_MODE_NOT_ENABLED = { error: "Story Mode is not enabled" } as const;
const STORY_RIGHTS_FOR_PUBLIC: RightsStatus[] = ["PUBLIC_DOMAIN", "LICENSED", "ORIGINAL"];
const CATEGORY_SET = new Set(storyCategories.map((category) => category.toUpperCase()));
const RIGHTS_SET = new Set(rightsStatuses.map((status) => status.toUpperCase()));

const ensureStoryModeEnabled: RequestHandler = (_req, res, next) => {
  if (!config.FEATURE_STORY_MODE) {
    return res.status(404).json(STORY_MODE_NOT_ENABLED);
  }
  return next();
};

function normalizeCategoryParam(value?: string | null): StoryCategory | undefined {
  if (!value) {
    return undefined;
  }
  const normalized = value.trim().toUpperCase();
  return CATEGORY_SET.has(normalized) ? (normalized as StoryCategory) : undefined;
}

function normalizeRights(value?: string | null): RightsStatus | undefined {
  if (!value) {
    return undefined;
  }
  const normalized = value.trim().toUpperCase();
  return RIGHTS_SET.has(normalized) ? (normalized as RightsStatus) : undefined;
}

function parseTags(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((item) => String(item));
  }

  if (typeof value === "string" && value.trim() !== "") {
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) {
        return parsed.map((item) => String(item));
      }
    } catch {
      return value
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean);
    }
  }

  return [];
}

function parseMetadata(value: unknown): Record<string, unknown> | undefined {
  if (!value) {
    return undefined;
  }

  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return typeof parsed === "object" && parsed !== null ? parsed : undefined;
    } catch {
      return undefined;
    }
  }

  if (typeof value === "object") {
    return value as Record<string, unknown>;
  }

  return undefined;
}

function toIso(value: unknown): string | null {
  if (!value) {
    return null;
  }
  const date = value instanceof Date ? value : new Date(value as string | number);
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  return date.toISOString();
}

function serializeStory(story: Story, options?: { includeContent?: boolean }) {
  const category = normalizeCategory(story.category);
  const rights = normalizeRights(story.rights) ?? "UNSPECIFIED";

  return {
    id: story.id,
    slug: story.slug,
    title: story.title,
    author: story.author ?? null,
    category,
    rights,
    tags: parseTags(story.tags),
    coverUrl: story.coverUrl ?? null,
    summary: story.summary ?? null,
    ageRange: {
      min: story.ageMin ?? null,
      max: story.ageMax ?? null,
    },
    durationMin: story.durationMin ?? null,
    metadata: parseMetadata(story.metadata) ?? {},
    createdAt: toIso(story.createdAt),
    updatedAt: toIso(story.updatedAt),
    ...(options?.includeContent ? { content: story.content } : {}),
  };
}

function serializeSection(section: StorySection, options?: { includeText?: boolean }) {
  const wordCount = typeof section.wordCount === "number"
    ? section.wordCount
    : section.text.split(/\s+/).filter(Boolean).length;

  return {
    id: section.id,
    index: section.sectionIndex,
    title: section.title ?? null,
    wordCount,
    ...(options?.includeText ? { text: section.text } : {}),
  };
}

function serializeAudioEntry(entry?: StoryAudio) {
  if (!entry) {
    return {
      status: "PENDING",
      audioUrl: null,
      durationSec: null,
      checksum: null,
      transcript: null,
      error: null,
      metadata: {},
      startedAt: null,
      completedAt: null,
      updatedAt: null,
    };
  }

  return {
    status: entry.status,
    audioUrl: entry.audioUrl ?? null,
    durationSec: entry.durationSec ?? null,
    checksum: entry.checksum ?? null,
    transcript: entry.transcript ?? null,
    error: entry.error ?? null,
    metadata: parseMetadata(entry.metadata) ?? {},
    startedAt: toIso(entry.startedAt),
    completedAt: toIso(entry.completedAt),
    updatedAt: toIso(entry.updatedAt),
  };
}

function normalizeCategory(value?: string | null): StoryCategory {
  const normalized = normalizeCategoryParam(value ?? undefined);
  return normalized ?? "BEDTIME";
}

function storyAccessibleToPublic(story: Story): boolean {
  const rights = normalizeRights(story.rights) ?? "UNSPECIFIED";
  return STORY_RIGHTS_FOR_PUBLIC.includes(rights);
}

router.get("/api/stories", ensureStoryModeEnabled, async (req, res) => {
  const category = normalizeCategoryParam(typeof req.query.category === "string" ? req.query.category : undefined);
  const query = typeof req.query.q === "string" ? req.query.q : undefined;
  const ageMin = typeof req.query.ageMin === "string" ? Number.parseInt(req.query.ageMin, 10) : undefined;
  const ageMax = typeof req.query.ageMax === "string" ? Number.parseInt(req.query.ageMax, 10) : undefined;
  const limit = typeof req.query.limit === "string" ? Number.parseInt(req.query.limit, 10) : undefined;
  const offset = typeof req.query.offset === "string" ? Number.parseInt(req.query.offset, 10) : undefined;

  const { items, total } = await storage.searchStories({
    category,
    query,
    ageMin: Number.isNaN(ageMin ?? NaN) ? undefined : ageMin,
    ageMax: Number.isNaN(ageMax ?? NaN) ? undefined : ageMax,
    limit,
    offset,
    rights: STORY_RIGHTS_FOR_PUBLIC,
    requireSlug: true,
  });

  const stories = items
    .filter(storyAccessibleToPublic)
    .map((story) => serializeStory(story));

  res.json({
    total,
    stories,
  });
});

router.get("/api/stories/:slug", ensureStoryModeEnabled, async (req, res) => {
  const story = await storage.getStoryBySlug(req.params.slug);
  if (!story || !storyAccessibleToPublic(story)) {
    return res.status(404).json({ error: "Story not found" });
  }

  const sections = await storage.getStorySections(story.id);
  const payload = serializeStory(story, { includeContent: true });

  return res.json({
    ...payload,
    sections: sections.map((section) => serializeSection(section, { includeText: true })),
  });
});

router.post("/api/stories/:slug/read", authenticateToken, ensureStoryModeEnabled, async (req: AuthRequest, res) => {
  const { voiceId, force } = req.body ?? {};

  if (!voiceId || typeof voiceId !== "string") {
    return res.status(400).json({ error: "voiceId is required" });
  }

  const story = await storage.getStoryBySlug(req.params.slug);
  if (!story || !storyAccessibleToPublic(story)) {
    return res.status(404).json({ error: "Story not found" });
  }

  const voice = await storage.getVoiceProfile(voiceId);
  if (!voice || voice.userId !== req.user!.id) {
    return res.status(403).json({ error: "You do not have access to this voice profile" });
  }

  const providerKey = voice.provider ?? config.TTS_PROVIDER;
  if (!hasTTSProvider(providerKey)) {
    return res.status(400).json({ error: `TTS provider '${providerKey}' is not configured` });
  }

  const sections = await storage.getStorySections(story.id);
  if (sections.length === 0) {
    return res.status(400).json({ error: "Story has no sections to synthesize" });
  }

  const existingAudio = await storage.getStoryAudioForVoice(story.id, voiceId);
  const audioMap = new Map(existingAudio.map((audio) => [audio.sectionId, audio]));
  const needsRegeneration = sections.filter((section) => {
    const entry = audioMap.get(section.id);
    return !entry || entry.status !== "COMPLETE" || !entry.audioUrl;
  });

  if (!force && needsRegeneration.length === 0) {
    return res.json({
      ready: true,
      jobId: null,
      sections: sections.map((section) => ({
        ...serializeSection(section, { includeText: true }),
        audio: serializeAudioEntry(audioMap.get(section.id)),
      })),
    });
  }

  const jobId = `${story.id}:${voiceId}`;

  if (force) {
    const existingJob = await storyQueue.getJob(jobId);
    if (existingJob) {
      await existingJob.remove();
    }
  }

  for (const section of sections) {
    const entry = audioMap.get(section.id);
    if (!entry || force || entry.status !== "COMPLETE") {
      await storage.upsertStoryAudio(section.id, voiceId, {
        status: "QUEUED",
        audioUrl: entry?.audioUrl,
        durationSec: entry?.durationSec,
        checksum: entry?.checksum,
        startedAt: undefined,
        completedAt: undefined,
        error: undefined,
        metadata: entry?.metadata ? parseMetadata(entry.metadata) : undefined,
      });
    }
  }

  try {
    await enqueueStorySynthesis({ storyId: story.id, voiceId, force: Boolean(force) });
  } catch (error: any) {
    if (!String(error?.message ?? "").includes("already exists")) {
      throw error;
    }
  }

  const job = await storyQueue.getJob(jobId);
  const state = job ? await job.getState() : "queued";
  const progress = job?.progress ?? 0;

  return res.json({
    ready: false,
    jobId,
    state,
    progress,
    story: {
      id: story.id,
      slug: story.slug,
      title: story.title,
    },
    voice: {
      id: voice.id,
      displayName: voice.displayName ?? voice.name,
    },
  });
});

router.get("/api/stories/:slug/audio", authenticateToken, ensureStoryModeEnabled, async (req: AuthRequest, res) => {
  const voiceId = typeof req.query.voiceId === "string" ? req.query.voiceId : undefined;

  if (!voiceId) {
    return res.status(400).json({ error: "voiceId query parameter is required" });
  }

  const story = await storage.getStoryBySlug(req.params.slug);
  if (!story || !storyAccessibleToPublic(story)) {
    return res.status(404).json({ error: "Story not found" });
  }

  const voice = await storage.getVoiceProfile(voiceId);
  if (!voice || voice.userId !== req.user!.id) {
    return res.status(403).json({ error: "You do not have access to this voice profile" });
  }

  const sections = await storage.getStorySections(story.id);
  const audioEntries = await storage.getStoryAudioForVoice(story.id, voiceId);
  const audioMap = new Map(audioEntries.map((entry) => [entry.sectionId, entry]));

  return res.json({
    story: serializeStory(story),
    voice: {
      id: voice.id,
      displayName: voice.displayName ?? voice.name,
    },
    sections: sections.map((section) => ({
      ...serializeSection(section, { includeText: true }),
      audio: serializeAudioEntry(audioMap.get(section.id)),
    })),
  });
});

router.get("/api/jobs/:jobId", authenticateToken, ensureStoryModeEnabled, async (req: AuthRequest, res) => {
  const job = await storyQueue.getJob(req.params.jobId);
  if (!job) {
    return res.status(404).json({ error: "Job not found" });
  }

  const data = job.data as StorySynthesisJobData | undefined;
  if (!data) {
    return res.status(404).json({ error: "Invalid job payload" });
  }

  const voice = await storage.getVoiceProfile(data.voiceId);
  if (!voice || voice.userId !== req.user!.id) {
    return res.status(403).json({ error: "You do not have access to this job" });
  }

  const state = await job.getState();

  return res.json({
    id: job.id,
    state,
    progress: job.progress ?? 0,
    attempts: job.attemptsMade,
    data,
    result: job.returnvalue ?? null,
    failedReason: job.failedReason ?? null,
    timestamp: {
      createdAt: job.timestamp ? new Date(job.timestamp).toISOString() : null,
      finishedAt: job.finishedOn ? new Date(job.finishedOn).toISOString() : null,
    },
  });
});

export default router;
