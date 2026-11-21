import { createDefaultProject, generateSyntheticWaveform } from "./canvasRenderer";
import type { CursorClick, CursorSample, CursorTrackData, EditorProject } from "../types";

/**
 * Generates a realistic, playable studio demo recording (screen video + independent
 * synchronized webcam video + cursor/click interaction track) using Canvas + MediaRecorder.
 * Strictly uses warm studio colors (zero blue, zero green).
 */
export async function generateStudioDemoProject(durationSec = 6): Promise<EditorProject> {
  const width = 1280;
  const height = 720;
  const camW = 480;
  const camH = 360;
  const fps = 30;

  const screenCanvas = document.createElement("canvas");
  screenCanvas.width = width;
  screenCanvas.height = height;
  const sCtx = screenCanvas.getContext("2d")!;

  const camCanvas = document.createElement("canvas");
  camCanvas.width = camW;
  camCanvas.height = camH;
  const cCtx = camCanvas.getContext("2d")!;

  const mimeType = MediaRecorder.isTypeSupported("video/webm;codecs=vp9")
    ? "video/webm;codecs=vp9"
    : MediaRecorder.isTypeSupported("video/webm;codecs=vp8")
      ? "video/webm;codecs=vp8"
      : "video/webm";

  const screenStream = screenCanvas.captureStream(fps);
  const camStream = camCanvas.captureStream(fps);

  const screenChunks: BlobPart[] = [];
  const camChunks: BlobPart[] = [];

  const screenRec = new MediaRecorder(screenStream, { mimeType, videoBitsPerSecond: 4_000_000 });
  const camRec = new MediaRecorder(camStream, { mimeType, videoBitsPerSecond: 1_500_000 });

  screenRec.ondataavailable = (e) => {
    if (e.data.size > 0) screenChunks.push(e.data);
  };
  camRec.ondataavailable = (e) => {
    if (e.data.size > 0) camChunks.push(e.data);
  };

  const samples: CursorSample[] = [];
  const clicks: CursorClick[] = [
    { t: 1.5, x: 0.34, y: 0.42, button: 0 },
    { t: 3.8, x: 0.68, y: 0.56, button: 0 },
  ];

  // Keyframe cursor path
  const cursorAt = (t: number) => {
    const p = Math.max(0, Math.min(1, t / durationSec));
    if (p < 0.28) {
      const k = p / 0.28;
      return { x: 0.16 + 0.18 * k, y: 0.28 + 0.14 * k };
    }
    if (p < 0.65) {
      const k = (p - 0.28) / 0.37;
      return { x: 0.34 + 0.34 * k, y: 0.42 + 0.14 * k };
    }
    const k = (p - 0.65) / 0.35;
    return { x: 0.68 - 0.14 * k, y: 0.56 - 0.22 * k };
  };

  for (let i = 0; i <= durationSec * 30; i++) {
    const t = i / 30;
    const pt = cursorAt(t);
    samples.push({ t, x: pt.x, y: pt.y });
  }

  const drawDemoScreen = (t: number) => {
    sCtx.fillStyle = "#141010";
    sCtx.fillRect(0, 0, width, height);

    // Subtle top app chrome
    sCtx.fillStyle = "#1d1717";
    sCtx.fillRect(0, 0, width, 52);
    sCtx.fillStyle = "#332828";
    sCtx.fillRect(0, 51, width, 1);

    ["#ff5f57", "#f59e0b", "#f4729b"].forEach((c, idx) => {
      sCtx.fillStyle = c;
      sCtx.beginPath();
      sCtx.arc(26 + idx * 18, 26, 6, 0, Math.PI * 2);
      sCtx.fill();
    });

    sCtx.fillStyle = "#f7f1ee";
    sCtx.font = "600 15px Inter, system-ui, sans-serif";
    sCtx.fillText("RecordFlow Studio — Interactive Demo Workspace", 92, 31);

    // Left sidebar
    sCtx.fillStyle = "#181313";
    sCtx.fillRect(0, 52, 230, height - 52);
    const navItems = ["Overview", "Analytics", "Productions", "Recordings", "Studio Prefs"];
    navItems.forEach((label, i) => {
      const active = (t > 1.5 && i === 1) || (t <= 1.5 && i === 0);
      sCtx.fillStyle = active ? "rgba(255, 107, 74, 0.18)" : "transparent";
      sCtx.beginPath();
      sCtx.roundRect(14, 76 + i * 44, 202, 34, 8);
      sCtx.fill();
      sCtx.fillStyle = active ? "#ff8366" : "#b8a6a4";
      sCtx.font = active ? "600 14px Inter, sans-serif" : "500 14px Inter, sans-serif";
      sCtx.fillText(label, 30, 98 + i * 44);
    });

    // Main dashboard cards
    sCtx.fillStyle = "#faf4f0";
    sCtx.font = "700 26px Inter, sans-serif";
    sCtx.fillText(t > 1.5 ? "Live Studio Telemetry" : "Workspace Overview", 268, 114);
    sCtx.fillStyle = "#bfaead";
    sCtx.font = "400 14px Inter, sans-serif";
    sCtx.fillText("Automatic click tracking & hardware-accelerated 60 fps pipeline", 268, 140);

    // Three metric tiles
    const cards = [
      { title: "Capture Rate", val: "60.0 fps", accent: "#ff6b4a" },
      { title: "Audio Sync", val: "48 kHz AAC", accent: "#f59e0b" },
      { title: "Render Mode", val: "100% Local", accent: "#f4729b" },
    ];
    cards.forEach((c, i) => {
      const x = 268 + i * 324;
      const y = 172;
      const highlight = i === 0 && t > 1.4 && t < 3.4;
      sCtx.fillStyle = highlight ? "#2b1e1c" : "#1e1818";
      sCtx.strokeStyle = highlight ? "#ff6b4a" : "#332828";
      sCtx.lineWidth = highlight ? 2 : 1;
      sCtx.beginPath();
      sCtx.roundRect(x, y, 304, 130, 14);
      sCtx.fill();
      sCtx.stroke();

      sCtx.fillStyle = "#bfaead";
      sCtx.font = "500 13px Inter, sans-serif";
      sCtx.fillText(c.title, x + 22, y + 36);
      sCtx.fillStyle = "#ffffff";
      sCtx.font = "700 30px 'JetBrains Mono', monospace";
      sCtx.fillText(c.val, x + 22, y + 84);
      sCtx.fillStyle = c.accent;
      sCtx.beginPath();
      sCtx.roundRect(x + 22, y + 102, 86, 5, 3);
      sCtx.fill();
    });

    // Animated chart panel
    sCtx.fillStyle = "#1e1818";
    sCtx.strokeStyle = "#332828";
    sCtx.lineWidth = 1;
    sCtx.beginPath();
    sCtx.roundRect(268, 326, 952, 340, 16);
    sCtx.fill();
    sCtx.stroke();

    sCtx.fillStyle = "#f7f1ee";
    sCtx.font = "600 16px Inter, sans-serif";
    sCtx.fillText("Frame Encoding Throughput", 296, 366);

    // Animated bars (warm coral & amber gold)
    for (let i = 0; i < 20; i++) {
      const bx = 296 + i * 44;
      const wave = 0.45 + 0.4 * Math.sin(t * 2.2 + i * 0.45);
      const bh = Math.round(wave * 220);
      const selected = t > 3.7 && i >= 12 && i <= 15;
      sCtx.fillStyle = selected ? "#fbbf24" : "#ff6b4a";
      sCtx.beginPath();
      sCtx.roundRect(bx, 628 - bh, 28, bh, [6, 6, 0, 0]);
      sCtx.fill();
    }
  };

  const drawDemoCam = (t: number) => {
    const grad = cCtx.createLinearGradient(0, 0, camW, camH);
    grad.addColorStop(0, "#2b1d1a");
    grad.addColorStop(1, "#160f0d");
    cCtx.fillStyle = grad;
    cCtx.fillRect(0, 0, camW, camH);

    // Warm studio key light behind presenter
    const glow = cCtx.createRadialGradient(camW * 0.5, camH * 0.4, 20, camW * 0.5, camH * 0.4, camW * 0.55);
    glow.addColorStop(0, "rgba(255, 107, 74, 0.35)");
    glow.addColorStop(1, "rgba(22, 15, 13, 0)");
    cCtx.fillStyle = glow;
    cCtx.fillRect(0, 0, camW, camH);

    const bob = Math.sin(t * 2.4) * 4;
    // Shoulders
    cCtx.fillStyle = "#42322d";
    cCtx.beginPath();
    cCtx.ellipse(camW / 2, camH + 22 + bob * 0.4, 155, 118, 0, Math.PI, Math.PI * 2);
    cCtx.fill();

    // Head silhouette
    cCtx.fillStyle = "#e2c4a8";
    cCtx.beginPath();
    cCtx.arc(camW / 2, camH * 0.46 + bob, 64, 0, Math.PI * 2);
    cCtx.fill();

    // Hair cap
    cCtx.fillStyle = "#261a17";
    cCtx.beginPath();
    cCtx.arc(camW / 2, camH * 0.42 + bob, 66, Math.PI * 1.05, Math.PI * 1.95);
    cCtx.fill();

    // Subtle eyes & smile
    cCtx.fillStyle = "#241815";
    cCtx.beginPath();
    cCtx.arc(camW / 2 - 22, camH * 0.46 + bob, 5, 0, Math.PI * 2);
    cCtx.arc(camW / 2 + 22, camH * 0.46 + bob, 5, 0, Math.PI * 2);
    cCtx.fill();

    cCtx.strokeStyle = "#7c5540";
    cCtx.lineWidth = 3.5;
    cCtx.lineCap = "round";
    cCtx.beginPath();
    cCtx.arc(camW / 2, camH * 0.52 + bob, 18, 0.15 * Math.PI, 0.85 * Math.PI);
    cCtx.stroke();

    // Small live badge
    cCtx.fillStyle = "rgba(24, 16, 15, 0.72)";
    cCtx.beginPath();
    cCtx.roundRect(14, 14, 112, 26, 13);
    cCtx.fill();
    cCtx.fillStyle = "#f59e0b";
    cCtx.beginPath();
    cCtx.arc(28, 27, 4.5, 0, Math.PI * 2);
    cCtx.fill();
    cCtx.fillStyle = "#f7f1ee";
    cCtx.font = "600 11px Inter, sans-serif";
    cCtx.fillText("CAM LAYER", 40, 31);
  };

  const realRecordMs = Math.min(3000, durationSec * 500);
  drawDemoScreen(0);
  drawDemoCam(0);

  screenRec.start(200);
  camRec.start(200);

  await new Promise<void>((resolve) => {
    const start = performance.now();
    const tick = () => {
      const elapsedMs = performance.now() - start;
      const t = (elapsedMs / realRecordMs) * durationSec;
      drawDemoScreen(Math.min(durationSec, t));
      drawDemoCam(Math.min(durationSec, t));
      if (elapsedMs < realRecordMs) {
        window.requestAnimationFrame(tick);
      } else {
        resolve();
      }
    };
    window.requestAnimationFrame(tick);
  });

  const screenBlob = await new Promise<Blob>((resolve) => {
    screenRec.onstop = () => resolve(new Blob(screenChunks, { type: mimeType }));
    screenRec.stop();
  });

  const camBlob = await new Promise<Blob>((resolve) => {
    camRec.onstop = () => resolve(new Blob(camChunks, { type: mimeType }));
    camRec.stop();
  });

  const actualDuration = realRecordMs / 1000;
  const scaleT = actualDuration / durationSec;
  const cursorTrack: CursorTrackData = {
    version: 1,
    width,
    height,
    samples: samples.map((s) => ({ ...s, t: s.t * scaleT })),
    clicks: clicks.map((c) => ({ ...c, t: c.t * scaleT })),
  };

  return createDefaultProject({
    name: "Studio Demo Recording",
    screenUrl: URL.createObjectURL(screenBlob),
    screenPath: null,
    cameraUrl: URL.createObjectURL(camBlob),
    cameraPath: null,
    duration: actualDuration,
    sourceWidth: width,
    sourceHeight: height,
    cursorTrack,
    waveform: generateSyntheticWaveform(96),
    isDemo: true,
  });
}
