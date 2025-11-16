import { Router } from 'express';
import { db } from '../db.js';
import { sql } from 'drizzle-orm';
import multer from 'multer';
import fs from 'fs/promises';
import path from 'path';
import { authenticateToken, AuthRequest } from '../middleware/auth-simple.js';
import { storage } from '../storage';
import { adminVideoPipelineService } from '../services/adminVideoPipelineService';
import { ensureTemplateVideosTable } from '../utils/templateVideos';

const router = Router();

// Ensure uploads directory exists
const uploadsRoot = path.join(process.cwd(), 'uploads');
const videosDir = path.join(uploadsRoot, 'videos');
const thumbnailsDir = path.join(uploadsRoot, 'thumbnails');

async function ensureUploadDirs() {
  await fs.mkdir(videosDir, { recursive: true });
  await fs.mkdir(thumbnailsDir, { recursive: true });
}

async function safeUnlinkByUrl(fileUrl?: string | null) {
  if (!fileUrl || !fileUrl.startsWith('/uploads/')) {
    return;
  }
  const filePath = path.join(process.cwd(), fileUrl.replace(/^\/+/,'') );
  try {
    await fs.unlink(filePath);
  } catch (error: any) {
    if (error?.code !== 'ENOENT') {
      console.warn('[templateVideos] Failed to remove file', filePath, error);
    }
  }
}

function parseMetadata(value: unknown): Record<string, unknown> {
  if (!value) return {};
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === 'object' ? { ...parsed } : {};
    } catch {
      return {};
    }
  }
  if (typeof value === 'object' && !Array.isArray(value)) {
    return { ...(value as Record<string, unknown>) };
  }
  return {};
}

// Multer config (memory storage, we write to disk)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 500 * 1024 * 1024 }, // 500MB
});

const mapTemplateVideoRow = (row: any) => {
  if (!row) return null;

  let parsedTags: string[] = [];
  if (Array.isArray(row.tags)) {
    parsedTags = row.tags;
  } else if (typeof row.tags === 'string') {
    try {
      parsedTags = JSON.parse(row.tags);
    } catch {
      parsedTags = [];
    }
  }

  const metadata = parseMetadata(row.metadata);

  return {
    id: row.id,
    title: row.title,
    description: row.description ?? '',
    thumbnailUrl: row.thumbnail_url ?? '',
    videoUrl: row.video_url,
    duration: row.duration ?? 0,
    category: row.category ?? 'general',
    tags: parsedTags,
    difficulty: row.difficulty ?? 'easy',
    isActive: row.is_active === 1 || row.is_active === true,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    metadata,
  };
};

// Get all active template videos
router.get('/api/template-videos', async (req, res) => {
  try {
    await ensureTemplateVideosTable();
    const videos = await db.all(sql`
      SELECT * FROM template_videos 
      WHERE is_active = 1 
      ORDER BY category, created_at DESC
    `);
    
    const videosWithCamelCase = videos.map(mapTemplateVideoRow);
    res.json(videosWithCamelCase);
  } catch (error) {
    console.error('Error fetching template videos:', error);
    res.status(500).json({ error: 'Failed to fetch template videos' });
  }
});

// Get single template video by ID
router.get('/api/template-videos/:id', async (req, res) => {
  try {
    const { id } = req.params;
    await ensureTemplateVideosTable();
    const video = await db.get(sql`
      SELECT * FROM template_videos 
      WHERE id = ${id} AND is_active = 1
    `);
    
    if (!video) {
      return res.status(404).json({ error: 'Video not found' });
    }
    
    res.json(mapTemplateVideoRow(video));
  } catch (error) {
    console.error('Error fetching template video:', error);
    res.status(500).json({ error: 'Failed to fetch template video' });
  }
});

// Get videos by category
router.get('/api/template-videos/category/:category', async (req, res) => {
  try {
    const { category } = req.params;
    await ensureTemplateVideosTable();
    const videos = await db.all(sql`
      SELECT * FROM template_videos 
      WHERE category = ${category} AND is_active = 1 
      ORDER BY created_at DESC
    `);
    
    const videosWithCamelCase = videos.map(mapTemplateVideoRow);
    res.json(videosWithCamelCase);
  } catch (error) {
    console.error('Error fetching videos by category:', error);
    res.status(500).json({ error: 'Failed to fetch videos' });
  }
});

// Admin upload endpoint for template videos
router.post('/api/template-videos', authenticateToken, upload.fields([
  { name: 'video', maxCount: 1 },
  { name: 'thumbnail', maxCount: 1 },
]), async (req: AuthRequest, res) => {
  let destPath: string | null = null;
  let createdThumbnailPath: string | null = null;
  let templateId: number | null = null;
  let adminVideoId: string | null = null;
  try {
    if (req.user?.role !== 'admin') {
      return res.status(403).json({ error: 'Access denied. Admin privileges required.' });
    }

    await ensureUploadDirs();
    await ensureTemplateVideosTable();

    const videoFile = Array.isArray((req.files as any)?.video) ? (req.files as any).video[0] : undefined;
    const thumbnailFile = Array.isArray((req.files as any)?.thumbnail) ? (req.files as any).thumbnail[0] : undefined;

    if (!videoFile) {
      return res.status(400).json({ error: 'Video file is required (field name: video)' });
    }

    const { title, description, category = 'general', tags = '[]', difficulty = 'easy', duration } = req.body as any;
    if (!title || String(title).trim().length === 0) {
      return res.status(400).json({ error: 'Title is required' });
    }

    const safeBase = String(title).toLowerCase().replace(/[^a-z0-9-_]+/g, '-').slice(0, 60) || 'video';
    const filename = `${Date.now()}_${safeBase}.mp4`;
    destPath = path.join(videosDir, filename);
    await fs.writeFile(destPath, videoFile.buffer);

    const videoUrl = `/uploads/videos/${filename}`;
    const tagsJson = typeof tags === 'string' ? tags : JSON.stringify(tags ?? []);
    const durationNum = duration ? Number(duration) : null;
    let thumbnailUrl: string | null = null;
    if (thumbnailFile) {
      const thumbExt = path.extname(thumbnailFile.originalname) || '.jpg';
      const thumbFilename = `${Date.now()}_${safeBase}${thumbExt}`;
      const thumbDest = path.join(thumbnailsDir, thumbFilename);
      await fs.writeFile(thumbDest, thumbnailFile.buffer);
      thumbnailUrl = `/uploads/thumbnails/${thumbFilename}`;
      createdThumbnailPath = thumbDest;
    }

    const nowIso = new Date().toISOString();
    const result = await db.run(sql`
      INSERT INTO template_videos (
        title, description, thumbnail_url, video_url, duration, category, tags, difficulty, is_active, metadata, created_at, updated_at
      ) VALUES (
        ${title}, ${description ?? null}, ${thumbnailUrl}, ${videoUrl}, ${durationNum}, ${category}, ${tagsJson}, ${difficulty}, 1, ${JSON.stringify({})}, ${nowIso}, ${nowIso}
      )
    `);

    const inserted = await db.get(sql`
      SELECT * FROM template_videos WHERE id = ${result.lastInsertRowid}
    `);

    if (!inserted) {
      throw new Error('Failed to retrieve inserted template video');
    }
    templateId = inserted.id;

    // Create a matching admin-provided video entry for pipeline processing
    const adminVideo = await storage.createAdminProvidedVideo({
      title,
      description: description ?? null,
      thumbnail: thumbnailUrl,
      videoUrl,
      duration: durationNum,
      status: 'processing',
      familyId: null,
      createdBy: req.user!.id,
      metadata: {
        source: 'template_video',
        templateId: inserted.id,
      },
    } as any);
    adminVideoId = adminVideo.id;

    const templateMetadata = {
      sourceVideoId: adminVideo.id,
      pipelineStatus: 'queued',
    };

    await db.run(sql`
      UPDATE template_videos
      SET metadata = ${JSON.stringify(templateMetadata)}, updated_at = ${new Date().toISOString()}
      WHERE id = ${inserted.id}
    `);

    try {
      await adminVideoPipelineService.enqueue(adminVideo.id, adminVideo.videoUrl);
    } catch (pipelineError) {
      console.error('Failed to enqueue admin pipeline for template video:', pipelineError);
      if (templateId) {
        await db.run(sql`
          DELETE FROM template_videos WHERE id = ${templateId}
        `);
      }
      if (destPath) {
        await fs.unlink(destPath).catch(() => undefined);
      }
      if (createdThumbnailPath) {
        await fs.unlink(createdThumbnailPath).catch(() => undefined);
      }
      if (adminVideoId) {
        await storage.deleteVideo(adminVideoId).catch(() => undefined);
      }
      return res.status(500).json({ error: 'Template video saved, but preprocessing pipeline failed to start.' });
    }

    const updated = await db.get(sql`
      SELECT * FROM template_videos WHERE id = ${inserted.id}
    `);

    res.status(201).json(mapTemplateVideoRow(updated));
  } catch (error) {
    console.error('Upload template video error:', error);
    if (templateId) {
      await db.run(sql`
        DELETE FROM template_videos WHERE id = ${templateId}
      `).catch(() => undefined);
    }
    if (destPath) {
      await fs.unlink(destPath).catch(() => undefined);
    }
    if (createdThumbnailPath) {
      await fs.unlink(createdThumbnailPath).catch(() => undefined);
    }
    if (adminVideoId) {
      await storage.deleteVideo(adminVideoId).catch(() => undefined);
    }
    res.status(500).json({ error: 'Failed to upload video' });
  }
});

router.patch('/api/template-videos/:id', authenticateToken, async (req: AuthRequest, res) => {
  try {
    if (req.user?.role !== 'admin') {
      return res.status(403).json({ error: 'Access denied. Admin privileges required.' });
    }

    await ensureTemplateVideosTable();
    const { id } = req.params;
    const video = await db.get(sql`SELECT * FROM template_videos WHERE id = ${id}`);
    if (!video) {
      return res.status(404).json({ error: 'Template video not found' });
    }

    const { title, description, category, difficulty, duration, tags, isActive } = req.body ?? {};
    const assignments: any[] = [];

    if (title !== undefined) {
      assignments.push(sql`title = ${title}`);
    }
    if (description !== undefined) {
      assignments.push(sql`description = ${description}`);
    }
    if (category !== undefined) {
      assignments.push(sql`category = ${category}`);
    }
    if (difficulty !== undefined) {
      assignments.push(sql`difficulty = ${difficulty}`);
    }
    if (duration !== undefined) {
      const durationValueRaw = duration === null || duration === '' ? null : Number(duration);
      const durationValue = durationValueRaw === null || Number.isFinite(durationValueRaw) ? durationValueRaw : null;
      assignments.push(sql`duration = ${durationValue}`);
    }
    if (tags !== undefined) {
      let tagsValue: string;
      if (Array.isArray(tags)) {
        tagsValue = JSON.stringify(tags);
      } else if (typeof tags === 'string') {
        try {
          JSON.parse(tags);
          tagsValue = tags;
        } catch {
          const splitTags = tags.split(',').map((tag) => tag.trim()).filter(Boolean);
          tagsValue = JSON.stringify(splitTags);
        }
      } else {
        tagsValue = JSON.stringify([]);
      }
      assignments.push(sql`tags = ${tagsValue}`);
    }
    if (isActive !== undefined) {
      const activeValue = typeof isActive === 'boolean' ? (isActive ? 1 : 0) : Number(isActive) ? 1 : 0;
      assignments.push(sql`is_active = ${activeValue}`);
    }

    if (!assignments.length) {
      return res.status(400).json({ error: 'No updates provided' });
    }

    assignments.push(sql`updated_at = ${new Date().toISOString()}`);

    await db.run(sql`
      UPDATE template_videos
      SET ${sql.join(assignments, sql`, `)}
      WHERE id = ${id}
    `);

    const updated = await db.get(sql`SELECT * FROM template_videos WHERE id = ${id}`);
    res.json(mapTemplateVideoRow(updated));
  } catch (error) {
    console.error('Update template video error:', error);
    res.status(500).json({ error: 'Failed to update template video' });
  }
});

router.delete('/api/template-videos/:id', authenticateToken, async (req: AuthRequest, res) => {
  try {
    if (req.user?.role !== 'admin') {
      return res.status(403).json({ error: 'Access denied. Admin privileges required.' });
    }

    await ensureTemplateVideosTable();
    const { id } = req.params;
    const template = await db.get(sql`SELECT * FROM template_videos WHERE id = ${id}`);
    if (!template) {
      return res.status(404).json({ error: 'Template video not found' });
    }

    await db.run(sql`DELETE FROM template_videos WHERE id = ${id}`);

    await safeUnlinkByUrl(template.video_url);
    await safeUnlinkByUrl(template.thumbnail_url);

    const meta = parseMetadata(template.metadata);
    if (meta.sourceVideoId) {
      await storage.deleteVideo(meta.sourceVideoId).catch(() => undefined);
    }

    res.json({ message: 'Template video deleted' });
  } catch (error) {
    console.error('Delete template video error:', error);
    res.status(500).json({ error: 'Failed to delete template video' });
  }
});

export default router;
