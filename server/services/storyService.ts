import { storage } from "../storage";
import { aiService } from "./aiService";
import { voiceService } from "./voiceService";
import { Story, StoryNarration, type InsertStory } from "@shared/schema-sqlite";

type StoryCategoryValue = Exclude<Story["category"], null | undefined>;

interface StoryGenerationOptions {
  storyId?: string;
  familyId?: string;
  userId: string;
  category?: string;
  title?: string;
  generateNarrations?: boolean;
  voiceProfileId?: string;
}

interface NarrationOptions {
  storyId: string;
  voiceProfileId: string;
  userId: string;
}

class StoryService {
  private readonly maxChunkLength = 600;

  async generateStory(options: StoryGenerationOptions): Promise<{ story: Story; narrations?: StoryNarration[] }> {
    const { storyId, familyId, userId, category, title, generateNarrations, voiceProfileId } = options;

    const existingStory = storyId ? await storage.getStory(storyId) : undefined;
    if (storyId && !existingStory) {
      throw new Error("Story not found");
    }

    const effectiveFamilyId = existingStory?.familyId ?? familyId;
    const familyContext = await this.buildFamilyContext(effectiveFamilyId);

    const rawContent = await aiService.generateKidsStory(familyContext);
    const content = this.normalizeContent(rawContent);
    const preferredTitle = title ?? (existingStory?.title ?? undefined);
    const derivedTitle = this.deriveTitle(content, preferredTitle);
    const storyCategory = this.normalizeCategory(category ?? existingStory?.category ?? undefined);
    const generatedAt = new Date().toISOString();

    let story: Story;
    if (existingStory) {
      const mergedMetadata = this.mergeMetadata(existingStory.metadata, {
        lastGeneratedAt: generatedAt,
        generator: "ai",
      });
      story = await storage.updateStory(existingStory.id, {
        content,
        title: derivedTitle,
        category: storyCategory as InsertStory["category"],
        status: "generated",
        metadata: mergedMetadata,
        familyId: effectiveFamilyId,
      });

      await storage.logActivity({
        userId,
        action: "story_regenerated",
        resourceType: "story",
        resourceId: story.id,
        details: {
          storyId: story.id,
          category: story.category,
          familyId: story.familyId,
        },
      });
    } else {
      story = await storage.createStory({
        content,
        createdBy: userId,
        familyId,
        category: storyCategory as InsertStory["category"],
        rights: "ORIGINAL",
        title: derivedTitle,
        status: "generated",
        metadata: {
          generator: "ai",
          generatedAt,
          familyContext: familyContext ? { id: familyContext.id, name: familyContext.name } : undefined,
        },
      });

      await storage.logActivity({
        userId,
        action: "story_created",
        resourceType: "story",
        resourceId: story.id,
        details: {
          storyId: story.id,
          category: story.category,
          familyId: story.familyId,
        },
      });
    }

    let narrations: StoryNarration[] | undefined;
    if (generateNarrations && voiceProfileId) {
      narrations = await this.generateNarrations({
        storyId: story.id,
        voiceProfileId,
        userId,
      });
    }

    return { story, narrations };
  }

  async generateNarrations(options: NarrationOptions): Promise<StoryNarration[]> {
    const { storyId, voiceProfileId, userId } = options;
    const story = await storage.getStory(storyId);
    if (!story) {
      throw new Error("Story not found");
    }

    const content = this.normalizeContent(story.content);
    const chunks = this.chunkContent(content);

    if (chunks.length === 0 || chunks.every(chunk => !chunk.trim())) {
      throw new Error("Story content is empty");
    }

    await storage.deleteStoryNarrations(storyId);

    const narrations: StoryNarration[] = [];
    for (let index = 0; index < chunks.length; index++) {
      const chunk = chunks[index];
      const generationId = await voiceService.generateSpeech(voiceProfileId, chunk, userId);
      const generation = await storage.getVoiceGeneration(generationId);
      const audioUrl = generation?.audioUrl;
      const audioFileName = audioUrl ? audioUrl.split("/").pop() : undefined;

      const narration = await storage.createStoryNarration({
        storyId,
        voiceProfileId,
        voiceGenerationId: generationId,
        chunkIndex: index,
        text: chunk,
        audioUrl: audioUrl ?? undefined,
        audioFileName,
        status: generation?.status ?? "completed",
        metadata: {
          voiceGenerationId: generationId,
          generatedAt: new Date().toISOString(),
        },
      });

      narrations.push(narration);
    }

    const updatedMetadata = this.mergeMetadata(story.metadata, {
      lastNarrationVoiceProfileId: voiceProfileId,
      narrationGeneratedAt: new Date().toISOString(),
      narrationChunks: narrations.length,
    });

    await storage.updateStory(storyId, {
      status: "narrated",
      metadata: updatedMetadata,
    });

    await storage.logActivity({
      userId,
      action: "story_narrations_generated",
      resourceType: "story",
      resourceId: storyId,
      details: {
        storyId,
        voiceProfileId,
        chunkCount: narrations.length,
      },
    });

    return narrations;
  }

  async getStoryNarrations(storyId: string): Promise<StoryNarration[]> {
    return storage.getStoryNarrations(storyId);
  }

  private async buildFamilyContext(familyId?: string) {
    if (!familyId) {
      return undefined;
    }

    const family = await storage.getFamily(familyId);
    if (!family) {
      return undefined;
    }

    const members = await storage.getFamilyMembers(familyId);
    return {
      id: family.id,
      name: family.name,
      description: family.description,
      members: members.map(member => ({
        id: member.id,
        firstName: member.firstName,
        lastName: member.lastName,
      })),
    };
  }

  private normalizeContent(content: string): string {
    return content
      .replace(/^\[[^\]]*\]\s*/g, "")
      .replace(/\r\n/g, "\n")
      .trim();
  }

  private normalizeCategory(input?: string | null): StoryCategoryValue {
    const fallback: StoryCategoryValue = "BEDTIME";
    if (!input) {
      return fallback;
    }

    const normalized = input.trim().toUpperCase().replace(/\s+/g, "_");

    const legacyMap: Record<string, StoryCategoryValue> = {
      KIDS_STORY: "BEDTIME",
      KIDS: "BEDTIME",
      FAMILY: "CUSTOM",
    };

    const mapped = legacyMap[normalized] ?? (normalized as StoryCategoryValue);
    const allowed = [
      "BEDTIME",
      "CLASSIC",
      "FAIRYTALE",
      "ADVENTURE",
      "EDUCATIONAL",
      "CUSTOM",
    ] as StoryCategoryValue[];

    return allowed.includes(mapped) ? mapped : fallback;
  }

  private deriveTitle(content: string, existingTitle?: string): string {
    if (existingTitle) {
      return existingTitle;
    }

    const firstLine = content.split(/\n+/).map(part => part.trim()).filter(Boolean)[0] || "Family Story";
    const cleaned = firstLine.replace(/^"|"$/g, "");
    if (cleaned.length <= 80) {
      return cleaned;
    }
    return `${cleaned.slice(0, 77)}...`;
  }

  private chunkContent(content: string): string[] {
    const rawParagraphs = content.split(/\n+/).map(paragraph => paragraph.trim()).filter(Boolean);
    const paragraphs = rawParagraphs.flatMap(paragraph => {
      if (paragraph.length <= this.maxChunkLength) {
        return [paragraph];
      }

      const sentenceChunks = paragraph.match(/[^.!?]+[.!?]?/g) || [paragraph];
      const normalized = sentenceChunks.map(sentence => sentence.trim()).filter(Boolean);
      return normalized.length > 0 ? normalized : [paragraph];
    });
    const chunks: string[] = [];
    let current = "";

    for (const paragraph of paragraphs) {
      if (!current) {
        current = paragraph;
        continue;
      }

      const combined = `${current}\n\n${paragraph}`;
      if (combined.length <= this.maxChunkLength) {
        current = combined;
      } else {
        chunks.push(current);
        current = paragraph;
      }
    }

    if (current) {
      chunks.push(current);
    }

    if (chunks.length === 0) {
      return [content];
    }

    return chunks;
  }

  private mergeMetadata(existing: any, updates: Record<string, any>) {
    const base = existing && typeof existing === "object" ? existing : {};
    return { ...base, ...updates };
  }
}

export const storyService = new StoryService();
