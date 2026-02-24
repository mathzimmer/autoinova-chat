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
// OGG format: sequence of pages, each with a header + segments
// For Opus in OGG: OpusHead page, OpusTags page, then audio data pages

class OggPageBuilder {
  private serialNumber: number;
  private pageSequence: number = 0;
  private granulePosition: bigint = BigInt(0);

  constructor(serialNumber?: number) {
    this.serialNumber = serialNumber ?? Math.floor(Math.random() * 0xFFFFFFFF);
  }

  /**
   * Build an OGG page
   */
  buildPage(data: Buffer, flags: { bos?: boolean; eos?: boolean; granule?: bigint }): Buffer {
    const headerType = (flags.bos ? 0x02 : 0) | (flags.eos ? 0x04 : 0);
    const granule = flags.granule ?? this.granulePosition;

    // Calculate segment table
    const segments: number[] = [];
    let remaining = data.length;
    while (remaining >= 255) {
      segments.push(255);
      remaining -= 255;
    }
    segments.push(remaining);

    const headerSize = 27 + segments.length;
    const page = Buffer.alloc(headerSize + data.length);

    // OGG page header
    page.write("OggS", 0);                              // capture pattern
    page[4] = 0;                                         // version
    page[5] = headerType;                                // header type
    page.writeBigUInt64LE(granule, 6);                   // granule position
    page.writeUInt32LE(this.serialNumber, 14);           // serial number
    page.writeUInt32LE(this.pageSequence++, 18);         // page sequence
    page.writeUInt32LE(0, 22);                           // checksum (filled later)
    page[26] = segments.length;                          // number of segments

    // Segment table
    for (let i = 0; i < segments.length; i++) {
      page[27 + i] = segments[i];
    }

    // Page data
    data.copy(page, headerSize);

    // Calculate CRC32 checksum
    const crc = oggCrc32(page);
    page.writeUInt32LE(crc, 22);

    return page;
  }

  setGranulePosition(pos: bigint) {
    this.granulePosition = pos;
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
 * Build OpusHead header packet
 */
function buildOpusHead(channels: number = 1, sampleRate: number = 48000, preSkip: number = 3840): Buffer {
  const head = Buffer.alloc(19);
  head.write("OpusHead", 0);       // Magic signature
  head[8] = 1;                      // Version
  head[9] = channels;               // Channel count
  head.writeUInt16LE(preSkip, 10);  // Pre-skip
  head.writeUInt32LE(sampleRate, 12); // Input sample rate
  head.writeInt16LE(0, 16);         // Output gain
  head[18] = 0;                     // Channel mapping family
  return head;
}

/**
 * Build OpusTags header packet
 */
function buildOpusTags(): Buffer {
  const vendor = "AutoInovaChat";
  const vendorBuf = Buffer.from(vendor, "utf8");
  const tags = Buffer.alloc(8 + 4 + vendorBuf.length + 4);
  tags.write("OpusTags", 0);
  tags.writeUInt32LE(vendorBuf.length, 8);
  vendorBuf.copy(tags, 12);
  tags.writeUInt32LE(0, 12 + vendorBuf.length); // No user comments
  return tags;
}

/**
 * Extract Opus frames from WebM container using prism-media
 */
async function extractOpusFramesFromWebm(webmBuffer: Buffer): Promise<Buffer[]> {
  return new Promise((resolve, reject) => {
    const frames: Buffer[] = [];
    
    // Use prism-media's WebmDemuxer to extract raw Opus frames
    const demuxer = new prismMedia.opus.WebmDemuxer();

    demuxer.on("data", (chunk: Buffer) => {
      frames.push(Buffer.from(chunk));
    });

    demuxer.on("end", () => {
      resolve(frames);
    });

    demuxer.on("error", (err: Error) => {
      reject(err);
    });

    // Feed the WebM data
    const readable = new Readable({
      read() {
        this.push(webmBuffer);
        this.push(null);
      }
    });

    readable.pipe(demuxer);

    // Timeout after 10 seconds
    setTimeout(() => {
      reject(new Error("WebM demuxing timed out"));
    }, 10000);
  });
}

/**
 * Convert WebM/Opus to OGG/Opus using pure JavaScript (no ffmpeg)
 * 
 * This extracts Opus frames from the WebM container and re-packages them
 * into an OGG container. No re-encoding is needed since both containers
 * use the same Opus codec.
 */
async function convertWebmToOggPureJS(webmBuffer: Buffer): Promise<Buffer> {
  console.log(`[AudioConverter] Pure JS: Extracting Opus frames from WebM (${webmBuffer.length} bytes)`);

  const frames = await extractOpusFramesFromWebm(webmBuffer);
  
  if (frames.length === 0) {
    throw new Error("No Opus frames found in WebM file");
  }

  console.log(`[AudioConverter] Pure JS: Extracted ${frames.length} Opus frames`);

  const ogg = new OggPageBuilder();
  const pages: Buffer[] = [];

  // Page 1: OpusHead (BOS)
  const opusHead = buildOpusHead(1, 48000);
  pages.push(ogg.buildPage(opusHead, { bos: true, granule: BigInt(0) }));

  // Page 2: OpusTags
  const opusTags = buildOpusTags();
  ogg.setGranulePosition(BigInt(0));
  pages.push(ogg.buildPage(opusTags, { granule: BigInt(0) }));

  // Audio pages: pack Opus frames
  // Each Opus frame at 20ms = 960 samples at 48kHz
  const SAMPLES_PER_FRAME = 960;
  let granule = BigInt(0);
  
  // Pack multiple frames per page (up to ~4KB per page is typical)
  let currentPageData: Buffer[] = [];
  let currentPageSize = 0;
  const MAX_PAGE_SIZE = 4000;

  for (let i = 0; i < frames.length; i++) {
    currentPageData.push(frames[i]);
    currentPageSize += frames[i].length;
    granule += BigInt(SAMPLES_PER_FRAME);

    const isLast = i === frames.length - 1;
    
    if (currentPageSize >= MAX_PAGE_SIZE || isLast) {
      // Build a page with all accumulated frames
      // For OGG, each segment in the segment table corresponds to one frame
      // We need to concatenate frames and build proper segment table
      const pageData = Buffer.concat(currentPageData);
      ogg.setGranulePosition(granule);
      pages.push(ogg.buildPage(pageData, { eos: isLast, granule }));
      currentPageData = [];
      currentPageSize = 0;
    }
  }

  const result = Buffer.concat(pages);
  console.log(`[AudioConverter] Pure JS: Created OGG file (${result.length} bytes) with ${frames.length} frames`);
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

  // Method 1: Pure JavaScript (no external dependencies)
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
