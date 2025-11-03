import { Router } from 'express';
import { db } from '../db.js';
import { sql } from 'drizzle-orm';
import multer from 'multer';
import fs from 'fs/promises';
import path from 'path';
import { authenticateToken, AuthRequest } from '../middleware/auth-simple.js';

const router = Router();

// Ensure uploads directory exists
const uploadsRoot = path.join(process.cwd(), 'uploads');
const videosDir = path.join(uploadsRoot, 'videos');
const thumbnailsDir = path.join(uploadsRoot, 'thumbnails');

async function ensureUploadDirs() {
  await fs.mkdir(videosDir, { recursive: true });
  await fs.mkdir(thumbnailsDir, { recursive: true });
}

// Ensure template_videos table exists (runtime guard)
async function ensureTemplateVideosTable() {
  await db.run(sql`
    CREATE TABLE IF NOT EXISTS template_videos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      description TEXT,
      thumbnail_url TEXT,
      video_url TEXT NOT NULL,
      duration INTEGER,
      category TEXT DEFAULT 'general',
      tags TEXT DEFAULT '[]',
      difficulty TEXT DEFAULT 'easy',
      is_active INTEGER DEFAULT 1,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    )
  `);
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
  try {
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
    const destPath = path.join(videosDir, filename);
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
    }

    const nowIso = new Date().toISOString();
    const result = await db.run(sql`
      INSERT INTO template_videos (
        title, description, thumbnail_url, video_url, duration, category, tags, difficulty, is_active, created_at, updated_at
      ) VALUES (
        ${title}, ${description ?? null}, ${thumbnailUrl}, ${videoUrl}, ${durationNum}, ${category}, ${tagsJson}, ${difficulty}, 1, ${nowIso}, ${nowIso}
      )
    `);

    const inserted = await db.get(sql`
      SELECT * FROM template_videos WHERE id = ${result.lastInsertRowid}
    `);

    res.status(201).json(mapTemplateVideoRow(inserted));
  } catch (error) {
    console.error('Upload template video error:', error);
    res.status(500).json({ error: 'Failed to upload video' });
  }
});

export default router;
