import { config } from "../config";
import type { ITTSProvider } from "./TTSProvider";
import { ElevenLabsProvider } from "./providers/elevenlabs";
import { ChatterboxProvider } from "./providers/chatterbox";

const providers: Partial<Record<string, ITTSProvider>> = {};

// Always register Chatterbox (does not require API key)
providers.CHATTERBOX = new ChatterboxProvider();

if (config.ELEVENLABS_API_KEY) {
  providers.ELEVENLABS = new ElevenLabsProvider(config.ELEVENLABS_API_KEY);
}

export function getTTSProvider(provider?: string): ITTSProvider {
  const key = provider ?? config.TTS_PROVIDER;
  const instance = providers[key];

  if (!instance) {
    throw new Error(`TTS provider '${key}' is not configured`);
  }

  return instance;
}

export function hasTTSProvider(provider: string): boolean {
  return Boolean(providers[provider]);
}
