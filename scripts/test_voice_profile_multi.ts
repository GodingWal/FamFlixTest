#!/usr/bin/env -S node --enable-source-maps
import 'dotenv/config';
import { promises as fs } from 'fs';
import path from 'path';
import crypto from 'crypto';
import { storage } from '../server/storage';
import { voiceService } from '../server/services/voiceService';

async function main() {
  const pythonBin = process.env.PYTHON_BIN || 'python3';
  const uploadsDir = path.resolve(process.cwd(), 'uploads');
  const tempDir = path.resolve(process.cwd(), 'temp');
  await fs.mkdir(uploadsDir, { recursive: true });
  await fs.mkdir(tempDir, { recursive: true });

  const promptPath = path.join(tempDir, 'cb-prompt.wav');
  try {
    await fs.access(promptPath);
  } catch {
    throw new Error(`Missing ${promptPath}. Please generate it first with scripts/chatterbox_tts.py`);
  }

  const buf = await fs.readFile(promptPath);
  const audioFiles = [buf, buf, buf, buf];

  const ts = Date.now().toString(36);
  const email = `cbmulti+${ts}@local.test`;
  const username = `cbmulti_${ts}`;
  const user = await storage.createUser({
    username,
    email,
    password: crypto.randomBytes(12).toString('hex'),
    firstName: 'CB',
    lastName: 'Multi',
    avatar: null as any,
    role: 'user' as any,
    plan: 'free' as any,
    planRenewalAt: null as any,
    isActive: true as any,
    isEmailVerified: true as any,
    emailVerifiedAt: new Date() as any,
  } as any);

  const name = `Chatter Multi ${ts}`;
  const profileId = await voiceService.createVoiceCloneFromFiles(audioFiles, name, user.id);
  const profile = await storage.getVoiceProfile(profileId);

  const text = 'Multi-file clone test. This should succeed without buffer errors.';
  const generationId = await voiceService.generateSpeech(profileId, text, user.id);
  const generation = await storage.getVoiceGeneration(generationId);

  console.log(JSON.stringify({ ok: true, profileId, profile, generation }, null, 2));
}

main().catch((err) => {
  console.error(JSON.stringify({ ok: false, error: err?.message || String(err) }));
  process.exit(1);
});
