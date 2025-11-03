# ElevenLabs Instant Voice Cloning Integration

## Overview

This document summarizes the integration of ElevenLabs Instant Voice Cloning API into the FamFlix Portal voice cloning feature, based on the [official ElevenLabs documentation](https://elevenlabs.io/docs/cookbooks/voices/instant-voice-cloning).

## Implementation Details

### API Integration

- **Endpoint**: `/voices/ivc/create` - ElevenLabs Instant Voice Cloning API
- **Method**: POST with FormData containing multiple audio files
- **Authentication**: Uses `xi-api-key` header with ElevenLabs API key
- **Timeout**: 60 seconds for voice cloning requests

### Key Features Implemented

1. **Multiple Audio File Support**
   - Supports sending multiple audio samples for better voice cloning quality
   - Each file is processed individually and sent to ElevenLabs
   - Files are named sequentially: `voice_sample_1.wav`, `voice_sample_2.wav`, etc.

2. **Audio Preprocessing**
   - Optimizes audio for ElevenLabs requirements
   - Converts to optimal format: 44.1kHz, Mono, 24-bit WAV
   - Applies audio enhancements (normalization, noise filtering)
   - Handles various input formats and converts to WAV

3. **Error Handling**
   - Comprehensive error handling for API failures
   - Specific error messages for different failure scenarios:
     - Invalid API key (401)
     - Insufficient audio quality (400)
     - Rate limit exceeded (429)
     - Insufficient credits (402)
     - Network timeouts and connection issues

4. **Voice Job Processing**
   - Asynchronous job processing with real-time status updates
   - Progress tracking through multiple stages
   - Support for job cancellation and retry
   - Quality scoring based on audio analysis

### Code Structure

#### VoiceService (`server/services/voiceService.ts`)

```typescript
// Main method for single audio file
async createVoiceClone(audioFile: Buffer, name: string, userId: string, familyId?: string): Promise<string>

// New method for multiple audio files
async createVoiceCloneFromFiles(audioFiles: Buffer[], name: string, userId: string, familyId?: string): Promise<string>
```

#### VoiceJobService (`server/services/voiceJobService.ts`)

- Processes voice cloning jobs asynchronously
- Handles multiple audio recordings from the frontend
- Integrates with ElevenLabs API through VoiceService
- Provides real-time job status updates

### API Request Format

```typescript
const formData = new FormData();
formData.append("name", voiceName);

// Add multiple audio files
for (let i = 0; i < audioFiles.length; i++) {
  formData.append("files", audioStream, {
    filename: `voice_sample_${i + 1}.wav`,
    contentType: "audio/wav",
  });
}

// Send to ElevenLabs
const response = await axios.post(
  `${elevenlabsBaseUrl}/voices/ivc/create`,
  formData,
  {
    headers: {
      "xi-api-key": apiKey,
      ...formData.getHeaders(),
    },
    timeout: 60000,
  }
);
```

### Database Schema Updates

Voice profiles now store additional metadata:

```typescript
metadata: {
  elevenlabsVoiceId: string,
  isRealClone: true,
  cloneType: "instant",
  audioFileCount: number,
  originalFileSizes: number[],
  createdAt: string,
  elevenlabsResponse: {
    voice_id: string,
    name: string,
    category: "instant_clone"
  }
}
```

## Configuration Requirements

### Environment Variables

```bash
ELEVENLABS_API_KEY=your_elevenlabs_api_key_here
```

### API Key Setup

1. Create an ElevenLabs account at [elevenlabs.io](https://elevenlabs.io)
2. Generate an API key from the dashboard
3. Add the API key to your environment variables
4. Ensure you have sufficient credits for voice cloning operations

## Usage Flow

1. **User Records Voice Samples**
   - Frontend captures multiple audio recordings
   - Each recording is analyzed for quality
   - Recordings are sent to backend via FormData

2. **Voice Job Creation**
   - Backend creates a voice job with all recordings
   - Job is added to processing queue
   - User receives job ID for tracking

3. **ElevenLabs Processing**
   - Audio files are preprocessed for optimal quality
   - Files are sent to ElevenLabs Instant Voice Cloning API
   - API returns voice ID for the created clone

4. **Voice Profile Storage**
   - Voice profile is stored in database
   - ElevenLabs voice ID is linked to the profile
   - User can now generate speech with the cloned voice

## Quality Improvements

- **Multiple Samples**: Better voice cloning quality with diverse audio samples
- **Audio Optimization**: Preprocessing ensures optimal audio format
- **Error Recovery**: Robust error handling with user-friendly messages
- **Real-time Updates**: Live progress tracking during processing

## Testing

To test the integration:

1. Ensure ElevenLabs API key is configured
2. Record multiple voice samples using the voice cloning wizard
3. Submit the voice job and monitor progress
4. Verify voice clone creation in ElevenLabs dashboard
5. Test speech generation with the cloned voice

## Future Enhancements

- Support for Professional Voice Cloning (longer training time)
- Voice cloning quality metrics and feedback
- Batch processing for multiple voice clones
- Integration with ElevenLabs voice settings and customization
