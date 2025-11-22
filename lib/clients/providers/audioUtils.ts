/**
 * Audio processing utilities for local mode transcription.
 *
 * These functions prepare raw PCM audio for transcription by:
 * 1. Concatenating audio chunks
 * 2. Enhancing audio quality (DC offset removal, high-pass filter, normalization)
 * 3. Adding WAV headers for API compatibility
 *
 * Audio specifications (fixed format from native recorder):
 * - Sample rate: 16000 Hz
 * - Bit depth: 16 bits
 * - Channels: 1 (mono)
 *
 * Note: The native audio-recorder (Rust) handles resampling from the device's
 * native sample rate to 16kHz before sending data to the Electron app.
 * See: native/audio-recorder/src/main.rs (TARGET_SAMPLE_RATE)
 */

// Audio constants
export const SAMPLE_RATE = 16000
export const BIT_DEPTH = 16
export const CHANNELS = 1
export const BYTES_PER_SAMPLE = BIT_DEPTH / 8

/**
 * Concatenates multiple audio chunks into a single Uint8Array.
 */
export function concatenateAudioChunks(audioChunks: Uint8Array[]): Uint8Array {
  const totalLength = audioChunks.reduce((sum, chunk) => sum + chunk.length, 0)
  const fullAudio = new Uint8Array(totalLength)
  let offset = 0
  for (const chunk of audioChunks) {
    fullAudio.set(chunk, offset)
    offset += chunk.length
  }
  return fullAudio
}

/**
 * Light audio enhancement for 16-bit PCM mono at a given sample rate.
 * - Removes DC offset
 * - Applies a gentle high-pass filter (~80 Hz)
 * - Peak normalizes to ~-3 dBFS with a capped gain
 */
export function enhancePcm16(pcm: Buffer, sampleRate: number): Buffer {
  if (!pcm || pcm.length < 2) return pcm

  const sampleCount = Math.floor(pcm.length / 2)
  if (sampleCount <= 0) return pcm

  // Read int16 samples
  const samples = new Int16Array(sampleCount)
  for (let i = 0; i < sampleCount; i++) {
    samples[i] = pcm.readInt16LE(i * 2)
  }

  // DC offset removal
  let sum = 0
  for (let i = 0; i < sampleCount; i++) sum += samples[i]
  const mean = Math.trunc(sum / sampleCount)
  if (mean !== 0) {
    for (let i = 0; i < sampleCount; i++) {
      samples[i] = (samples[i] - mean) as unknown as Int16Array[number]
    }
  }

  // Gentle high-pass filter (~80 Hz)
  const fc = 80
  const a = Math.exp((-2 * Math.PI * fc) / sampleRate)
  let prevX = 0
  let prevY = 0
  const filtered = new Float32Array(sampleCount)
  for (let i = 0; i < sampleCount; i++) {
    const x = samples[i]
    const y = a * (prevY + x - prevX)
    filtered[i] = y
    prevX = x
    prevY = y
  }

  // Peak normalize to ~-3 dBFS, cap max gain to ~+12 dB
  let peak = 1
  for (let i = 0; i < sampleCount; i++) {
    const v = Math.abs(filtered[i])
    if (v > peak) peak = v
  }
  const target = 0.707 * 32767 // approx -3 dBFS
  const rawGain = target / peak
  const gain = Math.min(rawGain, 4.0)

  const out = Buffer.alloc(sampleCount * 2)
  if (gain > 1.05) {
    for (let i = 0; i < sampleCount; i++) {
      const v = Math.round(filtered[i] * gain)
      const clamped = Math.max(-32768, Math.min(32767, v))
      out.writeInt16LE(clamped, i * 2)
    }
  } else {
    for (let i = 0; i < sampleCount; i++) {
      const v = Math.round(filtered[i])
      const clamped = Math.max(-32768, Math.min(32767, v))
      out.writeInt16LE(clamped, i * 2)
    }
  }

  return out
}

/**
 * Creates a 44-byte WAV header for raw PCM audio data.
 */
export function createWavHeader(
  dataLength: number,
  sampleRate: number,
  channelCount: number,
  bitDepth: number,
): Buffer {
  const header = Buffer.alloc(44)

  // RIFF chunk descriptor
  header.write('RIFF', 0)
  header.writeUInt32LE(36 + dataLength, 4) // ChunkSize
  header.write('WAVE', 8)

  // "fmt " sub-chunk
  header.write('fmt ', 12)
  header.writeUInt32LE(16, 16) // Subchunk1Size (16 for PCM)
  header.writeUInt16LE(1, 20) // AudioFormat (1 for PCM)
  header.writeUInt16LE(channelCount, 22)
  header.writeUInt32LE(sampleRate, 24)

  const blockAlign = channelCount * (bitDepth / 8)
  const byteRate = sampleRate * blockAlign

  header.writeUInt32LE(byteRate, 28)
  header.writeUInt16LE(blockAlign, 32)
  header.writeUInt16LE(bitDepth, 34)

  // "data" sub-chunk
  header.write('data', 36)
  header.writeUInt32LE(dataLength, 40)

  return header
}

/**
 * Prepares raw PCM audio data for transcription by enhancing it and adding a WAV header.
 *
 * @param audioData - Raw PCM audio data (16-bit mono @ 16kHz)
 * @returns Buffer containing WAV-formatted audio ready for transcription
 */
export function prepareAudioForTranscription(audioData: Uint8Array): Buffer {
  const enhancedPcm = enhancePcm16(Buffer.from(audioData), SAMPLE_RATE)
  const wavHeader = createWavHeader(
    enhancedPcm.length,
    SAMPLE_RATE,
    CHANNELS,
    BIT_DEPTH,
  )

  return Buffer.concat([wavHeader, enhancedPcm])
}

/**
 * Calculate audio duration in milliseconds from byte length.
 */
export function calculateAudioDurationMs(byteLength: number): number {
  const bytesPerSecond = SAMPLE_RATE * CHANNELS * BYTES_PER_SAMPLE
  return Math.round((byteLength / bytesPerSecond) * 1000)
}

/**
 * Check if audio is too short for transcription (less than 100ms).
 */
export function isAudioTooShort(byteLength: number): boolean {
  return calculateAudioDurationMs(byteLength) < 100
}
