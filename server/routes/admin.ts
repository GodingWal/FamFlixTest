import { Router } from 'express';
import { db } from '../db.js';
import { sql } from 'drizzle-orm';
import { authenticateToken, AuthRequest } from '../middleware/auth-simple.js';

const router = Router();

// Get admin statistics
router.get('/api/admin/stats', authenticateToken, async (req: AuthRequest, res) => {
  try {
    if (req.user?.role !== 'admin') {
      return res.status(403).json({ error: 'Access denied. Admin privileges required.' });
    }

    // Get total counts
    const totalUsers = await db.get(sql`SELECT COUNT(*) as count FROM users`);
    const totalTemplateVideos = await db.get(sql`SELECT COUNT(*) as count FROM template_videos WHERE is_active = 1`);
    const totalVoiceClones = await db.get(sql`SELECT COUNT(*) as count FROM voice_profiles`);
    const totalVideos = await db.get(sql`SELECT COUNT(*) as count FROM videos`);

    // Get voice job statistics
    const voiceJobStats = await db.get(sql`
      SELECT 
        COUNT(*) as total,
        SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed,
        SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed,
        SUM(CASE WHEN status = 'processing' THEN 1 ELSE 0 END) as active
      FROM voice_jobs
    `);

    // Get recent users (last 10)
    const recentUsers = await db.all(sql`
      SELECT id, email, role, created_at 
      FROM users 
      ORDER BY created_at DESC 
      LIMIT 10
    `);

    // Get recent voice jobs (last 10)
    const recentVoiceJobs = await db.all(sql`
      SELECT vj.id, vj.name, vj.status, vj.created_at, u.email as user_email
      FROM voice_jobs vj
      LEFT JOIN users u ON vj.user_id = u.id
      ORDER BY vj.created_at DESC 
      LIMIT 10
    `);

    // Get recent template videos (last 10)
    const recentTemplateVideos = await db.all(sql`
      SELECT id, title, category, created_at
      FROM template_videos 
      WHERE is_active = 1
      ORDER BY created_at DESC 
      LIMIT 10
    `);

    const stats = {
      totalUsers: totalUsers?.count || 0,
      totalVideos: totalVideos?.count || 0,
      totalVoiceClones: totalVoiceClones?.count || 0,
      totalTemplateVideos: totalTemplateVideos?.count || 0,
      activeVoiceJobs: voiceJobStats?.active || 0,
      completedVoiceJobs: voiceJobStats?.completed || 0,
      failedVoiceJobs: voiceJobStats?.failed || 0,
      recentUsers: recentUsers || [],
      recentVoiceJobs: recentVoiceJobs || [],
      recentTemplateVideos: recentTemplateVideos || [],
    };

    res.json(stats);
  } catch (error) {
    console.error('Error fetching admin stats:', error);
    res.status(500).json({ error: 'Failed to fetch admin statistics' });
  }
});

// Get detailed user management data
router.get('/api/admin/users', authenticateToken, async (req: AuthRequest, res) => {
  try {
    if (req.user?.role !== 'admin') {
      return res.status(403).json({ error: 'Access denied. Admin privileges required.' });
    }

    const users = await db.all(sql`
      SELECT 
        u.id, u.email, u.role, u.created_at,
        COUNT(vj.id) as voice_jobs_count,
        COUNT(vp.id) as voice_profiles_count
      FROM users u
      LEFT JOIN voice_jobs vj ON u.id = vj.user_id
      LEFT JOIN voice_profiles vp ON u.id = vp.user_id
      GROUP BY u.id, u.email, u.role, u.created_at
      ORDER BY u.created_at DESC
    `);

    res.json(users);
  } catch (error) {
    console.error('Error fetching users:', error);
    res.status(500).json({ error: 'Failed to fetch users' });
  }
});

// Update user role
router.patch('/api/admin/users/:id/role', authenticateToken, async (req: AuthRequest, res) => {
  try {
    if (req.user?.role !== 'admin') {
      return res.status(403).json({ error: 'Access denied. Admin privileges required.' });
    }

    const { id } = req.params;
    const { role } = req.body;

    if (!['user', 'admin'].includes(role)) {
      return res.status(400).json({ error: 'Invalid role. Must be "user" or "admin"' });
    }

    await db.run(sql`
      UPDATE users 
      SET role = ${role}, updated_at = CURRENT_TIMESTAMP 
      WHERE id = ${id}
    `);

    res.json({ message: 'User role updated successfully' });
  } catch (error) {
    console.error('Error updating user role:', error);
    res.status(500).json({ error: 'Failed to update user role' });
  }
});

// Get system health status
router.get('/api/admin/health', authenticateToken, async (req: AuthRequest, res) => {
  try {
    if (req.user?.role !== 'admin') {
      return res.status(403).json({ error: 'Access denied. Admin privileges required.' });
    }

    // Check database connectivity
    const dbCheck = await db.get(sql`SELECT 1 as healthy`);
    
    // Basic TTS engine readiness (Chatterbox is local; assume available in dev)
    const ttsHealthy = true;

    const health = {
      database: dbCheck?.healthy === 1,
      tts: ttsHealthy,
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
    };

    res.json(health);
  } catch (error) {
    console.error('Error checking system health:', error);
    res.status(500).json({ 
      error: 'Failed to check system health',
      database: false,
      tts: false,
      timestamp: new Date().toISOString()
    });
  }
});

export default router;
