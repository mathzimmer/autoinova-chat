import { describe, it, expect } from "vitest";
import { needsConversionForWhatsApp, convertWebmToOgg, isWebmAudio, isFfmpegAvailable } from "./audioConverter";

describe("audioConverter", () => {
  describe("needsConversionForWhatsApp", () => {
    it("should return true for audio/webm", () => {
      expect(needsConversionForWhatsApp("audio/webm")).toBe(true);
    });

    it("should return true for audio/webm;codecs=opus", () => {
      expect(needsConversionForWhatsApp("audio/webm;codecs=opus")).toBe(true);
    });

    it("should return true for audio/wav", () => {
      expect(needsConversionForWhatsApp("audio/wav")).toBe(true);
    });

    it("should return false for audio/ogg", () => {
      expect(needsConversionForWhatsApp("audio/ogg")).toBe(false);
    });

    it("should return false for audio/aac", () => {
      expect(needsConversionForWhatsApp("audio/aac")).toBe(false);
    });

    it("should return false for audio/mp4", () => {
      expect(needsConversionForWhatsApp("audio/mp4")).toBe(false);
    });

    it("should return false for audio/mpeg", () => {
      expect(needsConversionForWhatsApp("audio/mpeg")).toBe(false);
    });

    it("should return false for audio/amr", () => {
      expect(needsConversionForWhatsApp("audio/amr")).toBe(false);
    });

    it("should handle mime type with extra spaces", () => {
      expect(needsConversionForWhatsApp(" audio/ogg ")).toBe(false);
    });

    it("should handle mime type with codec params for accepted formats", () => {
      expect(needsConversionForWhatsApp("audio/ogg; codecs=opus")).toBe(false);
    });
  });

  describe("isWebmAudio", () => {
    it("should return true for audio/webm", () => {
      expect(isWebmAudio("audio/webm")).toBe(true);
    });

    it("should return true for audio/webm;codecs=opus", () => {
      expect(isWebmAudio("audio/webm;codecs=opus")).toBe(true);
    });

    it("should return true for audio/webm with spaces", () => {
      expect(isWebmAudio(" audio/webm ")).toBe(true);
    });

    it("should return false for audio/ogg", () => {
      expect(isWebmAudio("audio/ogg")).toBe(false);
    });

    it("should return false for audio/mp4", () => {
      expect(isWebmAudio("audio/mp4")).toBe(false);
    });

    it("should return false for video/webm", () => {
      expect(isWebmAudio("video/webm")).toBe(false);
    });
  });

  describe("isFfmpegAvailable", () => {
    it("should detect ffmpeg availability", async () => {
      const available = await isFfmpegAvailable();
      expect(typeof available).toBe("boolean");
      // In test environment with ffmpeg-static, should be true
      expect(available).toBe(true);
    }, 10000);
  });

  describe("convertWebmToOgg", () => {
    it("should convert a valid webm buffer to ogg", async () => {
      // Create a minimal valid webm file using ffmpeg
      const { execFile } = await import("child_process");
      const { promisify } = await import("util");
      const { readFile, unlink, mkdtemp } = await import("fs/promises");
      const { tmpdir } = await import("os");
      const path = await import("path");

      const execFileAsync = promisify(execFile);
      const tempDir = await mkdtemp(path.join(tmpdir(), "test-audio-"));
      const testWebmPath = path.join(tempDir, "test.webm");

      try {
        // Generate a short silent webm file using ffmpeg
        const ffmpegPath = require("ffmpeg-static") as string;
        await execFileAsync(ffmpegPath, [
          "-f", "lavfi",
          "-i", "anullsrc=r=48000:cl=mono",
          "-t", "1",
          "-c:a", "libopus",
          "-f", "webm",
          "-y",
          testWebmPath,
        ], { timeout: 10000 });

        const webmBuffer = await readFile(testWebmPath);
        expect(webmBuffer.length).toBeGreaterThan(0);

        // Convert to ogg
        const oggBuffer = await convertWebmToOgg(webmBuffer);
        expect(oggBuffer.length).toBeGreaterThan(0);

        // Check ogg magic bytes: "OggS"
        expect(oggBuffer[0]).toBe(0x4F); // O
        expect(oggBuffer[1]).toBe(0x67); // g
        expect(oggBuffer[2]).toBe(0x67); // g
        expect(oggBuffer[3]).toBe(0x53); // S
      } finally {
        await unlink(testWebmPath).catch(() => {});
        const { rmdir } = await import("fs/promises");
        await rmdir(tempDir).catch(() => {});
      }
    }, 30000);

    it("should throw on invalid input (not silently fail)", async () => {
      const invalidBuffer = Buffer.from("not a valid audio file");
      await expect(convertWebmToOgg(invalidBuffer)).rejects.toThrow("Audio conversion failed");
    }, 15000);

    it("should throw on empty input", async () => {
      const emptyBuffer = Buffer.alloc(0);
      await expect(convertWebmToOgg(emptyBuffer)).rejects.toThrow();
    }, 15000);

    it("should produce valid ogg output that WhatsApp would accept", async () => {
      // Create a webm file and convert it, then verify the output is not webm
      const { execFile } = await import("child_process");
      const { promisify } = await import("util");
      const { readFile, unlink, mkdtemp } = await import("fs/promises");
      const { tmpdir } = await import("os");
      const path = await import("path");

      const execFileAsync = promisify(execFile);
      const tempDir = await mkdtemp(path.join(tmpdir(), "test-audio-"));
      const testWebmPath = path.join(tempDir, "test.webm");

      try {
        const ffmpegPath = require("ffmpeg-static") as string;
        await execFileAsync(ffmpegPath, [
          "-f", "lavfi",
          "-i", "anullsrc=r=48000:cl=mono",
          "-t", "0.5",
          "-c:a", "libopus",
          "-f", "webm",
          "-y",
          testWebmPath,
        ], { timeout: 10000 });

        const webmBuffer = await readFile(testWebmPath);
        const oggBuffer = await convertWebmToOgg(webmBuffer);

        // Verify it's NOT webm (webm starts with 0x1A45DFA3)
        const isNotWebm = !(oggBuffer[0] === 0x1A && oggBuffer[1] === 0x45 && oggBuffer[2] === 0xDF && oggBuffer[3] === 0xA3);
        expect(isNotWebm).toBe(true);

        // Verify it IS ogg
        expect(oggBuffer.slice(0, 4).toString()).toBe("OggS");

        // Verify the output would be accepted by WhatsApp
        expect(needsConversionForWhatsApp("audio/ogg")).toBe(false);
      } finally {
        await unlink(testWebmPath).catch(() => {});
        const { rmdir } = await import("fs/promises");
        await rmdir(tempDir).catch(() => {});
      }
    }, 30000);
  });
});
