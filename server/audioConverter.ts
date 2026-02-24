/**
 * Audio Converter - Converts audio/webm (opus) to audio/ogg (opus)
 * 
 * WhatsApp accepts: audio/aac, audio/mp4, audio/mpeg, audio/amr, audio/ogg
 * Browser MediaRecorder produces: audio/webm;codecs=opus
 * 
 * RULE: NEVER send webm to WhatsApp. Always convert first.
 * If conversion fails, the audio is NOT sent to WhatsApp.
 * 
 * Strategy:
 * 1. Primary: Use prism-media WebmDemuxer to extract Opus frames, then
 *    package them into an OGG container using pure JavaScript (no ffmpeg needed)
 * 2. Fallback: Use ffmpeg (if available) for conversion
 */

import { execFile } from "child_process";
import { promisify } from "util";
import { writeFile, readFile, unlink, mkdtemp, rmdir } from "fs/promises";
import { tmpdir } from "os";
import path from "path";
import { Readable } from "stream";
import prismMedia from "prism-media";

const execFileAsync = promisify(execFile);

// ============================================================
// OGG Container Builder (Pure JavaScript)
// ============================================================
// OGG format specification: https://www.xiph.org/ogg/doc/rfc3533.txt
// Opus in OGG: https://tools.ietf.org/html/rfc7845
//
// Key insight: In OGG, each Opus frame is a separate "packet".
// The segment table must encode each packet individually:
// - Packets < 255 bytes: single segment entry with the packet size
// - Packets >= 255 bytes: multiple 255-byte segments + final remainder segment
// - A segment of exactly 255 means "packet continues in next segment"
// - A segment < 255 (including 0) terminates the packet

class OggPageBuilder {
  private serialNumber: number;
  private pageSequence: number = 0;

  constructor(serialNumber?: number) {
    this.serialNumber = serialNumber ?? Math.floor(Math.random() * 0xFFFFFFFF);
  }

  /**
   * Build an OGG page containing one or more complete packets.
   * Each packet is encoded separately in the segment table.
   */
  buildPage(packets: Buffer[], flags: { bos?: boolean; eos?: boolean; granule: bigint }): Buffer {
    const headerType = (flags.bos ? 0x02 : 0) | (flags.eos ? 0x04 : 0);

    // Build segment table: each packet gets its own segments
    const segments: number[] = [];
    for (const packet of packets) {
      let remaining = packet.length;
      while (remaining >= 255) {
        segments.push(255);
        remaining -= 255;
      }
      // Terminal segment (< 255) marks end of packet
      segments.push(remaining);
    }

    if (segments.length > 255) {
      // OGG page can have at most 255 segments
      // This shouldn't happen with normal audio but let's be safe
      throw new Error(`Too many segments (${segments.length}) for a single OGG page`);
    }

    const totalDataSize = packets.reduce((sum, p) => sum + p.length, 0);
    const headerSize = 27 + segments.length;
    const page = Buffer.alloc(headerSize + totalDataSize);

    // OGG page header (27 bytes fixed)
    page.write("OggS", 0);                              // capture pattern
    page[4] = 0;                                         // stream structure version
    page[5] = headerType;                                // header type flag
    page.writeBigUInt64LE(flags.granule, 6);             // granule position (absolute)
    page.writeUInt32LE(this.serialNumber, 14);           // bitstream serial number
    page.writeUInt32LE(this.pageSequence++, 18);         // page sequence number
    page.writeUInt32LE(0, 22);                           // CRC checksum (filled later)
    page[26] = segments.length;                          // number of page segments

    // Segment table
    for (let i = 0; i < segments.length; i++) {
      page[27 + i] = segments[i];
    }

    // Page body: concatenate all packets
    let offset = headerSize;
    for (const packet of packets) {
      packet.copy(page, offset);
      offset += packet.length;
    }

    // Calculate and write CRC32 checksum
    const crc = oggCrc32(page);
    page.writeUInt32LE(crc, 22);

    return page;
  }
}

/**
 * OGG CRC32 lookup table and function
 * Uses the polynomial 0x04C11DB7 (standard OGG CRC)
 */
const oggCrcTable: number[] = [];
for (let i = 0; i < 256; i++) {
  let r = i << 24;
  for (let j = 0; j < 8; j++) {
    r = (r & 0x80000000) ? ((r << 1) ^ 0x04C11DB7) : (r << 1);
  }
  oggCrcTable[i] = r >>> 0;
}

function oggCrc32(data: Buffer): number {
  let crc = 0;
  for (let i = 0; i < data.length; i++) {
    crc = ((crc << 8) ^ oggCrcTable[((crc >>> 24) ^ data[i]) & 0xFF]) >>> 0;
  }
  return crc >>> 0;
}

/**
 * Extract the Opus CodecPrivate (OpusHead) from a WebM buffer.
 * The CodecPrivate in WebM for Opus contains the OpusHead data.
 * We try to find it by looking for the OpusHead magic in the WebM header area.
 */
function extractPreSkipFromWebm(webmBuffer: Buffer): number {
  // Look for "OpusHead" in the first 1000 bytes of the WebM
  const searchArea = webmBuffer.slice(0, Math.min(webmBuffer.length, 2000));
  const magic = Buffer.from("OpusHead");
  
  for (let i = 0; i < searchArea.length - 19; i++) {
    if (searchArea.compare(magic, 0, 8, i, i + 8) === 0) {
      // Found OpusHead at position i
      const preSkip = searchArea.readUInt16LE(i + 10);
      const sampleRate = searchArea.readUInt32LE(i + 12);
      const channels = searchArea[i + 9];
      console.log(`[AudioConverter] Found OpusHead in WebM: channels=${channels}, preSkip=${preSkip}, sampleRate=${sampleRate}`);
      return preSkip;
    }
  }
  
  // Default pre-skip for Opus (312 samples = 6.5ms at 48kHz is common)
  console.log("[AudioConverter] OpusHead not found in WebM, using default preSkip=312");
  return 312;
}

/**
 * Build OpusHead header packet (RFC 7845 Section 5.1)
 */
function buildOpusHead(channels: number = 1, sampleRate: number = 48000, preSkip: number = 312): Buffer {
  const head = Buffer.alloc(19);
  head.write("OpusHead", 0);       // Magic signature (8 bytes)
  head[8] = 1;                      // Version (must be 1)
  head[9] = channels;               // Output channel count
  head.writeUInt16LE(preSkip, 10);  // Pre-skip (samples at 48kHz)
  head.writeUInt32LE(sampleRate, 12); // Input sample rate (informational)
  head.writeInt16LE(0, 16);         // Output gain (Q7.8 in dB, 0 = no change)
  head[18] = 0;                     // Channel mapping family (0 = mono/stereo)
  return head;
}

/**
 * Build OpusTags header packet (RFC 7845 Section 5.2)
 */
function buildOpusTags(): Buffer {
  const vendor = "Lavf61.1.100"; // Mimic ffmpeg vendor string for compatibility
  const vendorBuf = Buffer.from(vendor, "utf8");
  const tags = Buffer.alloc(8 + 4 + vendorBuf.length + 4);
  tags.write("OpusTags", 0);                        // Magic signature (8 bytes)
  tags.writeUInt32LE(vendorBuf.length, 8);           // Vendor string length
  vendorBuf.copy(tags, 12);                          // Vendor string
  tags.writeUInt32LE(0, 12 + vendorBuf.length);      // User comment list length (0)
  return tags;
}

/**
 * Extract Opus frames from WebM container using prism-media
 */
async function extractOpusFramesFromWebm(webmBuffer: Buffer): Promise<Buffer[]> {
  return new Promise((resolve, reject) => {
    const frames: Buffer[] = [];
    let resolved = false;
    
    const demuxer = new prismMedia.opus.WebmDemuxer();

    demuxer.on("data", (chunk: Buffer) => {
      frames.push(Buffer.from(chunk));
    });

    demuxer.on("end", () => {
      if (!resolved) {
        resolved = true;
        resolve(frames);
      }
    });

    demuxer.on("error", (err: Error) => {
      if (!resolved) {
        resolved = true;
        reject(err);
      }
    });

    const readable = new Readable({
      read() {
        this.push(webmBuffer);
        this.push(null);
      }
    });

    readable.pipe(demuxer);

    setTimeout(() => {
      if (!resolved) {
        resolved = true;
        if (frames.length > 0) {
          resolve(frames); // Return what we have
        } else {
          reject(new Error("WebM demuxing timed out"));
        }
      }
    }, 10000);
  });
}

/**
 * Convert WebM/Opus to OGG/Opus using pure JavaScript (no ffmpeg)
 * 
 * Properly builds OGG pages with correct segment tables where each
 * Opus frame is a separate packet, matching the format that ffmpeg produces.
 */
async function convertWebmToOggPureJS(webmBuffer: Buffer): Promise<Buffer> {
  console.log(`[AudioConverter] Pure JS: Extracting Opus frames from WebM (${webmBuffer.length} bytes)`);

  const frames = await extractOpusFramesFromWebm(webmBuffer);
  
  if (frames.length === 0) {
    throw new Error("No Opus frames found in WebM file");
  }

  // Extract pre-skip from the original WebM's OpusHead
  const preSkip = extractPreSkipFromWebm(webmBuffer);

  console.log(`[AudioConverter] Pure JS: Extracted ${frames.length} Opus frames, preSkip=${preSkip}`);

  const ogg = new OggPageBuilder();
  const pages: Buffer[] = [];

  // Page 0: OpusHead (BOS - Beginning of Stream)
  // Must be on its own page with BOS flag
  const opusHead = buildOpusHead(1, 48000, preSkip);
  pages.push(ogg.buildPage([opusHead], { bos: true, granule: BigInt(0) }));

  // Page 1: OpusTags
  // Must be on its own page
  const opusTags = buildOpusTags();
  pages.push(ogg.buildPage([opusTags], { granule: BigInt(0) }));

  // Audio pages: each Opus frame is a separate packet
  // Standard Opus frame duration is 20ms = 960 samples at 48kHz
  const SAMPLES_PER_FRAME = 960;
  let granule = BigInt(preSkip); // Start from preSkip offset
  
  // Pack frames into pages, keeping each frame as a separate packet
  // OGG allows up to 255 segments per page
  // Each frame typically needs 1 segment (if < 255 bytes) or 2+ segments
  let currentPackets: Buffer[] = [];
  let currentSegmentCount = 0;

  for (let i = 0; i < frames.length; i++) {
    const frame = frames[i];
    // Calculate how many segments this frame needs
    const frameSegments = Math.floor(frame.length / 255) + 1;
    
    // Check if adding this frame would exceed 255 segments per page
    if (currentSegmentCount + frameSegments > 255 || currentPackets.length >= 48) {
      // Flush current page
      pages.push(ogg.buildPage(currentPackets, { granule }));
      currentPackets = [];
      currentSegmentCount = 0;
    }

    currentPackets.push(frame);
    currentSegmentCount += frameSegments;
    granule += BigInt(SAMPLES_PER_FRAME);
  }

  // Flush remaining packets as the last page (with EOS flag)
  if (currentPackets.length > 0) {
    pages.push(ogg.buildPage(currentPackets, { eos: true, granule }));
  }

  const result = Buffer.concat(pages);
  console.log(`[AudioConverter] Pure JS: Created OGG file (${result.length} bytes) with ${frames.length} frames across ${pages.length} pages`);
  return result;
}

// ============================================================
// FFmpeg-based conversion (fallback)
// ============================================================

function getFfmpegPath(): string {
  try {
    const ffmpegPath = require("ffmpeg-static") as string | null;
    if (ffmpegPath) return ffmpegPath;
  } catch {
    // Not available
  }
  return "ffmpeg";
}

let cachedFfmpegPath: string | null = null;
function getOrCacheFfmpegPath(): string {
  if (!cachedFfmpegPath) cachedFfmpegPath = getFfmpegPath();
  return cachedFfmpegPath;
}

async function isFfmpegAvailable(): Promise<boolean> {
  const ffmpegPath = getOrCacheFfmpegPath();
  try {
    await execFileAsync(ffmpegPath, ["-version"], { timeout: 5000 });
    return true;
  } catch {
    return false;
  }
}

async function convertWebmToOggFfmpeg(webmBuffer: Buffer): Promise<Buffer> {
  const ffmpegPath = getOrCacheFfmpegPath();
  const tempDir = await mkdtemp(path.join(tmpdir(), "audio-convert-"));
  const inputPath = path.join(tempDir, "input.webm");
  const outputPath = path.join(tempDir, "output.ogg");

  try {
    await writeFile(inputPath, webmBuffer);

    // Try copy first (just remux, no re-encoding — instant)
    try {
      await execFileAsync(ffmpegPath, [
        "-i", inputPath,
        "-c:a", "copy",
        "-f", "ogg",
        "-y",
        outputPath,
      ], { timeout: 15000 });
    } catch {
      // If copy fails, try re-encoding
      await execFileAsync(ffmpegPath, [
        "-i", inputPath,
        "-c:a", "libopus",
        "-b:a", "48k",
        "-ar", "48000",
        "-ac", "1",
        "-f", "ogg",
        "-y",
        outputPath,
      ], { timeout: 30000 });
    }

    const oggBuffer = await readFile(outputPath);
    if (oggBuffer.length === 0) throw new Error("FFmpeg produced empty output");
    return oggBuffer;
  } finally {
    await unlink(inputPath).catch(() => {});
    await unlink(outputPath).catch(() => {});
    await rmdir(tempDir).catch(() => {});
  }
}

// ============================================================
// Public API
// ============================================================

/**
 * Convert a webm audio buffer to ogg format (opus codec)
 * 
 * Strategy:
 * 1. Try pure JavaScript conversion (prism-media demux + OGG mux)
 * 2. If that fails, try ffmpeg conversion
 * 3. If both fail, throw error (caller must NOT send webm to WhatsApp)
 */
export async function convertWebmToOgg(webmBuffer: Buffer): Promise<Buffer> {
  console.log(`[AudioConverter] Starting conversion: webm (${webmBuffer.length} bytes) → ogg`);

  // Method 1: Pure JavaScript (no external dependencies needed at deploy)
  try {
    const oggBuffer = await convertWebmToOggPureJS(webmBuffer);
    
    // Verify OGG magic bytes
    if (oggBuffer.length > 4 && oggBuffer[0] === 0x4F && oggBuffer[1] === 0x67 && oggBuffer[2] === 0x67 && oggBuffer[3] === 0x53) {
      console.log(`[AudioConverter] SUCCESS (Pure JS): webm (${webmBuffer.length} bytes) → ogg (${oggBuffer.length} bytes)`);
      return oggBuffer;
    }
    console.warn("[AudioConverter] Pure JS output doesn't have OGG magic bytes, trying ffmpeg...");
  } catch (err: any) {
    console.warn(`[AudioConverter] Pure JS conversion failed: ${err.message}, trying ffmpeg...`);
  }

  // Method 2: FFmpeg fallback
  try {
    const ffmpegAvailable = await isFfmpegAvailable();
    if (ffmpegAvailable) {
      const oggBuffer = await convertWebmToOggFfmpeg(webmBuffer);
      
      if (oggBuffer.length > 4 && oggBuffer[0] === 0x4F && oggBuffer[1] === 0x67 && oggBuffer[2] === 0x67 && oggBuffer[3] === 0x53) {
        console.log(`[AudioConverter] SUCCESS (FFmpeg): webm (${webmBuffer.length} bytes) → ogg (${oggBuffer.length} bytes)`);
        return oggBuffer;
      }
      console.error("[AudioConverter] FFmpeg output doesn't have OGG magic bytes");
    } else {
      console.error("[AudioConverter] FFmpeg not available");
    }
  } catch (err: any) {
    console.error(`[AudioConverter] FFmpeg conversion also failed: ${err.message}`);
  }

  throw new Error("Audio conversion failed: both Pure JS and FFmpeg methods failed. Audio will NOT be sent to WhatsApp.");
}

/**
 * Check if a mime type needs conversion for WhatsApp
 */
export function needsConversionForWhatsApp(mimeType: string): boolean {
  const baseMime = mimeType.split(";")[0].trim().toLowerCase();
  const whatsappAccepted = ["audio/aac", "audio/mp4", "audio/mpeg", "audio/amr", "audio/ogg"];
  return !whatsappAccepted.includes(baseMime);
}

/**
 * Check if a mime type is webm
 */
export function isWebmAudio(mimeType: string): boolean {
  const baseMime = mimeType.split(";")[0].trim().toLowerCase();
  return baseMime === "audio/webm";
}

export { isFfmpegAvailable };
