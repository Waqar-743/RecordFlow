import { ArrayBufferTarget as Mp4Target, Muxer as Mp4Muxer } from "mp4-muxer";
import { ArrayBufferTarget as WebmTarget, Muxer as WebmMuxer } from "webm-muxer";
import {
  getAspectDimensions,
  renderCompositionFrame,
  type RenderSources,
} from "./canvasRenderer";
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

function loadVideoElement(url: string): Promise<HTMLVideoElement> {
  return new Promise((resolve, reject) => {
    const v = document.createElement("video");
    v.crossOrigin = "anonymous";
    v.muted = true;
    v.playsInline = true;
    v.preload = "auto";
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

function seekVideo(video: HTMLVideoElement, timeSec: number): Promise<void> {
  return new Promise((resolve) => {
    const clamped = Math.max(0, Math.min(Number.isFinite(video.duration) ? video.duration : timeSec, timeSec));
    if (Math.abs(video.currentTime - clamped) < 0.004 && video.readyState >= 2) {
      resolve();
      return;
    }
    const onSeeked = () => {
      video.removeEventListener("seeked", onSeeked);
      resolve();
    };
    const timer = window.setTimeout(() => {
      video.removeEventListener("seeked", onSeeked);
      resolve();
    }, 1500);
    video.addEventListener("seeked", () => {
      window.clearTimeout(timer);
      onSeeked();
    }, { once: true });
    video.currentTime = clamped;
  });
}

async function decodeTrimmedAudioBuffer(
  project: EditorProject,
  startSec: number,
  durationSec: number,
): Promise<AudioBuffer | null> {
  if (project.audio.masterVolume <= 0.001 || (project.audio.micMuted && project.audio.systemMuted)) {
    return null;
  }
  try {
    const AudioCtx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return null;
    const res = await fetch(project.screenUrl);
    const arrayBuf = await res.arrayBuffer();
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

async function pickWebCodecsVideoCodec(
  format: "mp4" | "webm",
  width: number,
  height: number,
  fps: number,
  bitrate: number,
): Promise<string | null> {
  if (typeof VideoEncoder === "undefined" || typeof VideoFrame === "undefined") return null;
  const candidates =
    format === "mp4"
      ? ["avc1.640033", "avc1.64002a", "avc1.4d002a", "avc1.42001f"]
      : ["vp09.00.41.08", "vp8"];

  for (const codec of candidates) {
    try {
      const support = await VideoEncoder.isConfigSupported({
        codec,
        width,
        height,
        bitrate,
        framerate: fps,
      });
      if (support.supported) return codec;
    } catch {
      /* try next */
    }
  }
  return null;
}

/**
 * Real-time / frame-accurate local video export engine.
 * Composites the screen recording, curated/custom background, framing, trims, zoom keyframes,
 * cursor ripples, blur regions, and independent camera overlay directly on this machine.
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
    message: "Loading tracks & initializing local encoder…",
  });

  const screenVideo = await loadVideoElement(project.screenUrl);
  const cameraVideo =
    project.camera.enabled && project.cameraUrl
      ? await loadVideoElement(project.cameraUrl).catch(() => null)
      : null;
  const customBgImage = project.canvas.customBackgroundUrl
    ? await loadImageElement(project.canvas.customBackgroundUrl)
    : null;

  const sources: RenderSources = { screenVideo, cameraVideo, customBgImage };

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d", { alpha: false })!;

  const videoCodec = await pickWebCodecsVideoCodec(
    options.format,
    width,
    height,
    options.fps,
    bitrateBps,
  );

  // Path A: Deterministic Frame-by-Frame WebCodecs + mp4-muxer / webm-muxer (preferred!)
  if (videoCodec) {
    const audioBuffer = await decodeTrimmedAudioBuffer(project, project.trimStart, trimmedDuration);
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
            codec: videoCodec.startsWith("vp09") ? "V_VP9" : "V_VP8",
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

    videoEncoder.configure({
      codec: videoCodec,
      width,
      height,
      bitrate: bitrateBps,
      framerate: options.fps,
      hardwareAcceleration: "prefer-hardware",
    });

    const startWall = performance.now();
    const frameDurationUs = Math.round(1_000_000 / options.fps);

    for (let f = 0; f < totalFrames; f++) {
      if (signal?.aborted) {
        videoEncoder.close();
        throw new DOMException("Export cancelled", "AbortError");
      }
      if (encodeError) {
        videoEncoder.close();
        throw encodeError;
      }

      const t = project.trimStart + f / options.fps;
      await seekVideo(screenVideo, t);
      if (cameraVideo) {
        await seekVideo(cameraVideo, t);
      }

      renderCompositionFrame(ctx, project, t, sources);

      const frame = new VideoFrame(canvas, {
        timestamp: f * frameDurationUs,
        duration: frameDurationUs,
      });
      videoEncoder.encode(frame, { keyFrame: f % (options.fps * 2) === 0 });
      frame.close();

      // Apply light backpressure so memory stays bounded on 4K exports
      while (videoEncoder.encodeQueueSize > 8) {
        await new Promise((r) => window.setTimeout(r, 8));
      }

      if (f % 3 === 0 || f === totalFrames - 1) {
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
    videoEncoder.close();

    // Encode audio if available
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

      const chunkSize = 1024;
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

  // Path B: Real-time MediaRecorder fallback (when WebCodecs H.264/VP9 is unavailable)
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

  await seekVideo(screenVideo, project.trimStart);
  if (cameraVideo) await seekVideo(cameraVideo, project.trimStart);

  recorder.start(250);
  const startWall = performance.now();

  await new Promise<void>((resolve, reject) => {
    const tick = async () => {
      if (signal?.aborted) {
        recorder.stop();
        reject(new DOMException("Export cancelled", "AbortError"));
        return;
      }
      const elapsed = (performance.now() - startWall) / 1000;
      const t = project.trimStart + elapsed;
      if (t >= project.trimEnd) {
        resolve();
        return;
      }
      await seekVideo(screenVideo, t);
      if (cameraVideo) await seekVideo(cameraVideo, t);
      renderCompositionFrame(ctx, project, t, sources);

      const frac = Math.min(1, elapsed / trimmedDuration);
      onProgress({
        phase: "rendering",
        progress: 0.05 + frac * 0.9,
        currentFrame: Math.min(totalFrames, Math.round(elapsed * options.fps)),
        totalFrames,
        etaSeconds: Math.max(0, trimmedDuration - elapsed),
        message: `Rendering locally (${Math.round(frac * 100)}%)…`,
      });
      window.setTimeout(() => void tick(), Math.max(12, Math.round(1000 / options.fps)));
    };
    void tick();
  });

  return new Promise<Blob>((resolve) => {
    recorder.onstop = () => resolve(new Blob(chunks, { type: fallbackMime }));
    recorder.stop();
  });
}
