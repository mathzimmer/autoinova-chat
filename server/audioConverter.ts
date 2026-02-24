/**
 * Audio Converter - Converts audio/webm to audio/ogg (opus codec)
 * 
 * WhatsApp accepts: audio/aac, audio/mp4, audio/mpeg, audio/amr, audio/ogg
 * Browser MediaRecorder produces: audio/webm;codecs=opus
 * 
 * We use the system ffmpeg to convert from webm container to ogg container with opus codec.
 * The system ffmpeg is available in the deploy environment.
 * 
 * If ffmpeg is not available, we fall back to sending the original webm file
 * (which may not work with WhatsApp but at least won't crash).
 */

import { execFile } from "child_process";
import { promisify } from "util";
import { writeFile, readFile, unlink, mkdtemp, rmdir } from "fs/promises";
import { tmpdir } from "os";
import path from "path";

const execFileAsync = promisify(execFile);

/**
 * Get ffmpeg binary path - tries multiple locations
 */
function getFfmpegPath(): string {
  // Try ffmpeg-static package first (dev environment)
  try {
    const ffmpegPath = require("ffmpeg-static") as string | null;
    if (ffmpegPath) return ffmpegPath;
  } catch {
    // Not available
  }

  // Use system ffmpeg (available in deploy environment)
  return "ffmpeg";
}

/**
 * Check if ffmpeg is available
 */
async function isFfmpegAvailable(): Promise<boolean> {
  const ffmpegPath = getFfmpegPath();
  try {
    await execFileAsync(ffmpegPath, ["-version"], { timeout: 5000 });
    return true;
  } catch {
    return false;
  }
}

/**
 * Convert a webm audio buffer to ogg format (opus codec)
 * Uses ffmpeg to re-encode with opus codec in ogg container
 */
export async function convertWebmToOgg(webmBuffer: Buffer): Promise<Buffer> {
  const ffmpegPath = getFfmpegPath();

  // Create temp directory for conversion
  const tempDir = await mkdtemp(path.join(tmpdir(), "audio-convert-"));
  const inputPath = path.join(tempDir, "input.webm");
  const outputPath = path.join(tempDir, "output.ogg");

  try {
    // Write input file
    await writeFile(inputPath, webmBuffer);

    // Convert webm → ogg using ffmpeg
    // -c:a libopus = encode with opus codec
    // -b:a 48k = bitrate for voice
    // -ar 48000 = sample rate (opus standard)
    // -ac 1 = mono (voice)
    // -f ogg = output format
    await execFileAsync(ffmpegPath, [
      "-i", inputPath,
      "-c:a", "libopus",
      "-b:a", "48k",
      "-ar", "48000",
      "-ac", "1",
      "-f", "ogg",
      "-y",
      outputPath,
    ], {
      timeout: 30000, // 30s timeout
    });

    // Read output file
    const oggBuffer = await readFile(outputPath);

    console.log(`[AudioConverter] Converted webm (${webmBuffer.length} bytes) → ogg (${oggBuffer.length} bytes)`);

    return oggBuffer;
  } finally {
    // Cleanup temp files
    await unlink(inputPath).catch(() => {});
    await unlink(outputPath).catch(() => {});
    await rmdir(tempDir).catch(() => {});
  }
}

/**
 * Check if a mime type needs conversion for WhatsApp
 */
export function needsConversionForWhatsApp(mimeType: string): boolean {
  const baseMime = mimeType.split(";")[0].trim().toLowerCase();
  // WhatsApp accepted audio formats
  const whatsappAccepted = ["audio/aac", "audio/mp4", "audio/mpeg", "audio/amr", "audio/ogg"];
  return !whatsappAccepted.includes(baseMime);
}

export { isFfmpegAvailable };
