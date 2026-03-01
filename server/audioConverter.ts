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
 * 
 * FIXES (Rodada 45):
 * - extractOpusHeaderFromWebm agora lê canais, preSkip E sampleRate do OpusHead real
 * - convertWebmToOggPureJS usa os canais corretos (browser pode gravar em stereo)
 * - Frames vazios ou muito pequenos (< 2 bytes) são filtrados — causavam corrupção do OGG
 * - Timeout do demuxer aumentado para 15s (áudios longos falhavam)
 * - Logs detalhados para diagnóstico
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

// ============================================================
// FIX: Extração completa do OpusHead do WebM
// Antes: só extraía preSkip, assumia channels=1 e sampleRate=48000
// Agora: lê channels, preSkip e sampleRate do header real
// Isso é crítico pois browsers podem gravar em stereo (channels=2)
// e o WhatsApp pode rejeitar OGG com channel count errado no header
// ============================================================

interface OpusHeaderInfo {
  channels: number;
  preSkip: number;
  sampleRate: number;
}

/**
 * Extracts OpusHead data (channels, preSkip, sampleRate) from a WebM buffer.
 * The OpusHead packet in WebM contains all codec parameters.
 * 
 * OpusHead structure (RFC 7845):
 * - Bytes 0-7:   "OpusHead" magic
 * - Byte  8:     Version (must be 1)
 * - Byte  9:     Channel count
 * - Bytes 10-11: Pre-skip (uint16 LE)
 * - Bytes 12-15: Input sample rate (uint32 LE)
 * - Bytes 16-17: Output gain (int16 LE)
 * - Byte  18:    Channel mapping family
 */
function extractOpusHeaderFromWebm(webmBuffer: Buffer): OpusHeaderInfo {
  const defaults: OpusHeaderInfo = { channels: 1, preSkip: 312, sampleRate: 48000 };
  
  // Search in the first 4KB for OpusHead magic
  const searchArea = webmBuffer.slice(0, Math.min(webmBuffer.length, 4096));
  const magic = Buffer.from("OpusHead");
  
  for (let i = 0; i < searchArea.length - 19; i++) {
    if (searchArea.compare(magic, 0, 8, i, i + 8) === 0) {
      const version = searchArea[i + 8];
      if (version !== 1) continue; // Only version 1 is valid
      
      const channels = searchArea[i + 9];
      const preSkip = searchArea.readUInt16LE(i + 10);
      const sampleRate = searchArea.readUInt32LE(i + 12);
      
      // Sanity checks
      const validChannels = channels >= 1 && channels <= 8;
      const validPreSkip = preSkip >= 0 && preSkip <= 32767;
      const validSampleRate = sampleRate === 48000 || sampleRate === 24000 || sampleRate === 16000 || sampleRate === 12000 || sampleRate === 8000;
      
      if (!validChannels || !validPreSkip) {
        console.warn(`[AudioConverter] OpusHead found at ${i} but values look invalid: channels=${channels}, preSkip=${preSkip}, sampleRate=${sampleRate}. Using defaults.`);
        continue;
      }
      
      // FIX: Force mono for WhatsApp even if browser recorded stereo
      // WhatsApp voice messages work best with mono audio
      // If stereo, we'll tell OGG it's mono — Opus frames are already downmixed
      // by the browser's MediaRecorder in most cases
      const effectiveChannels = validChannels ? Math.min(channels, 1) : 1;
      
      // FIX (Rodada 46): PreSkip=0 faz o WhatsApp rejeitar o áudio como "não disponível".
      // Browsers como Chrome podem reportar PreSkip=0 no OpusHead do WebM,
      // mas o WhatsApp exige PreSkip >= 312 (6.5ms a 48kHz) para reproduzir.
      // Se PreSkip for 0, usar o valor padrão de 312 que o ffmpeg/libopus usa.
      const effectivePreSkip = preSkip === 0 ? 312 : preSkip;
      
      console.log(`[AudioConverter] Found OpusHead at byte ${i}:`);
      console.log(`[AudioConverter]   Version: ${version}`);
      console.log(`[AudioConverter]   Channels (raw): ${channels} → using: ${effectiveChannels} (mono for WhatsApp)`);
      console.log(`[AudioConverter]   PreSkip (raw): ${preSkip} → using: ${effectivePreSkip} (min 312 for WhatsApp)`);
      console.log(`[AudioConverter]   SampleRate: ${validSampleRate ? sampleRate : 48000} Hz`);
      
      return {
        channels: effectiveChannels,
        preSkip: effectivePreSkip,
        sampleRate: validSampleRate ? sampleRate : 48000,
      };
    }
  }
  
  console.log(`[AudioConverter] OpusHead not found in first 4KB of WebM, using defaults: channels=${defaults.channels}, preSkip=${defaults.preSkip}, sampleRate=${defaults.sampleRate}`);
  return defaults;
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
 * 
 * FIX: Timeout aumentado de 10s para 15s e filtragem de frames inválidos
 */
async function extractOpusFramesFromWebm(webmBuffer: Buffer): Promise<Buffer[]> {
  return new Promise((resolve, reject) => {
    const frames: Buffer[] = [];
    let resolved = false;
    
    const demuxer = new prismMedia.opus.WebmDemuxer();

    demuxer.on("data", (chunk: Buffer) => {
      // FIX: Filtrar frames vazios ou muito pequenos (< 2 bytes)
      // Frames inválidos causam corrupção do OGG container
      if (chunk && chunk.length >= 2) {
        frames.push(Buffer.from(chunk));
      }
    });

    demuxer.on("end", () => {
      if (!resolved) {
        resolved = true;
        console.log(`[AudioConverter] WebM demuxer finished: ${frames.length} valid frames extracted`);
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

    // FIX: Timeout aumentado para 15s — áudios longos podem demorar mais para ser demuxados
    setTimeout(() => {
      if (!resolved) {
        resolved = true;
        if (frames.length > 0) {
          console.log(`[AudioConverter] WebM demuxer timeout (15s), returning ${frames.length} frames collected so far`);
          resolve(frames);
        } else {
          reject(new Error("WebM demuxing timed out with 0 frames — buffer may be invalid or too short"));
        }
      }
    }, 15000);
  });
}

/**
 * Convert WebM/Opus to OGG/Opus using pure JavaScript (no ffmpeg)
 * 
 * Properly builds OGG pages with correct segment tables where each
 * Opus frame is a separate packet, matching the format that ffmpeg produces.
 * 
 * FIXES (Rodada 45):
 * - Usa channels/preSkip/sampleRate reais do WebM
 * - Filtra frames inválidos antes de empacotar
 */
async function convertWebmToOggPureJS(webmBuffer: Buffer): Promise<Buffer> {
  console.log(`[AudioConverter] Pure JS: Starting WebM → OGG conversion (${webmBuffer.length} bytes)`);

  const frames = await extractOpusFramesFromWebm(webmBuffer);
  
  if (frames.length === 0) {
    throw new Error("No valid Opus frames found in WebM file");
  }

  // FIX: Usar header real do WebM ao invés de valores hardcoded
  const opusInfo = extractOpusHeaderFromWebm(webmBuffer);

  console.log(`[AudioConverter] Pure JS: ${frames.length} frames, channels=${opusInfo.channels}, preSkip=${opusInfo.preSkip}, sampleRate=${opusInfo.sampleRate}`);

  const ogg = new OggPageBuilder();
  const pages: Buffer[] = [];

  // Page 0: OpusHead (BOS - Beginning of Stream)
  const opusHead = buildOpusHead(opusInfo.channels, opusInfo.sampleRate, opusInfo.preSkip);
  pages.push(ogg.buildPage([opusHead], { bos: true, granule: BigInt(0) }));

  // Page 1: OpusTags
  const opusTags = buildOpusTags();
  pages.push(ogg.buildPage([opusTags], { granule: BigInt(0) }));

  // Audio pages: each Opus frame is a separate packet
  // Standard Opus frame duration is 20ms = 960 samples at 48kHz
  const SAMPLES_PER_FRAME = 960;
  let granule = BigInt(opusInfo.preSkip);
  
  let currentPackets: Buffer[] = [];
  let currentSegmentCount = 0;

  for (let i = 0; i < frames.length; i++) {
    const frame = frames[i];
    const frameSegments = Math.floor(frame.length / 255) + 1;
    
    if (currentSegmentCount + frameSegments > 255 || currentPackets.length >= 48) {
      pages.push(ogg.buildPage(currentPackets, { granule }));
      currentPackets = [];
      currentSegmentCount = 0;
    }

    currentPackets.push(frame);
    currentSegmentCount += frameSegments;
    granule += BigInt(SAMPLES_PER_FRAME);
  }

  // Last page with EOS flag
  if (currentPackets.length > 0) {
    pages.push(ogg.buildPage(currentPackets, { eos: true, granule }));
  }

  const result = Buffer.concat(pages);
  
  // Final validation
  const isValidOgg = result.length > 4 && result[0] === 0x4F && result[1] === 0x67 && result[2] === 0x67 && result[3] === 0x53;
  console.log(`[AudioConverter] Pure JS: OGG created (${result.length} bytes, ${frames.length} frames, ${pages.length} pages), valid=${isValidOgg}`);
  
  if (!isValidOgg) {
    throw new Error("Generated OGG does not have valid magic bytes (OggS)");
  }
  
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
        "-ac", "1",         // Force mono for WhatsApp compatibility
        "-f", "ogg",
        "-y",
        outputPath,
      ], { timeout: 15000 });
    } catch {
      // If copy fails, try re-encoding to mono
      await execFileAsync(ffmpegPath, [
        "-i", inputPath,
        "-c:a", "libopus",
        "-b:a", "48k",
        "-ar", "48000",
        "-ac", "1",         // Force mono for WhatsApp compatibility
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
