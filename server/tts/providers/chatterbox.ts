import { spawn } from "child_process";
import path from "path";
import fs from "fs";
import { promises as fsp } from "fs";
import { PassThrough, Transform } from "stream";
import { pipeline } from "stream/promises";
import { createHash } from "crypto";
import { nanoid } from "nanoid";

import { config } from "../../config";
import { uploadStreamToS3 } from "../../utils/s3";
import type { ITTSProvider, TTSInput, TTSResult } from "../TTSProvider";

export class ChatterboxProvider implements ITTSProvider {
  private readonly scriptPath: string;
  private readonly pythonBin: string;

  constructor() {
    this.scriptPath = path.resolve(process.cwd(), config.CHATTERBOX_SCRIPT_PATH || "scripts/chatterbox_tts.py");
    this.pythonBin = config.PYTHON_BIN || "python3";
  }

  async synthesize({ text, voiceRef, storyId, sectionId }: TTSInput): Promise<TTSResult> {
    if (!voiceRef) {
      throw new Error("Voice reference (audio prompt path) is required for Chatterbox TTS");
    }

    const absPrompt = path.isAbsolute(voiceRef)
      ? voiceRef
      : path.resolve(process.cwd(), voiceRef.replace(/^\//, ""));

    const tempDir = path.resolve(process.cwd(), "temp");
    await fsp.mkdir(tempDir, { recursive: true });

    const outFile = path.join(
      tempDir,
      `cb-${Date.now()}-${nanoid(6)}.wav`
    );

    const args: string[] = [
      this.scriptPath,
      "--text",
      text,
      "--out",
      outFile,
      "--speaker-wav",
      absPrompt,
    ];

    if (config.CHATTERBOX_DEVICE) {
      args.push("--device", String(config.CHATTERBOX_DEVICE));
    }
    if (config.CHATTERBOX_MULTILINGUAL) {
      args.push("--multilingual");
    }
    if (config.CHATTERBOX_LANGUAGE_ID) {
      args.push("--language", String(config.CHATTERBOX_LANGUAGE_ID));
    }
    if (typeof config.CHATTERBOX_EXAGGERATION === "number") {
      args.push("--exaggeration", String(config.CHATTERBOX_EXAGGERATION));
    }
    if (typeof config.CHATTERBOX_CFG_WEIGHT === "number") {
      args.push("--cfg-weight", String(config.CHATTERBOX_CFG_WEIGHT));
    }
    if (typeof config.CHATTERBOX_STEPS === "number") {
      args.push("--steps", String(config.CHATTERBOX_STEPS));
    }

    // Dynamic max_new_tokens based on text length to avoid hanging on CPU
    // Rough estimate: 1 token ~ 4 chars. We give plenty of buffer (1 token per char) but cap it.
    // Minimum 50 tokens (for very short text), Maximum 256 (or config limit).
    const estimatedTokens = Math.max(50, Math.ceil(text.length));
    const configMax = typeof config.CHATTERBOX_MAX_NEW_TOKENS === "number" ? config.CHATTERBOX_MAX_NEW_TOKENS : 256;
    const maxTokens = Math.min(configMax, estimatedTokens);

    args.push("--max-new-tokens", String(maxTokens));

    const stdout = await this.runPython(args);

    let payload: any = null;
    try {
      payload = JSON.parse(stdout.trim().split("\n").filter(Boolean).pop() || "{}");
      if (payload && payload.error) {
        throw new Error(String(payload.error));
      }
    } catch (err) {
      throw new Error(`Chatterbox CLI returned invalid output: ${String(err)}`);
    }

    // If S3 is not configured, fall back to serving from local temp via /api/audio/:filename
    if (!config.S3_BUCKET) {
      const filename = path.basename(outFile);
      // Compute checksum locally
      const localHash = createHash("md5");
      try {
        await pipeline(
          fs.createReadStream(outFile),
          new Transform({
            transform(chunk: Buffer, _enc: BufferEncoding, cb: (err?: Error | null, data?: unknown) => void) {
              localHash.update(chunk);
              cb(null, chunk);
            },
          }),
          new PassThrough() // drain
        );
      } catch {
        // ignore checksum errors; leave hash empty
      }

      return {
        key: filename,
        url: `/api/audio/${filename}`,
        checksum: localHash.digest("hex"),
        durationSec: typeof payload?.duration_sec === "number" ? payload.duration_sec : undefined,
        transcript: undefined,
      } satisfies TTSResult;
    }

    // Upload to S3 (default path)
    const keyBase = config.STORY_AUDIO_PREFIX.replace(/\/$/, "");
    const s3Key = `${keyBase}/raw/${Date.now()}-cb-${nanoid(6)}.wav`;

    const checksum = createHash("md5");
    const pass = new PassThrough();

    const uploadPromise = uploadStreamToS3(s3Key, "audio/wav", pass);

    await pipeline(
      fs.createReadStream(outFile),
      new Transform({
        transform(chunk: Buffer, _enc: BufferEncoding, cb: (err?: Error | null, data?: unknown) => void) {
          checksum.update(chunk);
          cb(null, chunk);
        },
      }),
      pass
    );

    const { url } = await uploadPromise;

    // Optionally clean up temp file after successful upload
    try { await fsp.unlink(outFile); } catch (e) {
      // ignore cleanup errors
    }

    return {
      key: s3Key,
      url,
      checksum: checksum.digest("hex"),
      durationSec: typeof payload?.duration_sec === "number" ? payload.duration_sec : undefined,
      transcript: undefined,
    } satisfies TTSResult;
  }

  private runPython(args: string[]): Promise<string> {
    return new Promise((resolve, reject) => {
      console.log(`[Chatterbox] Executing: ${this.pythonBin} ${args.join(" ")}`);
      const proc = spawn(this.pythonBin, args, { stdio: ["ignore", "pipe", "pipe"] });

      // Set a timeout (e.g., 10 minutes) to prevent indefinite hangs
      const timeoutMs = 600000;
      const timeout = setTimeout(() => {
        console.error(`[Chatterbox] Process timed out after ${timeoutMs}ms. Killing...`);
        proc.kill("SIGKILL");
        reject(new Error("Chatterbox process timed out"));
      }, timeoutMs);

      let out = "";
      let err = "";
      proc.stdout.on("data", (d: Buffer) => { out += d.toString(); });
      proc.stderr.on("data", (d: Buffer) => { err += d.toString(); });
      proc.on("error", (e: Error) => {
        clearTimeout(timeout);
        console.error("[Chatterbox] Process error:", e);
        reject(e);
      });
      proc.on("close", (code: number | null) => {
        clearTimeout(timeout);
        if (code !== 0) {
          console.error(`[Chatterbox] Failed with code ${code}. Stderr: ${err}`);
          console.error(`[Chatterbox] Stdout: ${out}`);
        } else {
          if (err) console.log(`[Chatterbox] Stderr (warning?): ${err}`);
          // Check for fallback beep in output
          if (out.includes("fallback_beep_audio")) {
            console.error("[Chatterbox] WARNING: Script reported success but fell back to beep audio!");
            console.error(`[Chatterbox] Stderr: ${err}`);
          }
        }
        if (code === 0) return resolve(out);
        reject(new Error(`Chatterbox process exited with code ${code}: ${err || out}`));
      });
    });
  }
}
