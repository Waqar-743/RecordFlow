import {
  createDefaultProject,
  extractWaveformFromUrl,
  generateSyntheticWaveform,
} from "../editor/canvasRenderer";
import { loadNativeSidecars, localPathToUrl } from "./tauri.service";
import type {
  CursorClick,
  CursorSample,
  CursorTrackData,
  EditorProject,
  RecordingSettings,
} from "../types";

export interface BrowserSessionResult {
  screenUrl: string;
  cameraUrl: string | null;
  duration: number;
  width: number;
  height: number;
  cursorTrack: CursorTrackData;
}

/**
 * Browser / hybrid capture session used when running outside the Windows Tauri backend
 * (e.g., Vite web preview). Captures real getDisplayMedia screen video (or falls back
 * gracefully to an interactive studio canvas stream if permission is denied/unavailable),
 * independent getUserMedia webcam stream, mic audio, and pointer/click interaction tracking.
 */
export class BrowserCaptureController {
  private screenRecorder: MediaRecorder | null = null;
  private cameraRecorder: MediaRecorder | null = null;
  private screenChunks: BlobPart[] = [];
  private cameraChunks: BlobPart[] = [];
  private streams: MediaStream[] = [];
  private fallbackRaf: number | null = null;
  private startedAt = 0;
  private pausedAt: number | null = null;
  private pausedMs = 0;
  private samples: CursorSample[] = [];
  private clicks: CursorClick[] = [];
  private pointerCleanup: (() => void) | null = null;
  private width = 1280;
  private height = 720;

  async start(settings: RecordingSettings): Promise<void> {
    this.screenChunks = [];
    this.cameraChunks = [];
    this.samples = [];
    this.clicks = [];
    this.pausedAt = null;
    this.pausedMs = 0;

    let screenStream: MediaStream | null = null;
    try {
      if (navigator.mediaDevices?.getDisplayMedia) {
        screenStream = await navigator.mediaDevices.getDisplayMedia({
          video: {
            frameRate: { ideal: settings.fps || 30 },
          },
          audio: settings.system_audio_enabled,
        });
      }
    } catch {
      screenStream = null;
    }

    // Fallback to an animated live studio canvas stream if getDisplayMedia is unavailable/dismissed
    if (!screenStream) {
      const canvas = document.createElement("canvas");
      canvas.width = 1280;
      canvas.height = 720;
      const ctx = canvas.getContext("2d")!;
      const startT = performance.now();
      const renderLoop = () => {
        const t = (performance.now() - startT) / 1000;
        const grad = ctx.createLinearGradient(0, 0, 1280, 720);
        grad.addColorStop(0, "#1c1414");
        grad.addColorStop(1, "#110c0c");
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, 1280, 720);

        ctx.fillStyle = "#261b1b";
        ctx.strokeStyle = "rgba(255, 107, 74, 0.34)";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.roundRect(120, 90, 1040, 540, 20);
        ctx.fill();
        ctx.stroke();

        ctx.fillStyle = "#faf3ef";
        ctx.font = "700 32px Inter, sans-serif";
        ctx.fillText("RecordFlow Live Capture Session", 170, 172);

        ctx.fillStyle = "#c4b0ae";
        ctx.font = "500 16px 'JetBrains Mono', monospace";
        ctx.fillText(
          `Mode: ${settings.capture_mode} · Elapsed: ${t.toFixed(1)}s · 60 fps`,
          170,
          212,
        );

        // Moving interactive indicator
        const mx = 220 + ((Math.sin(t * 1.3) + 1) / 2) * 760;
        const my = 320 + ((Math.cos(t * 0.9) + 1) / 2) * 200;
        ctx.fillStyle = "rgba(255, 107, 74, 0.25)";
        ctx.beginPath();
        ctx.arc(mx, my, 46, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = "#ff6b4a";
        ctx.beginPath();
        ctx.arc(mx, my, 12, 0, Math.PI * 2);
        ctx.fill();

        this.fallbackRaf = window.requestAnimationFrame(renderLoop);
      };
      renderLoop();
      screenStream = canvas.captureStream(30);
    }

    const vTrack = screenStream.getVideoTracks()[0];
    const vSettings = vTrack?.getSettings?.();
    this.width = vSettings?.width ?? 1280;
    this.height = vSettings?.height ?? 720;
    this.streams.push(screenStream);

    // Optional Microphone audio mixed into screen recorder
    const combinedTracks = [...screenStream.getTracks()];
    if (settings.mic_enabled && navigator.mediaDevices?.getUserMedia) {
      try {
        const micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
        this.streams.push(micStream);
        micStream.getAudioTracks().forEach((tr) => combinedTracks.push(tr));
      } catch {
        /* mic unavailable */
      }
    }

    const mime = MediaRecorder.isTypeSupported("video/webm;codecs=vp9,opus")
      ? "video/webm;codecs=vp9,opus"
      : MediaRecorder.isTypeSupported("video/webm;codecs=vp8,opus")
        ? "video/webm;codecs=vp8,opus"
        : "video/webm";

    this.screenRecorder = new MediaRecorder(new MediaStream(combinedTracks), {
      mimeType: mime,
      videoBitsPerSecond: 5_000_000,
    });
    this.screenRecorder.ondataavailable = (e) => {
      if (e.data.size > 0) this.screenChunks.push(e.data);
    };

    // Independent synchronized webcam stream
    if (settings.camera_enabled && navigator.mediaDevices?.getUserMedia) {
      try {
        const camStream = await navigator.mediaDevices.getUserMedia({
          video: { width: { ideal: 640 }, height: { ideal: 480 } },
          audio: false,
        });
        this.streams.push(camStream);
        const camMime = MediaRecorder.isTypeSupported("video/webm;codecs=vp9")
          ? "video/webm;codecs=vp9"
          : "video/webm";
        this.cameraRecorder = new MediaRecorder(camStream, {
          mimeType: camMime,
          videoBitsPerSecond: 1_800_000,
        });
        this.cameraRecorder.ondataavailable = (e) => {
          if (e.data.size > 0) this.cameraChunks.push(e.data);
        };
      } catch {
        this.cameraRecorder = null;
      }
    }

    this.startedAt = performance.now();
    this.screenRecorder.start(250);
    this.cameraRecorder?.start(250);

    // Track pointer & clicks relative to viewport for demo interaction tracking
    const currentElapsed = () =>
      Math.max(0, (performance.now() - this.startedAt - this.pausedMs) / 1000);

    const onMove = (e: MouseEvent) => {
      if (this.pausedAt !== null) return;
      this.samples.push({
        t: currentElapsed(),
        x: Math.max(0, Math.min(1, e.clientX / Math.max(1, window.innerWidth))),
        y: Math.max(0, Math.min(1, e.clientY / Math.max(1, window.innerHeight))),
      });
    };
    const onDown = (e: MouseEvent) => {
      if (this.pausedAt !== null) return;
      const x = Math.max(0, Math.min(1, e.clientX / Math.max(1, window.innerWidth)));
      const y = Math.max(0, Math.min(1, e.clientY / Math.max(1, window.innerHeight)));
      const t = currentElapsed();
      this.clicks.push({ t, x, y, button: e.button === 2 ? 1 : 0 });
      this.samples.push({ t, x, y });
    };
    window.addEventListener("mousemove", onMove, { passive: true });
    window.addEventListener("mousedown", onDown, { passive: true });
    this.pointerCleanup = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mousedown", onDown);
    };
  }

  pause() {
    if (this.pausedAt !== null) return;
    this.pausedAt = performance.now();
    if (this.screenRecorder?.state === "recording") this.screenRecorder.pause();
    if (this.cameraRecorder?.state === "recording") this.cameraRecorder.pause();
  }

  resume() {
    if (this.pausedAt === null) return;
    this.pausedMs += performance.now() - this.pausedAt;
    this.pausedAt = null;
    if (this.screenRecorder?.state === "paused") this.screenRecorder.resume();
    if (this.cameraRecorder?.state === "paused") this.cameraRecorder.resume();
  }

  async stop(): Promise<BrowserSessionResult | null> {
    this.pointerCleanup?.();
    this.pointerCleanup = null;
    if (this.fallbackRaf !== null) {
      window.cancelAnimationFrame(this.fallbackRaf);
      this.fallbackRaf = null;
    }

    const totalPaused =
      this.pausedMs + (this.pausedAt !== null ? performance.now() - this.pausedAt : 0);
    const duration = Math.max(0.5, (performance.now() - this.startedAt - totalPaused) / 1000);

    const stopRec = (rec: MediaRecorder | null, chunks: BlobPart[]): Promise<Blob | null> =>
      new Promise((resolve) => {
        if (!rec || rec.state === "inactive") {
          resolve(chunks.length > 0 ? new Blob(chunks, { type: "video/webm" }) : null);
          return;
        }
        rec.onstop = () => resolve(new Blob(chunks, { type: rec.mimeType || "video/webm" }));
        rec.stop();
      });

    const [screenBlob, camBlob] = await Promise.all([
      stopRec(this.screenRecorder, this.screenChunks),
      stopRec(this.cameraRecorder, this.cameraChunks),
    ]);

    for (const s of this.streams) {
      s.getTracks().forEach((t) => t.stop());
    }
    this.streams = [];
    this.screenRecorder = null;
    this.cameraRecorder = null;

    if (!screenBlob) return null;

    return {
      screenUrl: URL.createObjectURL(screenBlob),
      cameraUrl: camBlob ? URL.createObjectURL(camBlob) : null,
      duration,
      width: this.width,
      height: this.height,
      cursorTrack: {
        version: 1,
        width: this.width,
        height: this.height,
        samples: this.samples,
        clicks: this.clicks,
      },
    };
  }
}

/** Probe a video URL's real metadata (duration, width, height). */
export function probeVideoMetadata(
  url: string,
): Promise<{ duration: number; width: number; height: number }> {
  return new Promise((resolve) => {
    const video = document.createElement("video");
    video.preload = "metadata";
    video.muted = true;
    const timeout = window.setTimeout(() => {
      resolve({ duration: 5, width: 1920, height: 1080 });
    }, 4000);
    video.onloadedmetadata = () => {
      window.clearTimeout(timeout);
      const dur = Number.isFinite(video.duration) && video.duration > 0 ? video.duration : 5;
      resolve({
        duration: dur,
        width: video.videoWidth || 1920,
        height: video.videoHeight || 1080,
      });
    };
    video.onerror = () => {
      window.clearTimeout(timeout);
      resolve({ duration: 5, width: 1920, height: 1080 });
    };
    video.src = url;
  });
}

/** Build an EditorProject directly from a finished native Tauri recording MP4 path. */
export async function loadNativeRecordingIntoProject(
  filePath: string,
  fallbackDurationSec: number,
): Promise<EditorProject> {
  const screenUrl = localPathToUrl(filePath);
  const [meta, sidecars, waveform] = await Promise.all([
    probeVideoMetadata(screenUrl),
    loadNativeSidecars(filePath),
    extractWaveformFromUrl(screenUrl).catch(() => generateSyntheticWaveform(96)),
  ]);

  const fileName = filePath.split(/[\\/]/).pop()?.replace(/\.[^.]+$/, "") ?? "Recording";
  const duration = Math.max(meta.duration || fallbackDurationSec || 1, 0.5);

  return createDefaultProject({
    name: fileName,
    screenUrl,
    screenPath: filePath,
    cameraUrl: sidecars.cameraUrl,
    cameraPath: sidecars.cameraPath,
    duration,
    sourceWidth: meta.width,
    sourceHeight: meta.height,
    cursorTrack: sidecars.cursorTrack,
    waveform,
  });
}
