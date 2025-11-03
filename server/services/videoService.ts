import { storage } from "../storage";
import { InsertVideo } from "../db/schema";
import { aiService } from "./aiService";

export class VideoService {
  async createVideo(videoData: InsertVideo) {
    const video = await storage.createVideo(videoData);
    
    // Log activity
    await storage.logActivity({
      userId: video.createdBy,
      action: "create_video",
      resourceType: "video",
      resourceId: video.id,
      details: { title: video.title },
    });

    return video;
  }

  async updateVideo(videoId: string, updates: Partial<InsertVideo>, userId: string) {
    const video = await storage.updateVideo(videoId, updates);
    
    // Log activity
    await storage.logActivity({
      userId,
      action: "update_video",
      resourceType: "video", 
      resourceId: videoId,
      details: { updates },
    });

    return video;
  }

  async getVideosByFamily(familyId: string) {
    return await storage.getVideosByFamily(familyId);
  }

  async getVideosByUser(userId: string) {
    return await storage.getVideosByUser(userId);
  }

  async generateVideoScript(prompt: string, familyId?: string) {
    let familyContext = null;
    if (familyId) {
      // Get family context for better script generation
      const family = await storage.getFamily(familyId);
      const members = await storage.getFamilyMembers(familyId);
      familyContext = {
        familyName: family?.name,
        memberCount: members.length,
        memberNames: members.map(m => `${m.firstName} ${m.lastName}`).filter(Boolean),
      };
    }

    return await aiService.generateVideoScript(prompt, familyContext);
  }

  async generateVideoSuggestions(familyId: string) {
    const family = await storage.getFamily(familyId);
    const members = await storage.getFamilyMembers(familyId);
    const recentVideos = await storage.getVideosByFamily(familyId);

    const familyData = {
      familyName: family?.name,
      memberCount: members.length,
      recentVideoTitles: recentVideos.slice(0, 5).map(v => v.title),
    };

    return await aiService.generateVideoSuggestions(familyData);
  }

  async processVideoUpload(videoFile: Buffer, metadata: any) {
    // In a real implementation, this would:
    // 1. Upload video to cloud storage
    // 2. Extract video metadata (duration, dimensions, etc.)
    // 3. Generate thumbnail
    // 4. Process video for different formats/qualities
    
    // For now, simulate processing
    return {
      videoUrl: `/temp/video-${Date.now()}.mp4`,
      thumbnail: `/temp/thumbnail-${Date.now()}.jpg`,
      duration: 180, // 3 minutes
      metadata: {
        width: 1920,
        height: 1080,
        format: "mp4",
        size: videoFile.length,
      },
    };
  }

  async deleteVideo(videoId: string, userId: string) {
    const video = await storage.getVideo(videoId);
    if (!video) {
      throw new Error("Video not found");
    }

    // End any active collaboration sessions
    const activeSessions = await storage.getActiveCollaborators(videoId);
    for (const session of activeSessions) {
      await storage.endCollaborationSession(session.id);
    }

    await storage.deleteVideo(videoId);

    // Log activity
    await storage.logActivity({
      userId,
      action: "delete_video",
      resourceType: "video",
      resourceId: videoId,
      details: { title: video.title },
    });
  }

  async enhanceVideoDescription(description: string) {
    return await aiService.enhanceVideoDescription(description);
  }

  async generateNarrationScript(videoContent: string, voicePersonality?: string) {
    return await aiService.generateNarrationScript(videoContent, voicePersonality);
  }
}

export const videoService = new VideoService();
