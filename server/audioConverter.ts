/**
 * Audio Converter - Converts audio/webm to audio/ogg (opus codec)
 * 
 * WhatsApp accepts: audio/aac, audio/mp4, audio/mpeg, audio/amr, audio/ogg
 * Browser MediaRecorder produces: audio/webm;codecs=opus
 * 
 * RULE: NEVER send webm to WhatsApp. Always convert first.
 * If conversion fails, the audio is NOT sent to WhatsApp.
 */

import { execFile } from "child_process";
import { promisify } from "util";
import { writeFile, readFile, unlink, mkdtemp, rmdir } from "fs/promises";
import { tmpdir } from "os";
import path from "path";

const execFileAsync = promisify(execFile);

/**
 * Get ffmpeg binary path - tries ffmpeg-static first, then system ffmpeg
 */
function getFfmpegPath(): string {
  // Try ffmpeg-static package first (works in both dev and deploy)
  try {
    const ffmpegPath = require("ffmpeg-static") as string | null;
    if (ffmpegPath) {
      console.log(`[AudioConverter] Using ffmpeg-static: ${ffmpegPath}`);
      return ffmpegPath;
    }
  } catch {
    // Not available
  }

  // Fallback to system ffmpeg
  console.log("[AudioConverter] ffmpeg-static not found, trying system ffmpeg");
  return "ffmpeg";
}

// Cache the ffmpeg path after first resolution
let cachedFfmpegPath: string | null = null;

function getOrCacheFfmpegPath(): string {
  if (!cachedFfmpegPath) {
    cachedFfmpegPath = getFfmpegPath();
  }
  return cachedFfmpegPath;
}

/**
 * Check if ffmpeg is available
 */
async function isFfmpegAvailable(): Promise<boolean> {
  const ffmpegPath = getOrCacheFfmpegPath();
  try {
    const { stdout } = await execFileAsync(ffmpegPath, ["-version"], { timeout: 5000 });
    const versionLine = stdout.split("\n")[0] || "unknown";
    console.log(`[AudioConverter] ffmpeg available: ${versionLine}`);
    return true;
  } catch (err: any) {
    console.error(`[AudioConverter] ffmpeg NOT available at "${ffmpegPath}":`, err.message);
    return false;
  }
}

/**
 * Convert a webm audio buffer to ogg format (opus codec)
 * Uses ffmpeg to re-mux/re-encode with opus codec in ogg container
 * 
 * THROWS on failure - caller must handle the error and NOT send webm to WhatsApp
 */
export async function convertWebmToOgg(webmBuffer: Buffer): Promise<Buffer> {
  const ffmpegPath = getOrCacheFfmpegPath();

  console.log(`[AudioConverter] Starting conversion: webm (${webmBuffer.length} bytes) → ogg`);
  console.log(`[AudioConverter] Using ffmpeg at: ${ffmpegPath}`);

  // Create temp directory for conversion
  const tempDir = await mkdtemp(path.join(tmpdir(), "audio-convert-"));
  const inputPath = path.join(tempDir, "input.webm");
  const outputPath = path.join(tempDir, "output.ogg");

  try {
    // Write input file
    await writeFile(inputPath, webmBuffer);
    console.log(`[AudioConverter] Input file written: ${inputPath} (${webmBuffer.length} bytes)`);

    // Convert webm → ogg using ffmpeg
    // -c:a libopus = encode with opus codec
    // -b:a 48k = bitrate for voice
    // -ar 48000 = sample rate (opus standard)
    // -ac 1 = mono (voice)
    // -f ogg = output format
    const { stderr } = await execFileAsync(ffmpegPath, [
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

    // Log ffmpeg output for debugging
    if (stderr) {
      const durationMatch = stderr.match(/Duration:\s*(\S+)/);
      const sizeMatch = stderr.match(/size=\s*(\S+)/);
      console.log(`[AudioConverter] ffmpeg duration: ${durationMatch?.[1] || "unknown"}, output size: ${sizeMatch?.[1] || "unknown"}`);
    }

    // Read output file
    const oggBuffer = await readFile(outputPath);

    if (oggBuffer.length === 0) {
      throw new Error("Conversion produced empty output file");
    }

    // Verify OGG magic bytes (OggS)
    if (oggBuffer[0] !== 0x4F || oggBuffer[1] !== 0x67 || oggBuffer[2] !== 0x67 || oggBuffer[3] !== 0x53) {
      throw new Error(`Invalid OGG output: magic bytes are ${oggBuffer.slice(0, 4).toString("hex")} instead of 4f676753`);
    }

    console.log(`[AudioConverter] SUCCESS: webm (${webmBuffer.length} bytes) → ogg (${oggBuffer.length} bytes)`);

    return oggBuffer;
  } catch (err: any) {
    console.error(`[AudioConverter] FAILED to convert webm → ogg:`, err.message);
    throw new Error(`Audio conversion failed: ${err.message}`);
  } finally {
    // Cleanup temp files
    await unlink(inputPath).catch(() => {});
    await unlink(outputPath).catch(() => {});
    await rmdir(tempDir).catch(() => {});
  }
}

/**
 * Check if a mime type needs conversion for WhatsApp
 * Returns true if the format is NOT accepted by WhatsApp
 */
export function needsConversionForWhatsApp(mimeType: string): boolean {
  const baseMime = mimeType.split(";")[0].trim().toLowerCase();
  // WhatsApp accepted audio formats
  const whatsappAccepted = ["audio/aac", "audio/mp4", "audio/mpeg", "audio/amr", "audio/ogg"];
  return !whatsappAccepted.includes(baseMime);
}

/**
 * Check if a mime type is webm (which must NEVER be sent to WhatsApp)
 */
export function isWebmAudio(mimeType: string): boolean {
  const baseMime = mimeType.split(";")[0].trim().toLowerCase();
  return baseMime === "audio/webm";
}

export { isFfmpegAvailable };
