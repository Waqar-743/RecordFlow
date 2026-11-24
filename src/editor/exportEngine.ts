import { ArrayBufferTarget as Mp4Target, Muxer as Mp4Muxer } from "mp4-muxer";
import { ArrayBufferTarget as WebmTarget, Muxer as WebmMuxer } from "webm-muxer";
import {
  getAspectDimensions,
  renderCompositionFrame,
  type RenderSources,
  type VideoDrawableSource,
} from "./canvasRenderer";
import { parseMp4VideoTrack, type Mp4VideoTrackInfo } from "./mp4Demuxer";
import type {
  EditorProject,
  ExportOptions,
  ExportProgress,
  ExportQuality,
  ExportResolution,
} from "../types";

const RESOLUTION_LONG_SIDE: Record<ExportResolution, number> = {
  "4k": 3840,
  "1440p": 2560,
  "1080p": 1920,
  "720p": 1280,
};

const QUALITY_BITRATE_MULTIPLIER: Record<ExportQuality, number> = {
  best: 1.45,
  high: 1.0,
  small: 0.52,
};

export function getExportOutputSpecs(project: EditorProject, options: ExportOptions) {
  const longSide = RESOLUTION_LONG_SIDE[options.resolution];
  const { width, height } = getAspectDimensions(
    project.canvas.aspectRatio,
    project.sourceWidth,
    project.sourceHeight,
    longSide,
  );
  const baseMbps =
    options.resolution === "4k"
      ? 24
      : options.resolution === "1440p"
        ? 14
        : options.resolution === "1080p"
          ? 8
          : 4.5;
  const fpsFactor = options.fps === 60 ? 1.35 : 1.0;
  const bitrateBps = Math.round(
    baseMbps * 1_000_000 * fpsFactor * QUALITY_BITRATE_MULTIPLIER[options.quality],
  );
  const trimmedDuration = Math.max(0.25, project.trimEnd - project.trimStart);
  const estimatedBytes = Math.round(((bitrateBps + 128_000) / 8) * trimmedDuration);
  return { width, height, bitrateBps, trimmedDuration, estimatedBytes };
}

/**
 * Mount a tiny nearly-invisible container in the live DOM so Chromium/WebView2 never
 * throttles or skips video frame texture uploads for offscreen `<video>` elements.
 */
function createHiddenVideoHost(): HTMLDivElement | null {
  if (typeof document === "undefined" || !document.body) return null;
  const host = document.createElement("div");
  host.setAttribute("aria-hidden", "true");
  host.style.cssText =
    "position:fixed;left:0;top:0;width:2px;height:2px;opacity:0.001;pointer-events:none;overflow:hidden;z-index:-1;";
  document.body.appendChild(host);
  return host;
}

function loadVideoElement(url: string, host: HTMLElement | null): Promise<HTMLVideoElement> {
  return new Promise((resolve, reject) => {
    const v = document.createElement("video");
    v.crossOrigin = "anonymous";
    v.muted = true;
    v.playsInline = true;
    v.preload = "auto";
    v.style.cssText = "width:2px;height:2px;display:block;";
    if (host) host.appendChild(v);
    v.onloadeddata = () => resolve(v);
    v.onerror = () => reject(new Error("Could not load video track for export."));
    v.src = url;
    v.load();
  });
}

function loadImageElement(url: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = url;
  });
}

function seekVideoExact(video: HTMLVideoElement, timeSec: number, tolerance = 0.002): Promise<void> {
  return new Promise((resolve) => {
    const maxDur = Number.isFinite(video.duration) ? Math.max(0, video.duration - 0.001) : timeSec;
    const clamped = Math.max(0, Math.min(maxDur, timeSec));
    if (!video.paused) {
      video.pause();
    }
    if (Math.abs(video.currentTime - clamped) <= tolerance && video.readyState >= 2) {
      resolve();
      return;
    }
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      video.removeEventListener("seeked", onSeeked);
      resolve();
    };
    const onSeeked = () => {
      // Wait one animation frame when visible so Chromium finishes uploading the sought frame texture
      if (typeof window.requestAnimationFrame === "function" && !document.hidden) {
        window.requestAnimationFrame(() => finish());
      } else {
        finish();
      }
    };
    const timer = window.setTimeout(finish, 900);
    video.addEventListener("seeked", onSeeked, { once: true });
    video.currentTime = clamped;
  });
}

interface FrameSource {
  getFrameAtTime(timeSec: number): Promise<VideoDrawableSource | null>;
  dispose(): void;
}

/**
 * Hardware-accelerated WebCodecs `VideoDecoder` frame stream backed by our MP4 demuxer.
 * Decodes every compressed sample sequentially in exact presentation order with zero
 * `HTMLVideoElement` compositor throttling, zero playback-rate frame dropping, and
 * frame-accurate synchronization for smooth UI animations and cursor/zoom motion.
 */
class Mp4VideoFrameStream implements FrameSource {
  private readonly buffer: Uint8Array;
  private readonly track: Mp4VideoTrackInfo;
  private readonly decoder: VideoDecoder;
  private nextSampleIdx: number;
  private currentFrame: VideoFrame | null = null;
  private decodedQueue: VideoFrame[] = [];
  private outputWaiters: Array<() => void> = [];
  private error: Error | null = null;
  private flushing = false;
  private eofFlushed = false;
  private disposed = false;

  private constructor(
    buffer: ArrayBuffer,
    track: Mp4VideoTrackInfo,
    config: VideoDecoderConfig,
    startSampleIdx: number,
  ) {
    this.buffer = new Uint8Array(buffer);
    this.track = track;
    this.nextSampleIdx = startSampleIdx;

    this.decoder = new VideoDecoder({
      output: (frame) => {
        if (this.disposed) {
          frame.close();
          return;
        }
        // Insert sorted by presentation timestamp in case of out-of-order delivery
        const ts = frame.timestamp;
        if (
          this.decodedQueue.length === 0 ||
          this.decodedQueue[this.decodedQueue.length - 1].timestamp <= ts
        ) {
          this.decodedQueue.push(frame);
        } else {
          let idx = this.decodedQueue.length - 1;
          while (idx > 0 && this.decodedQueue[idx - 1].timestamp > ts) idx--;
          this.decodedQueue.splice(idx, 0, frame);
        }
        this.notifyOutput();
      },
      error: (err) => {
        this.error = err instanceof Error ? err : new Error(String(err));
        this.notifyOutput();
      },
    });

    this.decoder.configure(config);
  }

  static async create(
    arrayBuffer: ArrayBuffer,
    trimStartSec: number,
  ): Promise<Mp4VideoFrameStream | null> {
    if (typeof VideoDecoder === "undefined" || typeof EncodedVideoChunk === "undefined") {
      return null;
    }

    const track = parseMp4VideoTrack(arrayBuffer);
    if (!track || track.samples.length === 0) return null;

    const baseConfig: VideoDecoderConfig = {
      codec: track.codec,
      codedWidth: track.codedWidth,
      codedHeight: track.codedHeight,
      description: track.description,
      optimizeForLatency: false,
    };

    let selectedConfig: VideoDecoderConfig | null = null;
    for (const hw of ["prefer-hardware", "no-preference"] as const) {
      try {
        const cfg: VideoDecoderConfig = { ...baseConfig, hardwareAcceleration: hw };
        const sup = await VideoDecoder.isConfigSupported(cfg);
        if (sup.supported) {
          selectedConfig = sup.config ?? cfg;
          break;
        }
      } catch {
        /* try next hardware preference */
      }
    }
    if (!selectedConfig) return null;

    // Jump straight to the nearest keyframe at or before trimStartSec
    const startUs = Math.max(0, Math.round(trimStartSec * 1_000_000));
    let startSampleIdx = 0;
    for (let i = 0; i < track.samples.length; i++) {
      const s = track.samples[i];
      if (s.isKey) {
        if (s.ptsUs <= startUs + 50_000) {
          startSampleIdx = i;
        } else {
          break;
        }
      }
    }

    const stream = new Mp4VideoFrameStream(arrayBuffer, track, selectedConfig, startSampleIdx);
    // Warm up and verify the first frame decodes cleanly before committing to WebCodecs decode
    try {
      const first = await stream.getFrameAtTime(trimStartSec);
      if (!first) {
        stream.dispose();
        return null;
      }
      return stream;
    } catch {
      stream.dispose();
      return null;
    }
  }

  private notifyOutput() {
    if (this.outputWaiters.length === 0) return;
    const waiters = this.outputWaiters;
    this.outputWaiters = [];
    for (const wake of waiters) wake();
  }

  private waitForOutput(timeoutMs = 5000): Promise<void> {
    if (this.error || this.disposed) return Promise.resolve();
    return new Promise((resolve, reject) => {
      let done = false;
      const wake = () => {
        if (done) return;
        done = true;
        window.clearTimeout(timer);
        resolve();
      };
      const timer = window.setTimeout(() => {
        if (done) return;
        done = true;
        const i = this.outputWaiters.indexOf(wake);
        if (i >= 0) this.outputWaiters.splice(i, 1);
        reject(new Error("VideoDecoder timed out waiting for decoded frame."));
      }, timeoutMs);
      this.outputWaiters.push(wake);
    });
  }

  private feedNextSample() {
    if (this.nextSampleIdx >= this.track.samples.length) return;
    const sample = this.track.samples[this.nextSampleIdx++];
    const chunkData = this.buffer.subarray(sample.offset, sample.offset + sample.size);
    const chunk = new EncodedVideoChunk({
      type: sample.isKey ? "key" : "delta",
      timestamp: sample.ptsUs,
      duration: sample.durationUs,
      data: chunkData,
    });
    this.decoder.decode(chunk);
  }

  private advanceCurrentTo(targetUs: number) {
    // 1.5ms epsilon absorbs rounding between 1/fps and MP4 timescale ticks
    const eps = 1500;
    while (this.decodedQueue.length > 0 && this.decodedQueue[0].timestamp <= targetUs + eps) {
      const next = this.decodedQueue.shift()!;
      this.currentFrame?.close();
      this.currentFrame = next;
    }
  }

  private hasFrameAfter(targetUs: number): boolean {
    const eps = 1500;
    return this.decodedQueue.length > 0 && this.decodedQueue[0].timestamp > targetUs + eps;
  }

  async getFrameAtTime(timeSec: number): Promise<VideoFrame | null> {
    if (this.disposed) return null;
    if (this.error) throw this.error;

    const targetUs = Math.max(0, Math.round(timeSec * 1_000_000));
    this.advanceCurrentTo(targetUs);

    while (!this.eofFlushed && !this.hasFrameAfter(targetUs)) {
      if (this.error) throw this.error;

      if (this.nextSampleIdx < this.track.samples.length) {
        // Feed compressed samples while keeping decoder queue bounded
        let fed = 0;
        while (
          this.nextSampleIdx < this.track.samples.length &&
          this.decoder.decodeQueueSize < 8 &&
          this.decodedQueue.length < 10 &&
          fed < 8
        ) {
          this.feedNextSample();
          fed++;
        }
        // Yield briefly if we hit EOF so we flush all remaining buffered/B-frames
        if (this.nextSampleIdx >= this.track.samples.length && !this.flushing) {
          this.flushing = true;
          await this.decoder.flush();
          this.eofFlushed = true;
          this.advanceCurrentTo(targetUs);
          break;
        }
      } else if (!this.flushing) {
        this.flushing = true;
        await this.decoder.flush();
        this.eofFlushed = true;
        this.advanceCurrentTo(targetUs);
        break;
      }

      this.advanceCurrentTo(targetUs);
      if (!this.eofFlushed && !this.hasFrameAfter(targetUs)) {
        await this.waitForOutput();
        this.advanceCurrentTo(targetUs);
      }
    }

    if (this.error) throw this.error;
    return this.currentFrame ?? this.decodedQueue[0] ?? null;
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.notifyOutput();
    try {
      if (this.decoder.state !== "closed") {
        this.decoder.close();
      }
    } catch {
      /* ignore */
    }
    this.currentFrame?.close();
    this.currentFrame = null;
    for (const f of this.decodedQueue) {
      try {
        f.close();
      } catch {
        /* ignore */
      }
    }
    this.decodedQueue = [];
  }
}

/**
 * Deterministic paused `<video>` frame source fallback (for WebM or non-WebCodecs inputs).
 * Keeps the video element attached in a hidden DOM container and strictly paused so every
 * frame seek produces the exact decoded GPU texture with zero skipped animations.
 */
class PausedVideoFrameStream implements FrameSource {
  private readonly video: HTMLVideoElement;
  private readonly host: HTMLDivElement | null;

  private constructor(video: HTMLVideoElement, host: HTMLDivElement | null) {
    this.video = video;
    this.host = host;
  }

  static async create(url: string): Promise<PausedVideoFrameStream> {
    const host = createHiddenVideoHost();
    try {
      const video = await loadVideoElement(url, host);
      video.pause();
      return new PausedVideoFrameStream(video, host);
    } catch (err) {
      host?.remove();
      throw err;
    }
  }

  async getFrameAtTime(timeSec: number): Promise<HTMLVideoElement> {
    await seekVideoExact(this.video, timeSec);
    return this.video;
  }

  dispose() {
    this.video.pause();
    this.video.removeAttribute("src");
    this.video.load();
    this.host?.remove();
  }
}

async function createFrameSource(
  url: string,
  trimStartSec: number,
  preloadedBuffer?: ArrayBuffer | null,
): Promise<{ source: FrameSource; buffer: ArrayBuffer | null }> {
  let buffer: ArrayBuffer | null = preloadedBuffer ?? null;
  if (!buffer) {
    try {
      const res = await fetch(url);
      if (res.ok) {
        buffer = await res.arrayBuffer();
      }
    } catch {
      buffer = null;
    }
  }

  if (buffer) {
    const webCodecsStream = await Mp4VideoFrameStream.create(buffer, trimStartSec);
    if (webCodecsStream) {
      return { source: webCodecsStream, buffer };
    }
  }

  const pausedStream = await PausedVideoFrameStream.create(url);
  return { source: pausedStream, buffer };
}

async function decodeTrimmedAudioBuffer(
  project: EditorProject,
  startSec: number,
  durationSec: number,
  preloadedBuffer?: ArrayBuffer | null,
): Promise<AudioBuffer | null> {
  if (project.audio.masterVolume <= 0.001 || (project.audio.micMuted && project.audio.systemMuted)) {
    return null;
  }
  try {
    const AudioCtx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return null;
    const arrayBuf =
      preloadedBuffer ?? (await (await fetch(project.screenUrl)).arrayBuffer());
    const ctx = new AudioCtx();
    const decoded = await ctx.decodeAudioData(arrayBuf.slice(0));
    const sampleRate = decoded.sampleRate;
    const startSample = Math.max(0, Math.floor(startSec * sampleRate));
    const lengthSamples = Math.max(
      1,
      Math.min(decoded.length - startSample, Math.floor(durationSec * sampleRate)),
    );
    if (lengthSamples <= 0) {
      void ctx.close();
      return null;
    }

    const outChannels = Math.min(2, decoded.numberOfChannels);
    const out = ctx.createBuffer(outChannels, lengthSamples, sampleRate);
    const gain =
      project.audio.masterVolume *
      Math.max(
        project.audio.micMuted ? 0 : project.audio.micVolume,
        project.audio.systemMuted ? 0 : project.audio.systemVolume,
      );
    const fadeSamples = Math.min(Math.floor(sampleRate * 0.45), Math.floor(lengthSamples / 4));

    for (let ch = 0; ch < outChannels; ch++) {
      const src = decoded.getChannelData(Math.min(ch, decoded.numberOfChannels - 1));
      const dst = out.getChannelData(ch);
      for (let i = 0; i < lengthSamples; i++) {
        let g = gain;
        if (project.audio.fadeIn && i < fadeSamples) {
          g *= i / fadeSamples;
        }
        if (project.audio.fadeOut && i > lengthSamples - fadeSamples) {
          g *= (lengthSamples - i) / fadeSamples;
        }
        dst[i] = Math.max(-1, Math.min(1, src[startSample + i] * g));
      }
    }
    void ctx.close();
    return out;
  } catch {
    return null;
  }
}

async function pickWebCodecsVideoConfig(
  format: "mp4" | "webm",
  width: number,
  height: number,
  fps: number,
  bitrate: number,
): Promise<VideoEncoderConfig | null> {
  if (typeof VideoEncoder === "undefined" || typeof VideoFrame === "undefined") return null;
  const candidates =
    format === "mp4"
      ? ["avc1.640033", "avc1.64002a", "avc1.4d002a", "avc1.42001f"]
      : ["vp09.00.41.08", "vp8"];

  // Prefer quality latencyMode so offline exports never drop motion frames or degrade transitions
  const modes: Array<{
    hardwareAcceleration: HardwareAcceleration;
    latencyMode: LatencyMode;
  }> = [
    { hardwareAcceleration: "prefer-hardware", latencyMode: "quality" },
    { hardwareAcceleration: "no-preference", latencyMode: "quality" },
    { hardwareAcceleration: "prefer-hardware", latencyMode: "realtime" },
    { hardwareAcceleration: "no-preference", latencyMode: "realtime" },
  ];

  for (const mode of modes) {
    for (const codec of candidates) {
      try {
        const cfg: VideoEncoderConfig = {
          codec,
          width,
          height,
          bitrate,
          framerate: fps,
          hardwareAcceleration: mode.hardwareAcceleration,
          latencyMode: mode.latencyMode,
        };
        const support = await VideoEncoder.isConfigSupported(cfg);
        if (support.supported) return cfg;
      } catch {
        /* try next */
      }
    }
  }
  return null;
}

/**
 * Frame-accurate, hardware-accelerated local video export engine.
 * Uses direct WebCodecs `VideoDecoder` MP4 demuxing (with exact paused-seek fallback),
 * cached backdrop/shadow layers, and quality-mode WebCodecs encoding so every single
 * screen animation, scroll, hover transition, cursor motion, and zoom keyframe renders smoothly.
 */
export async function exportProjectLocally(
  project: EditorProject,
  options: ExportOptions,
  onProgress: (p: ExportProgress) => void,
  signal?: AbortSignal,
): Promise<Blob> {
  const specs = getExportOutputSpecs(project, options);
  const { width, height, bitrateBps, trimmedDuration } = specs;
  const totalFrames = Math.max(1, Math.ceil(trimmedDuration * options.fps));

  onProgress({
    phase: "preparing",
    progress: 0.02,
    currentFrame: 0,
    totalFrames,
    etaSeconds: null,
    message: "Loading tracks & initializing frame-accurate encoder…",
  });

  // Fetch screen video bytes once so both MP4 WebCodecs decoder and WebAudio decoder reuse them
  let screenArrayBuffer: ArrayBuffer | null = null;
  try {
    const res = await fetch(project.screenUrl);
    if (res.ok) screenArrayBuffer = await res.arrayBuffer();
  } catch {
    screenArrayBuffer = null;
  }

  const audioBufferPromise = decodeTrimmedAudioBuffer(
    project,
    project.trimStart,
    trimmedDuration,
    screenArrayBuffer,
  );
  const customBgImagePromise = project.canvas.customBackgroundUrl
    ? loadImageElement(project.canvas.customBackgroundUrl)
    : Promise.resolve(null);

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d", { alpha: false })!;

  const videoEncoderConfig = await pickWebCodecsVideoConfig(
    options.format,
    width,
    height,
    options.fps,
    bitrateBps,
  );

  // Path A: Frame-Accurate Hardware WebCodecs (VideoDecoder + VideoEncoder) + mp4-muxer / webm-muxer
  if (videoEncoderConfig) {
    const [screenStreamRes, cameraStreamRes, customBgImage, audioBuffer] = await Promise.all([
      createFrameSource(project.screenUrl, project.trimStart, screenArrayBuffer),
      project.camera.enabled && project.cameraUrl
        ? createFrameSource(project.cameraUrl, project.trimStart).catch(() => null)
        : Promise.resolve(null),
      customBgImagePromise,
      audioBufferPromise,
    ]);

    const screenSource = screenStreamRes.source;
    const cameraSource = cameraStreamRes?.source ?? null;

    const hasAudioEncoder =
      audioBuffer !== null && typeof AudioEncoder !== "undefined" && typeof AudioData !== "undefined";

    const audioCodec = options.format === "mp4" ? "mp4a.40.2" : "opus";
    let includeAudio = false;
    if (hasAudioEncoder && audioBuffer) {
      try {
        const sup = await AudioEncoder.isConfigSupported({
          codec: audioCodec,
          numberOfChannels: audioBuffer.numberOfChannels,
          sampleRate: audioBuffer.sampleRate,
          bitrate: 128_000,
        });
        includeAudio = Boolean(sup.supported);
      } catch {
        includeAudio = false;
      }
    }

    const isMp4 = options.format === "mp4";
    const mp4Target = isMp4 ? new Mp4Target() : null;
    const webmTarget = !isMp4 ? new WebmTarget() : null;

    const mp4Muxer = isMp4
      ? new Mp4Muxer({
          target: mp4Target!,
          video: { codec: "avc", width, height },
          audio:
            includeAudio && audioBuffer
              ? {
                  codec: "aac",
                  numberOfChannels: audioBuffer.numberOfChannels,
                  sampleRate: audioBuffer.sampleRate,
                }
              : undefined,
          fastStart: "in-memory",
        })
      : null;

    const webmMuxer = !isMp4
      ? new WebmMuxer({
          target: webmTarget!,
          video: {
            codec: videoEncoderConfig.codec.startsWith("vp09") ? "V_VP9" : "V_VP8",
            width,
            height,
            frameRate: options.fps,
          },
          audio:
            includeAudio && audioBuffer
              ? {
                  codec: "A_OPUS",
                  numberOfChannels: audioBuffer.numberOfChannels,
                  sampleRate: audioBuffer.sampleRate,
                }
              : undefined,
        })
      : null;

    let encodeError: Error | null = null;
    const videoEncoder = new VideoEncoder({
      output: (chunk, meta) => {
        if (mp4Muxer) mp4Muxer.addVideoChunk(chunk, meta);
        if (webmMuxer) webmMuxer.addVideoChunk(chunk, meta);
      },
      error: (err) => {
        encodeError = err instanceof Error ? err : new Error(String(err));
      },
    });

    videoEncoder.configure(videoEncoderConfig);

    const startWall = performance.now();
    const frameDurationUs = Math.round(1_000_000 / options.fps);
    const progressStep = Math.max(4, Math.floor(options.fps / 4));

    try {
      for (let f = 0; f < totalFrames; f++) {
        if (signal?.aborted) {
          throw new DOMException("Export cancelled", "AbortError");
        }
        if (encodeError) {
          throw encodeError;
        }

        const t = project.trimStart + f / options.fps;
        const [screenDrawable, cameraDrawable] = await Promise.all([
          screenSource.getFrameAtTime(t),
          cameraSource ? cameraSource.getFrameAtTime(t) : Promise.resolve(null),
        ]);

        const sources: RenderSources = {
          screenVideo: screenDrawable,
          cameraVideo: cameraDrawable,
          customBgImage,
        };

        renderCompositionFrame(ctx, project, t, sources);

        const timestampUs = Math.round((f * 1_000_000) / options.fps);
        const frame = new VideoFrame(canvas, {
          timestamp: timestampUs,
          duration: frameDurationUs,
        });
        videoEncoder.encode(frame, { keyFrame: f % (options.fps * 2) === 0 });
        frame.close();

        // Apply backpressure so hardware encoder never drops frames or spikes VRAM
        while (videoEncoder.encodeQueueSize > 8) {
          if (signal?.aborted) {
            throw new DOMException("Export cancelled", "AbortError");
          }
          if (encodeError) throw encodeError;
          await new Promise((r) => window.setTimeout(r, 4));
        }

        if (f % progressStep === 0 || f === totalFrames - 1) {
          const elapsed = (performance.now() - startWall) / 1000;
          const frac = (f + 1) / totalFrames;
          const eta = frac > 0.04 ? (elapsed / frac) * (1 - frac) : null;
          onProgress({
            phase: "rendering",
            progress: 0.05 + frac * 0.85,
            currentFrame: f + 1,
            totalFrames,
            etaSeconds: eta,
            message: `Rendering frame ${f + 1} of ${totalFrames} (${width}×${height})…`,
          });
          // Let the UI paint progress smoothly without blocking the event loop
          await new Promise((r) => window.setTimeout(r, 0));
        }
      }

      onProgress({
        phase: "finalizing",
        progress: 0.92,
        currentFrame: totalFrames,
        totalFrames,
        etaSeconds: 1,
        message: "Encoding audio & muxing container…",
      });

      await videoEncoder.flush();
      if (encodeError) throw encodeError;
    } finally {
      screenSource.dispose();
      cameraSource?.dispose();
      try {
        if (videoEncoder.state !== "closed") {
          videoEncoder.close();
        }
      } catch {
        /* ignore */
      }
    }

    // Encode audio in 16,384-frame blocks for fast flushing
    if (includeAudio && audioBuffer) {
      const audioEncoder = new AudioEncoder({
        output: (chunk, meta) => {
          if (mp4Muxer) mp4Muxer.addAudioChunk(chunk, meta);
          if (webmMuxer) webmMuxer.addAudioChunk(chunk, meta);
        },
        error: () => {
          /* best effort audio */
        },
      });
      audioEncoder.configure({
        codec: audioCodec,
        numberOfChannels: audioBuffer.numberOfChannels,
        sampleRate: audioBuffer.sampleRate,
        bitrate: 128_000,
      });

      const chunkSize = 16384;
      const chCount = audioBuffer.numberOfChannels;
      for (let offset = 0; offset < audioBuffer.length; offset += chunkSize) {
        const frames = Math.min(chunkSize, audioBuffer.length - offset);
        const planar = new Float32Array(frames * chCount);
        for (let ch = 0; ch < chCount; ch++) {
          planar.set(audioBuffer.getChannelData(ch).subarray(offset, offset + frames), ch * frames);
        }
        const audioData = new AudioData({
          format: "f32-planar",
          sampleRate: audioBuffer.sampleRate,
          numberOfFrames: frames,
          numberOfChannels: chCount,
          timestamp: Math.round((offset / audioBuffer.sampleRate) * 1_000_000),
          data: planar,
        });
        audioEncoder.encode(audioData);
        audioData.close();
      }
      await audioEncoder.flush();
      audioEncoder.close();
    }

    if (mp4Muxer && mp4Target) {
      mp4Muxer.finalize();
      return new Blob([mp4Target.buffer], { type: "video/mp4" });
    }
    if (webmMuxer && webmTarget) {
      webmMuxer.finalize();
      return new Blob([webmTarget.buffer], { type: "video/webm" });
    }
  }

  // Path B: Real-time MediaRecorder fallback (when WebCodecs VideoEncoder is unavailable)
  const fallbackHost = createHiddenVideoHost();
  const [screenVideo, cameraVideo, customBgImage] = await Promise.all([
    loadVideoElement(project.screenUrl, fallbackHost),
    project.camera.enabled && project.cameraUrl
      ? loadVideoElement(project.cameraUrl, fallbackHost).catch(() => null)
      : Promise.resolve(null),
    customBgImagePromise,
  ]);
  const sources: RenderSources = { screenVideo, cameraVideo, customBgImage };

  const fallbackMime =
    options.format === "mp4" && MediaRecorder.isTypeSupported("video/mp4")
      ? "video/mp4"
      : MediaRecorder.isTypeSupported("video/webm;codecs=vp9")
        ? "video/webm;codecs=vp9"
        : "video/webm";

  const stream = canvas.captureStream(options.fps);
  const chunks: BlobPart[] = [];
  const recorder = new MediaRecorder(stream, {
    mimeType: fallbackMime,
    videoBitsPerSecond: bitrateBps,
  });
  recorder.ondataavailable = (e) => {
    if (e.data.size > 0) chunks.push(e.data);
  };

  try {
    await Promise.all([
      seekVideoExact(screenVideo, project.trimStart),
      cameraVideo ? seekVideoExact(cameraVideo, project.trimStart) : Promise.resolve(),
    ]);

    recorder.start(250);
    screenVideo.playbackRate = 1.0;
    await screenVideo.play().catch(() => {});
    if (cameraVideo) {
      cameraVideo.playbackRate = 1.0;
      void cameraVideo.play().catch(() => {});
    }

    await new Promise<void>((resolve, reject) => {
      let rafId = 0;
      const tick = () => {
        if (signal?.aborted) {
          window.cancelAnimationFrame(rafId);
          screenVideo.pause();
          cameraVideo?.pause();
          recorder.stop();
          reject(new DOMException("Export cancelled", "AbortError"));
          return;
        }
        const t = screenVideo.currentTime;
        if (t >= project.trimEnd || screenVideo.ended) {
          screenVideo.pause();
          cameraVideo?.pause();
          resolve();
          return;
        }
        if (cameraVideo && Math.abs(cameraVideo.currentTime - t) > 0.05) {
          cameraVideo.currentTime = t;
        }
        renderCompositionFrame(ctx, project, t, sources);

        const elapsed = Math.max(0, t - project.trimStart);
        const frac = Math.min(1, elapsed / trimmedDuration);
        onProgress({
          phase: "rendering",
          progress: 0.05 + frac * 0.9,
          currentFrame: Math.min(totalFrames, Math.round(elapsed * options.fps)),
          totalFrames,
          etaSeconds: Math.max(0, trimmedDuration - elapsed),
          message: `Rendering locally (${Math.round(frac * 100)}%)…`,
        });
        rafId = window.requestAnimationFrame(tick);
      };
      rafId = window.requestAnimationFrame(tick);
    });
  } finally {
    screenVideo.pause();
    cameraVideo?.pause();
    fallbackHost?.remove();
  }

  return new Promise<Blob>((resolve) => {
    recorder.onstop = () => resolve(new Blob(chunks, { type: fallbackMime }));
    recorder.stop();
  });
}
