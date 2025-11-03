import OpenAI from 'openai';
import axios from 'axios';

/*
<important_code_snippet_instructions>
Using gpt-oss model through Ollama. Ollama provides OpenAI-compatible endpoints.
The default model is "gpt-oss" but can be configured via environment variables.
Falls back to simulation mode when Ollama is not available.
</important_code_snippet_instructions>
*/

// <important_do_not_delete>
const DEFAULT_MODEL_STR = process.env.OLLAMA_MODEL || "gpt-oss";
const OLLAMA_BASE_URL = process.env.OLLAMA_BASE_URL || "http://localhost:11434/v1";
const USE_SIMULATION = process.env.AI_SIMULATION_MODE === "true" || process.env.NODE_ENV === "development";
// </important_do_not_delete>

const openai = new OpenAI({
  baseURL: OLLAMA_BASE_URL,
  apiKey: "ollama", // Required by OpenAI SDK but not used by Ollama
});

// Check if Ollama is available
let ollamaAvailable = false;
const checkOllamaAvailability = async () => {
  try {
    await axios.get(OLLAMA_BASE_URL.replace('/v1', '/api/tags'), { timeout: 2000 });
    ollamaAvailable = true;
    console.log('✅ Ollama is available and ready');
  } catch (error) {
    ollamaAvailable = false;
    console.log('⚠️  Ollama not available, using simulation mode');
  }
};

// Check Ollama availability on startup
checkOllamaAvailability();

export class AIService {
  private async generateWithOllamaOrFallback(messages: any[], maxTokens: number): Promise<string> {
    if (!USE_SIMULATION && ollamaAvailable) {
      try {
        const completion = await openai.chat.completions.create({
          model: DEFAULT_MODEL_STR,
          max_tokens: maxTokens,
          messages,
        });
        return completion.choices[0]?.message?.content || '';
      } catch (error) {
        console.error('Ollama API error, falling back to simulation:', error);
        ollamaAvailable = false;
      }
    }
    
    // Simulation mode - generate mock responses
    const userMessage = messages.find(m => m.role === 'user')?.content || '';
    return this.generateSimulatedResponse(userMessage, maxTokens);
  }

  private generateSimulatedResponse(prompt: string, maxTokens: number): string {
    // Generate realistic but simulated responses based on the prompt type
    if (prompt.toLowerCase().includes('script')) {
      return `[Simulated AI Response]\n\nINT. FAMILY LIVING ROOM - DAY\n\nThe family gathers around, sharing stories and laughter. This is a moment of pure joy and connection.\n\nMOM: "Remember when we..."\nDAD: "That was such a special day..."\n\nThe camera captures the warmth and love that fills the room.\n\nFADE OUT.`;
    } else if (prompt.toLowerCase().includes('suggest') || prompt.toLowerCase().includes('idea')) {
      return `["Family Game Night Documentary", "Holiday Traditions Through the Years", "Grandparents' Stories Collection", "Pet Adventures Compilation", "Cooking Together Memories"]`;
    } else if (prompt.toLowerCase().includes('enhance') || prompt.toLowerCase().includes('description')) {
      return `[Simulated AI Response]\n\nThis heartwarming family video captures precious moments of togetherness, featuring genuine smiles, laughter, and the beautiful bonds that make your family unique. Perfect for preserving memories that will be cherished for generations to come.`;
    } else if (prompt.toLowerCase().includes('narration')) {
      return `[Simulated AI Response]\n\n"In every family, there are moments that define who we are. These are the stories of love, laughter, and the beautiful journey we share together. Each smile tells a story, each moment becomes a treasure, and every memory reminds us of the incredible bond that makes us family."`;
    } else if (prompt.toLowerCase().includes('kids') || prompt.toLowerCase().includes('story') || prompt.toLowerCase().includes('children')) {
      const stories = [
        "Once upon a time, there was a brave little rabbit named Luna who discovered a magical garden behind her grandmother's house. In this garden, flowers could sing and trees could dance! Luna learned that with kindness and courage, she could help the garden creatures solve their problems and make new friends. The end brought a beautiful lesson about helping others and believing in yourself.",
        "In a cozy village, there lived a young fox named Oliver who was afraid of the dark. But one special night, he met a wise owl who showed him that the darkness was full of wonderful surprises - twinkling fireflies, shooting stars, and gentle moon beams. Oliver learned that sometimes our fears become our greatest adventures when we face them with an open heart.",
        "Little Maya loved to paint, but she thought her pictures weren't as good as others. One day, she discovered that her paintings came to life when she painted with love and joy instead of worry. Her colorful butterflies flew off the page, her painted flowers bloomed in real life, and she realized that art made with happiness is the most beautiful art of all."
      ];
      const randomStory = stories[Math.floor(Math.random() * stories.length)];
      return `[Simulated Kids Story]\n\n${randomStory}`;
    }
    
    return `[Simulated AI Response]\n\nThis is a simulated response for development purposes. The actual AI integration will provide real content when properly configured.`;
  }

  async generateVideoScript(prompt: string, familyContext?: any): Promise<string> {
    try {
      const systemPrompt = `You are a family video storytelling assistant. Create engaging, heartwarming scripts for family videos that capture precious moments and memories. Focus on emotional connection, natural dialogue, and storytelling that brings families together.`;

      const contextualPrompt = familyContext 
        ? `Family context: ${JSON.stringify(familyContext)}\n\nScript request: ${prompt}`
        : prompt;

      return await this.generateWithOllamaOrFallback([
        {
          role: 'system',
          content: systemPrompt
        },
        { 
          role: 'user', 
          content: contextualPrompt 
        }
      ], 2048);
    } catch (error) {
      console.error('AI script generation error:', error);
      throw new Error('Failed to generate video script');
    }
  }

  async generateVideoSuggestions(familyData: any): Promise<string[]> {
    try {
      const prompt = `Based on this family data: ${JSON.stringify(familyData)}, suggest 5 creative family video ideas that would be meaningful and engaging. Return as a JSON array of strings.`;

      const response = await this.generateWithOllamaOrFallback([
        { 
          role: 'user', 
          content: prompt 
        }
      ], 1024);

      try {
        const suggestions = JSON.parse(response);
        return Array.isArray(suggestions) ? suggestions : [];
      } catch {
        return response.split('\n').filter((line: string) => line.trim());
      }
    } catch (error) {
      console.error('AI suggestions generation error:', error);
      throw new Error('Failed to generate video suggestions');
    }
  }

  async enhanceVideoDescription(description: string): Promise<string> {
    try {
      const prompt = `Enhance this video description to be more engaging and family-friendly while maintaining the original meaning: "${description}"`;

      return await this.generateWithOllamaOrFallback([
        { 
          role: 'user', 
          content: prompt 
        }
      ], 512);
    } catch (error) {
      console.error('AI description enhancement error:', error);
      throw new Error('Failed to enhance video description');
    }
  }

  async generateNarrationScript(videoContent: string, voicePersonality?: string): Promise<string> {
    try {
      const systemPrompt = `You are creating narration scripts for family videos. The narration should be warm, engaging, and capture the emotional essence of family moments.`;
      
      const personalityContext = voicePersonality 
        ? `Voice personality: ${voicePersonality}\n\n`
        : '';

      const prompt = `${personalityContext}Create a heartwarming narration script for this video content: ${videoContent}`;

      return await this.generateWithOllamaOrFallback([
        {
          role: 'system',
          content: systemPrompt
        },
        { 
          role: 'user', 
          content: prompt 
        }
      ], 1024);
    } catch (error) {
      console.error('AI narration generation error:', error);
      throw new Error('Failed to generate narration script');
    }
  }

  async generateKidsStory(familyContext?: any, options?: { targetSeconds?: number }): Promise<string> {
    try {
      const targetSeconds = typeof options?.targetSeconds === 'number' && options.targetSeconds > 0
        ? Math.min(Math.max(Math.floor(options.targetSeconds), 8), 60) // guardrails: 8s..60s
        : undefined;

      // If preview requested, craft a much shorter story prompt (roughly ~2 words/sec)
      const approxWords = targetSeconds ? Math.max(20, Math.floor(targetSeconds * 2)) : undefined;

      const systemPrompt = targetSeconds
        ? `You are a beloved children's storyteller. Create a VERY SHORT, wholesome kids story that can be read aloud in ~${targetSeconds} seconds (~${approxWords} words). Keep it:
 - Age-appropriate for 4-10
 - Positive and friendly (no scary elements)
 - 2–4 very short sentences
 - Simple, vivid language`
        : `You are a beloved children's storyteller creating magical, wholesome stories for kids. Your stories should be:
 - Age-appropriate for children 4-10 years old
 - Include positive messages and life lessons
 - Feature adventure, friendship, or family themes
 - Be engaging but not scary
 - About 2-3 minutes when read aloud (200-400 words)
 - Include vivid descriptions that spark imagination`;

      const contextualPrompt = targetSeconds
        ? (familyContext
            ? `Write a VERY SHORT kids story (~${approxWords} words) that could involve a family like this: ${JSON.stringify(familyContext)}. Make it warm and magical.`
            : `Write a VERY SHORT kids story (~${approxWords} words) about adventure, friendship, or family. Keep it wholesome and warm.`)
        : (familyContext
            ? `Create a kids story that could involve a family like this: ${JSON.stringify(familyContext)}. Make it magical and fun!`
            : `Create a magical kids story about adventure, friendship, or family. Make it wholesome and engaging for children.`);

      return await this.generateWithOllamaOrFallback([
        {
          role: 'system',
          content: systemPrompt
        },
        { 
          role: 'user', 
          content: contextualPrompt 
        }
      ], 1024);
    } catch (error) {
      console.error('AI kids story generation error:', error);
      throw new Error('Failed to generate kids story');
    }
  }
}

export const aiService = new AIService();
