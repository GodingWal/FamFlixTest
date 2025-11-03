import { PassThrough, Transform } from "stream";
import { pipeline } from "stream/promises";
import { Readable } from "stream";
import { createHash } from "crypto";
import { nanoid } from "nanoid";

import { config } from "../../config";
import { uploadStreamToS3 } from "../../utils/s3";
import type { ITTSProvider, TTSInput, TTSResult } from "../TTSProvider";

const ELEVEN_BASE_URL = "https://api.elevenlabs.io/v1";

export class ElevenLabsProvider implements ITTSProvider {
  constructor(private readonly apiKey: string) {
    if (!apiKey) {
      throw new Error("ElevenLabs API key is required to initialize the provider");
    }
  }

  async synthesize({ text, voiceRef, modelId }: TTSInput): Promise<TTSResult> {
    if (!voiceRef) {
      throw new Error("Voice reference is required for ElevenLabs TTS");
    }

    const response = await fetch(`${ELEVEN_BASE_URL}/text-to-speech/${voiceRef}/stream`, {
      method: "POST",
      headers: {
        "xi-api-key": this.apiKey,
        "content-type": "application/json",
        accept: "audio/mpeg",
      },
      body: JSON.stringify({
        text,
        model_id: modelId || config.ELEVENLABS_TTS_MODEL || "eleven_turbo_v2_5",
        voice_settings: {
          stability: config.ELEVENLABS_OPT_STABILITY ?? 0.5,
          similarity_boost: config.ELEVENLABS_OPT_SIMILARITY_BOOST ?? 0.75,
        },
      }),
    });

    if (!response.ok || !response.body) {
      const errText = await response.text().catch(() => "");
      throw new Error(`ElevenLabs TTS failed: ${response.status} ${errText}`);
    }

    const readable = Readable.fromWeb(response.body as any);
    const checksum = createHash("md5");
    const key = `${config.STORY_AUDIO_PREFIX.replace(/\/$/, "")}/raw/${Date.now()}-${voiceRef}-${nanoid(6)}.mp3`;
    const passThrough = new PassThrough();

    const uploadPromise = uploadStreamToS3(key, "audio/mpeg", passThrough);

    await pipeline(
      readable,
      new Transform({
        transform(chunk, _encoding, callback) {
          checksum.update(chunk);
          callback(null, chunk);
        },
      }),
      passThrough
    );

    const { url } = await uploadPromise;

    return {
      key,
      url,
      checksum: checksum.digest("hex"),
    };
  }
}
