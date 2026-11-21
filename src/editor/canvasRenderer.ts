import { getBackgroundById } from "./backgrounds";
import type {
  AspectRatioId,
  BlurRegion,
  CameraOverlayConfig,
  CameraSnapPreset,
  CursorTrackData,
  EditorProject,
  ZoomIntensityPreset,
  ZoomKeyframe,
} from "../types";

export const ZOOM_PRESET_SCALES: Record<ZoomIntensityPreset, number> = {
  subtle: 1.35,
  balanced: 1.75,
  close: 2.25,
};

export interface CanvasGeometry {
  canvasW: number;
  canvasH: number;
  frameX: number;
  frameY: number;
  frameW: number;
  frameH: number;
  cameraRect: { x: number; y: number; w: number; h: number } | null;
}

export interface RenderSources {
  screenVideo: HTMLVideoElement | HTMLCanvasElement | null;
  cameraVideo: HTMLVideoElement | HTMLCanvasElement | null;
  customBgImage: HTMLImageElement | null;
}

// ============================================================================
// Offscreen caches for static background, frame drop-shadow, camera shadow,
// and fast downsampled privacy blur (eliminates per-frame Gaussian blur cost)
// ============================================================================
let cachedBackdropCanvas: HTMLCanvasElement | null = null;
let cachedBackdropKey = "";

let cachedCamShadowCanvas: HTMLCanvasElement | null = null;
let cachedCamShadowKey = "";
let cachedCamShadowPad = 0;

let blurScratchCanvas: HTMLCanvasElement | null = null;

function renderCachedBackdrop(
  project: EditorProject,
  geom: CanvasGeometry,
  radius: number,
  shadowStrength: number,
  customBgImage: HTMLImageElement | null,
): HTMLCanvasElement | null {
  if (typeof document === "undefined") return null;
  const { canvasW, canvasH, frameX, frameY, frameW, frameH } = geom;
  const customReady = Boolean(
    project.canvas.customBackgroundUrl &&
      customBgImage &&
      customBgImage.complete &&
      customBgImage.naturalWidth > 0,
  );
  const key = [
    canvasW,
    canvasH,
    project.canvas.backgroundId,
    customReady ? project.canvas.customBackgroundUrl : "",
    frameX.toFixed(1),
    frameY.toFixed(1),
    frameW.toFixed(1),
    frameH.toFixed(1),
    radius.toFixed(1),
    shadowStrength.toFixed(3),
  ].join("|");

  if (cachedBackdropCanvas && cachedBackdropKey === key) {
    return cachedBackdropCanvas;
  }

  if (!cachedBackdropCanvas) {
    cachedBackdropCanvas = document.createElement("canvas");
  }
  if (cachedBackdropCanvas.width !== canvasW || cachedBackdropCanvas.height !== canvasH) {
    cachedBackdropCanvas.width = canvasW;
    cachedBackdropCanvas.height = canvasH;
  }

  const bCtx = cachedBackdropCanvas.getContext("2d", { alpha: false });
  if (!bCtx) return null;

  bCtx.clearRect(0, 0, canvasW, canvasH);

  // 1. Background (Custom image or curated preset)
  if (customReady && customBgImage) {
    drawCoverImage(
      bCtx,
      customBgImage,
      customBgImage.naturalWidth,
      customBgImage.naturalHeight,
      0,
      0,
      canvasW,
      canvasH,
    );
  } else {
    const bg = getBackgroundById(project.canvas.backgroundId);
    bg.draw(bCtx, canvasW, canvasH);
  }

  // 2. Presentation frame drop shadow (rasterized once into the backdrop cache)
  if (shadowStrength > 0.01) {
    bCtx.save();
    bCtx.shadowColor = `rgba(0, 0, 0, ${(0.55 * shadowStrength).toFixed(3)})`;
    bCtx.shadowBlur = Math.round(54 * shadowStrength * (canvasW / 1280));
    bCtx.shadowOffsetY = Math.round(22 * shadowStrength * (canvasH / 720));
    bCtx.fillStyle = "#100c0c";
    bCtx.beginPath();
    bCtx.roundRect(frameX, frameY, frameW, frameH, radius);
    bCtx.fill();
    bCtx.restore();
  }

  cachedBackdropKey = key;
  return cachedBackdropCanvas;
}

function getCachedCameraShadow(
  w: number,
  h: number,
  r: number,
  shadowPct: number,
): { canvas: HTMLCanvasElement; pad: number } | null {
  if (typeof document === "undefined" || shadowPct <= 0) return null;
  const rw = Math.round(w);
  const rh = Math.round(h);
  const rr = Number(r.toFixed(1));
  const key = `${rw}x${rh}|${rr}|${shadowPct}`;

  if (cachedCamShadowCanvas && cachedCamShadowKey === key) {
    return { canvas: cachedCamShadowCanvas, pad: cachedCamShadowPad };
  }

  const blur = Math.round(32 * (shadowPct / 100));
  const offsetY = Math.round(10 * (shadowPct / 100));
  const pad = blur + Math.abs(offsetY) + 8;
  const cw = rw + pad * 2;
  const ch = rh + pad * 2;

  if (!cachedCamShadowCanvas) {
    cachedCamShadowCanvas = document.createElement("canvas");
  }
  cachedCamShadowCanvas.width = cw;
  cachedCamShadowCanvas.height = ch;

  const sCtx = cachedCamShadowCanvas.getContext("2d");
  if (!sCtx) return null;

  sCtx.clearRect(0, 0, cw, ch);
  sCtx.save();
  sCtx.shadowColor = `rgba(0, 0, 0, ${(0.55 * (shadowPct / 100)).toFixed(3)})`;
  sCtx.shadowBlur = blur;
  sCtx.shadowOffsetY = offsetY;
  sCtx.fillStyle = "#000000";
  sCtx.beginPath();
  sCtx.roundRect(pad, pad, rw, rh, rr);
  sCtx.fill();
  sCtx.restore();

  cachedCamShadowKey = key;
  cachedCamShadowPad = pad;
  return { canvas: cachedCamShadowCanvas, pad };
}

export function getAspectDimensions(
  aspectRatio: AspectRatioId,
  sourceWidth: number,
  sourceHeight: number,
  targetLongSide = 1920,
): { width: number; height: number } {
  let ratio = sourceWidth / Math.max(1, sourceHeight);
  switch (aspectRatio) {
    case "16:9":
      ratio = 16 / 9;
      break;
    case "9:16":
      ratio = 9 / 16;
      break;
    case "1:1":
      ratio = 1;
      break;
    case "4:5":
      ratio = 4 / 5;
      break;
    case "original":
    default:
      ratio = sourceWidth / Math.max(1, sourceHeight);
      break;
  }

  let width: number;
  let height: number;
  if (ratio >= 1) {
    width = targetLongSide;
    height = Math.round(targetLongSide / ratio);
  } else {
    height = targetLongSide;
    width = Math.round(targetLongSide * ratio);
  }

  // Ensure even dimensions for H.264 / VP9 encoding
  width = Math.max(16, width - (width % 2));
  height = Math.max(16, height - (height % 2));
  return { width, height };
}

export function computeCameraRect(
  camera: CameraOverlayConfig,
  canvasW: number,
  canvasH: number,
  camSourceRatio = 4 / 3,
): { x: number; y: number; w: number; h: number } {
  const base = Math.min(canvasW, canvasH) * camera.scale;
  const isSquare = camera.shape === "circle" || camera.shape === "square";
  const w = isSquare ? base : base * Math.max(1, Math.min(1.6, camSourceRatio));
  const h = isSquare ? base : base;
  const cx = camera.x * canvasW;
  const cy = camera.y * canvasH;
  const x = Math.max(8, Math.min(canvasW - w - 8, cx - w / 2));
  const y = Math.max(8, Math.min(canvasH - h - 8, cy - h / 2));
  return { x, y, w, h };
}

export function getSnapPosition(preset: CameraSnapPreset): { x: number; y: number } {
  switch (preset) {
    case "top-left":
      return { x: 0.14, y: 0.18 };
    case "top-right":
      return { x: 0.86, y: 0.18 };
    case "bottom-left":
      return { x: 0.14, y: 0.82 };
    case "bottom-right":
      return { x: 0.86, y: 0.82 };
    case "center-bottom":
      return { x: 0.5, y: 0.84 };
    case "center-left":
      return { x: 0.14, y: 0.5 };
    case "center-right":
      return { x: 0.86, y: 0.5 };
  }
}

function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

/** Evaluate smooth camera zoom/pan at time `t` across all zoom keyframes. */
export function evaluateZoomAtTime(
  zooms: ZoomKeyframe[],
  time: number,
): { scale: number; focusX: number; focusY: number } {
  let bestScale = 1;
  let bestX = 0.5;
  let bestY = 0.5;

  for (const kf of zooms) {
    const end = kf.start + kf.duration;
    if (time < kf.start || time > end || kf.duration <= 0) continue;

    const ramp = Math.min(0.45, kf.duration * 0.28);
    let weight = 1;
    if (time - kf.start < ramp) {
      weight = easeInOutCubic(Math.max(0, (time - kf.start) / Math.max(0.01, ramp)));
    } else if (end - time < ramp) {
      weight = easeInOutCubic(Math.max(0, (end - time) / Math.max(0.01, ramp)));
    }

    const s = 1 + (kf.scale - 1) * weight;
    if (s > bestScale) {
      bestScale = s;
      bestX = 0.5 + (kf.focusX - 0.5) * weight;
      bestY = 0.5 + (kf.focusY - 0.5) * weight;
    }
  }

  return { scale: bestScale, focusX: bestX, focusY: bestY };
}

/** Sample interpolated cursor position at `time` from a CursorTrackData recording. */
export function sampleCursorAtTime(
  track: CursorTrackData | null,
  time: number,
  smooth: boolean,
): { x: number; y: number } | null {
  if (!track || track.samples.length === 0) return null;
  const samples = track.samples;
  if (time <= samples[0].t) return { x: samples[0].x, y: samples[0].y };
  const last = samples[samples.length - 1];
  if (time >= last.t) return { x: last.x, y: last.y };

  let lo = 0;
  let hi = samples.length - 1;
  while (lo + 1 < hi) {
    const mid = (lo + hi) >> 1;
    if (samples[mid].t <= time) lo = mid;
    else hi = mid;
  }

  const a = samples[lo];
  const b = samples[hi];
  const dt = Math.max(0.0001, b.t - a.t);
  let f = Math.max(0, Math.min(1, (time - a.t) / dt));
  if (smooth) {
    f = f * f * (3 - 2 * f);
  }
  return {
    x: a.x + (b.x - a.x) * f,
    y: a.y + (b.y - a.y) * f,
  };
}

/** Calculate presentation frame layout inside the composition canvas. */
export function computeCanvasGeometry(
  project: EditorProject,
  canvasW: number,
  canvasH: number,
  hasCamera: boolean,
): CanvasGeometry {
  const padPx = (project.canvas.padding / 100) * Math.min(canvasW, canvasH);
  const availW = Math.max(32, canvasW - padPx * 2);
  const availH = Math.max(32, canvasH - padPx * 2);

  const srcRatio = Math.max(0.2, project.sourceWidth / Math.max(1, project.sourceHeight));
  let frameW: number;
  let frameH: number;

  if (project.canvas.framing === "fill") {
    frameW = availW;
    frameH = availH;
  } else {
    const availRatio = availW / availH;
    if (srcRatio > availRatio) {
      frameW = availW;
      frameH = availW / srcRatio;
    } else {
      frameH = availH;
      frameW = availH * srcRatio;
    }
  }

  const frameX = (canvasW - frameW) / 2;
  const frameY = (canvasH - frameH) / 2;

  const cameraRect =
    hasCamera && project.camera.enabled
      ? computeCameraRect(project.camera, canvasW, canvasH)
      : null;

  return { canvasW, canvasH, frameX, frameY, frameW, frameH, cameraRect };
}

function drawCoverImage(
  ctx: CanvasRenderingContext2D,
  img: CanvasImageSource,
  srcW: number,
  srcH: number,
  dstX: number,
  dstY: number,
  dstW: number,
  dstH: number,
) {
  const srcRatio = srcW / Math.max(1, srcH);
  const dstRatio = dstW / Math.max(1, dstH);
  let sx = 0;
  let sy = 0;
  let sw = srcW;
  let sh = srcH;

  if (srcRatio > dstRatio) {
    sw = srcH * dstRatio;
    sx = (srcW - sw) / 2;
  } else {
    sh = srcW / dstRatio;
    sy = (srcH - sh) / 2;
  }

  ctx.drawImage(img, sx, sy, sw, sh, dstX, dstY, dstW, dstH);
}

/**
 * Deterministic composition renderer shared by the real-time Edit canvas AND
 * the Local Export Engine (ensuring 100% WYSIWYG export fidelity at maximum speed).
 */
export function renderCompositionFrame(
  ctx: CanvasRenderingContext2D,
  project: EditorProject,
  time: number,
  sources: RenderSources,
  options?: {
    selectedBlurId?: string | null;
    selectedZoomId?: string | null;
    showGuides?: boolean;
  },
): CanvasGeometry {
  const canvasW = ctx.canvas.width;
  const canvasH = ctx.canvas.height;
  const hasCamera = Boolean(sources.cameraVideo);
  const geom = computeCanvasGeometry(project, canvasW, canvasH, hasCamera);

  const radius = Math.min(
    (project.canvas.cornerRadius / 1080) * Math.min(canvasW, canvasH) * 1.15,
    Math.min(geom.frameW, geom.frameH) / 4,
  );
  const shadowStrength = project.canvas.shadow / 100;

  ctx.save();

  // 1 & 2. Draw cached static background + presentation frame drop shadow in one blit
  const cachedBackdrop = renderCachedBackdrop(
    project,
    geom,
    radius,
    shadowStrength,
    sources.customBgImage,
  );
  if (cachedBackdrop) {
    ctx.drawImage(cachedBackdrop, 0, 0);
  } else {
    ctx.clearRect(0, 0, canvasW, canvasH);
    const bg = getBackgroundById(project.canvas.backgroundId);
    bg.draw(ctx, canvasW, canvasH);
  }

  // 3. Clipped Screen Video + Zoom + Blur Regions + Cursor Overlay
  ctx.save();
  ctx.beginPath();
  ctx.roundRect(geom.frameX, geom.frameY, geom.frameW, geom.frameH, radius);
  ctx.clip();

  // Warm dark backing inside frame
  ctx.fillStyle = "#120d0d";
  ctx.fillRect(geom.frameX, geom.frameY, geom.frameW, geom.frameH);

  const zoom = evaluateZoomAtTime(project.zooms, time);

  // Apply zoom around focus point within presentation frame
  const pivotX = geom.frameX + zoom.focusX * geom.frameW;
  const pivotY = geom.frameY + zoom.focusY * geom.frameH;

  ctx.save();
  if (Math.abs(zoom.scale - 1) > 0.001) {
    ctx.translate(pivotX, pivotY);
    ctx.scale(zoom.scale, zoom.scale);
    ctx.translate(-pivotX, -pivotY);
  }

  // Draw screen source
  const screenSrc = sources.screenVideo;
  if (screenSrc) {
    const sw = screenSrc instanceof HTMLVideoElement ? screenSrc.videoWidth : screenSrc.width;
    const sh = screenSrc instanceof HTMLVideoElement ? screenSrc.videoHeight : screenSrc.height;
    if (sw > 0 && sh > 0) {
      if (project.canvas.framing === "fill") {
        drawCoverImage(ctx, screenSrc, sw, sh, geom.frameX, geom.frameY, geom.frameW, geom.frameH);
      } else {
        ctx.drawImage(screenSrc, geom.frameX, geom.frameY, geom.frameW, geom.frameH);
      }
    }
  }

  // Draw active Blur/Redact regions
  for (const blur of project.blurs) {
    const active = blur.alwaysVisible || (time >= blur.startTime && time <= blur.endTime);
    if (!active) continue;
    drawBlurRegion(
      ctx,
      screenSrc,
      geom,
      blur,
      options?.showGuides && options?.selectedBlurId === blur.id,
    );
  }

  // Draw Cursor & Click Ripples (from CursorTrackData)
  if (project.cursor.enabled && project.cursorTrack) {
    drawCursorOverlay(ctx, project, geom, time);
  }

  ctx.restore(); // end zoom transform

  // Crisp subtle inner rim border on the video card
  ctx.strokeStyle = "rgba(255, 255, 255, 0.14)";
  ctx.lineWidth = Math.max(1, canvasW / 1280);
  ctx.beginPath();
  ctx.roundRect(geom.frameX, geom.frameY, geom.frameW, geom.frameH, radius);
  ctx.stroke();

  ctx.restore(); // end frame clip

  // Optional focus target guide when user is editing a zoom keyframe in the studio
  if (options?.showGuides && options.selectedZoomId) {
    const kf = project.zooms.find((z) => z.id === options.selectedZoomId);
    if (kf) {
      const fx = geom.frameX + kf.focusX * geom.frameW;
      const fy = geom.frameY + kf.focusY * geom.frameH;
      ctx.save();
      ctx.strokeStyle = "#ff6b4a";
      ctx.lineWidth = 2;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.arc(fx, fy, 18, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = "#ff6b4a";
      ctx.beginPath();
      ctx.arc(fx, fy, 4, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }

  // 4. Independent Webcam Layer (drawn on top of canvas so it stays sharp and draggable anywhere)
  if (geom.cameraRect && sources.cameraVideo) {
    drawCameraOverlay(ctx, project.camera, sources.cameraVideo, geom.cameraRect);
  }

  ctx.restore();
  return geom;
}

function drawBlurRegion(
  ctx: CanvasRenderingContext2D,
  screenSrc: HTMLVideoElement | HTMLCanvasElement | null,
  geom: CanvasGeometry,
  blur: BlurRegion,
  isSelected?: boolean,
) {
  const bx = geom.frameX + blur.x * geom.frameW;
  const by = geom.frameY + blur.y * geom.frameH;
  const bw = Math.max(12, blur.width * geom.frameW);
  const bh = Math.max(12, blur.height * geom.frameH);
  const br = Math.min(10, Math.min(bw, bh) * 0.18);

  ctx.save();
  ctx.beginPath();
  ctx.roundRect(bx, by, bw, bh, br);
  ctx.clip();

  if (screenSrc && typeof document !== "undefined") {
    const sw = screenSrc instanceof HTMLVideoElement ? screenSrc.videoWidth : screenSrc.width;
    const sh = screenSrc instanceof HTMLVideoElement ? screenSrc.videoHeight : screenSrc.height;
    if (sw > 0 && sh > 0) {
      // Fast hardware-accelerated downscale-upscale blur on ONLY the cropped region
      const downFactor = Math.max(6, Math.min(28, Math.round(blur.intensity * 0.85)));
      const smallW = Math.max(8, Math.round(bw / downFactor));
      const smallH = Math.max(8, Math.round(bh / downFactor));

      if (!blurScratchCanvas) {
        blurScratchCanvas = document.createElement("canvas");
      }
      if (blurScratchCanvas.width < smallW || blurScratchCanvas.height < smallH) {
        blurScratchCanvas.width = Math.max(smallW, 128);
        blurScratchCanvas.height = Math.max(smallH, 128);
      }
      const sCtx = blurScratchCanvas.getContext("2d");
      if (sCtx) {
        sCtx.imageSmoothingEnabled = true;
        sCtx.imageSmoothingQuality = "medium";
        const sx = blur.x * sw;
        const sy = blur.y * sh;
        const sWidth = Math.max(4, blur.width * sw);
        const sHeight = Math.max(4, blur.height * sh);
        sCtx.clearRect(0, 0, smallW, smallH);
        sCtx.drawImage(screenSrc, sx, sy, sWidth, sHeight, 0, 0, smallW, smallH);
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = "high";
        ctx.drawImage(blurScratchCanvas, 0, 0, smallW, smallH, bx, by, bw, bh);
      }
    }
  }

  // Subtle frosted tint so blurred areas stay clean even on dark/flat regions
  ctx.fillStyle = "rgba(26, 18, 18, 0.24)";
  ctx.fillRect(bx, by, bw, bh);
  ctx.restore();

  if (isSelected) {
    ctx.save();
    ctx.strokeStyle = "#ff6b4a";
    ctx.lineWidth = 2;
    ctx.setLineDash([5, 4]);
    ctx.beginPath();
    ctx.roundRect(bx, by, bw, bh, br);
    ctx.stroke();
    ctx.restore();
  }
}

function drawCursorOverlay(
  ctx: CanvasRenderingContext2D,
  project: EditorProject,
  geom: CanvasGeometry,
  time: number,
) {
  const track = project.cursorTrack;
  if (!track) return;

  const scaleFactor = geom.frameW / 1280;

  // Click ripples (last 0.45s)
  if (project.cursor.clickRipple) {
    for (const click of track.clicks) {
      const age = time - click.t;
      if (age < 0 || age > 0.45) continue;
      const p = age / 0.45;
      const cx = geom.frameX + click.x * geom.frameW;
      const cy = geom.frameY + click.y * geom.frameH;
      const radius = (10 + p * 34) * scaleFactor * project.cursor.scale;
      ctx.save();
      ctx.strokeStyle = project.cursor.rippleColor;
      ctx.globalAlpha = (1 - p) * 0.85;
      ctx.lineWidth = Math.max(2, 3 * scaleFactor);
      ctx.beginPath();
      ctx.arc(cx, cy, radius, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
  }

  const pos = sampleCursorAtTime(track, time, project.cursor.smoothMotion);
  if (!pos || pos.x < -0.05 || pos.x > 1.05 || pos.y < -0.05 || pos.y > 1.05) return;

  const cx = geom.frameX + pos.x * geom.frameW;
  const cy = geom.frameY + pos.y * geom.frameH;
  const sz = 20 * scaleFactor * project.cursor.scale;

  // Highlight halo
  if (project.cursor.highlightHalo) {
    ctx.save();
    const halo = ctx.createRadialGradient(cx, cy, 0, cx, cy, sz * 1.7);
    halo.addColorStop(0, "rgba(250, 204, 21, 0.34)");
    halo.addColorStop(1, "rgba(250, 204, 21, 0)");
    ctx.fillStyle = halo;
    ctx.beginPath();
    ctx.arc(cx, cy, sz * 1.7, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  // Crisp studio pointer arrow
  ctx.save();
  ctx.translate(cx, cy);

  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(0, sz * 1.05);
  ctx.lineTo(sz * 0.28, sz * 0.78);
  ctx.lineTo(sz * 0.48, sz * 1.18);
  ctx.lineTo(sz * 0.65, sz * 1.09);
  ctx.lineTo(sz * 0.45, sz * 0.7);
  ctx.lineTo(sz * 0.82, sz * 0.68);
  ctx.closePath();

  ctx.fillStyle = "#ffffff";
  ctx.fill();
  ctx.lineWidth = Math.max(1.2, 1.8 * scaleFactor);
  ctx.strokeStyle = "#161111";
  ctx.stroke();
  ctx.restore();
}

function drawCameraOverlay(
  ctx: CanvasRenderingContext2D,
  camera: CameraOverlayConfig,
  camSrc: HTMLVideoElement | HTMLCanvasElement,
  rect: { x: number; y: number; w: number; h: number },
) {
  const sw = camSrc instanceof HTMLVideoElement ? camSrc.videoWidth : camSrc.width;
  const sh = camSrc instanceof HTMLVideoElement ? camSrc.videoHeight : camSrc.height;
  if (sw <= 0 || sh <= 0) return;

  const r =
    camera.shape === "circle"
      ? Math.min(rect.w, rect.h) / 2
      : camera.shape === "square"
        ? 4
        : Math.min(
            (camera.cornerRadius / 100) * Math.min(rect.w, rect.h) * 0.5,
            Math.min(rect.w, rect.h) / 2,
          );

  ctx.save();
  ctx.globalAlpha = camera.opacity;

  // Cached drop shadow behind camera bubble
  if (camera.shadow > 0) {
    const cachedShadow = getCachedCameraShadow(rect.w, rect.h, r, camera.shadow);
    if (cachedShadow) {
      ctx.drawImage(
        cachedShadow.canvas,
        Math.round(rect.x) - cachedShadow.pad,
        Math.round(rect.y) - cachedShadow.pad,
      );
    }
  }

  // Clipped webcam video
  ctx.save();
  ctx.beginPath();
  ctx.roundRect(rect.x, rect.y, rect.w, rect.h, r);
  ctx.clip();

  if (camera.mirror) {
    ctx.translate(rect.x + rect.w, rect.y);
    ctx.scale(-1, 1);
    drawCoverImage(ctx, camSrc, sw, sh, 0, 0, rect.w, rect.h);
  } else {
    drawCoverImage(ctx, camSrc, sw, sh, rect.x, rect.y, rect.w, rect.h);
  }
  ctx.restore();

  // Optional border ring
  if (camera.borderWidth > 0) {
    ctx.strokeStyle = camera.borderColor;
    ctx.lineWidth = camera.borderWidth;
    ctx.beginPath();
    ctx.roundRect(rect.x, rect.y, rect.w, rect.h, r);
    ctx.stroke();
  }

  ctx.restore();
}

/** Generate auto-zoom keyframes clustered around real mouse click interactions. */
export function generateAutoZoomsFromClicks(
  track: CursorTrackData | null,
  duration: number,
  intensity: ZoomIntensityPreset = "balanced",
): ZoomKeyframe[] {
  if (!track || track.clicks.length === 0) return [];
  const scale = ZOOM_PRESET_SCALES[intensity];
  const keyframes: ZoomKeyframe[] = [];
  const minGap = 2.8;

  for (const click of track.clicks) {
    if (click.x < 0 || click.x > 1 || click.y < 0 || click.y > 1) continue;
    const prev = keyframes[keyframes.length - 1];
    if (prev && click.t - prev.start < minGap) continue;
    const start = Math.max(0, click.t - 0.35);
    const dur = Math.min(2.4, Math.max(0.8, duration - start));
    if (dur < 0.7) continue;
    keyframes.push({
      id: `zk-${Math.random().toString(36).slice(2, 8)}`,
      start: Number(start.toFixed(2)),
      duration: Number(dur.toFixed(2)),
      scale,
      focusX: Math.max(0.12, Math.min(0.88, click.x)),
      focusY: Math.max(0.12, Math.min(0.88, click.y)),
      intensity,
    });
  }
  return keyframes.slice(0, 8);
}

/** Create a fresh default EditorProject from captured media. */
export function createDefaultProject(params: {
  name: string;
  screenUrl: string;
  screenPath: string | null;
  cameraUrl: string | null;
  cameraPath: string | null;
  duration: number;
  sourceWidth: number;
  sourceHeight: number;
  cursorTrack: CursorTrackData | null;
  waveform?: number[];
  isDemo?: boolean;
}): EditorProject {
  const duration = Math.max(0.5, params.duration);
  const autoZooms = generateAutoZoomsFromClicks(params.cursorTrack, duration, "balanced");
  return {
    version: 2,
    id: `proj-${Date.now().toString(36)}`,
    name: params.name,
    createdAt: new Date().toISOString(),
    screenUrl: params.screenUrl,
    screenPath: params.screenPath,
    cameraUrl: params.cameraUrl,
    cameraPath: params.cameraPath,
    duration,
    sourceWidth: params.sourceWidth,
    sourceHeight: params.sourceHeight,
    trimStart: 0,
    trimEnd: duration,
    canvas: {
      aspectRatio: "16:9",
      framing: "fit",
      backgroundId: "aurora-indigo",
      customBackgroundUrl: null,
      padding: 6,
      cornerRadius: 16,
      shadow: 65,
    },
    camera: {
      enabled: Boolean(params.cameraUrl),
      x: 0.86,
      y: 0.82,
      scale: 0.24,
      shape: "circle",
      cornerRadius: 24,
      mirror: true,
      borderWidth: 3,
      borderColor: "#ffffff",
      shadow: 60,
      opacity: 1,
    },
    cursor: {
      enabled: Boolean(params.cursorTrack && params.cursorTrack.samples.length > 0),
      scale: 1.15,
      clickRipple: true,
      rippleColor: "#ff6b4a",
      highlightHalo: false,
      smoothMotion: true,
    },
    audio: {
      micVolume: 1,
      micMuted: false,
      systemVolume: 0.85,
      systemMuted: false,
      masterVolume: 1,
      fadeIn: false,
      fadeOut: false,
    },
    zooms: autoZooms,
    blurs: [],
    cursorTrack: params.cursorTrack,
    waveform: params.waveform ?? generateSyntheticWaveform(96),
    isDemo: params.isDemo,
  };
}

export function generateSyntheticWaveform(bars = 96): number[] {
  const out: number[] = [];
  for (let i = 0; i < bars; i++) {
    const t = i / bars;
    const v =
      0.22 +
      Math.abs(Math.sin(t * 21.3 + 0.5)) * 0.42 +
      Math.abs(Math.cos(t * 7.8)) * 0.22 +
      ((i * 17) % 10) * 0.014;
    out.push(Math.min(1, Math.max(0.08, v)));
  }
  return out;
}

/** Extract real waveform peaks from a video/audio URL when decodable; falls back gracefully. */
export async function extractWaveformFromUrl(url: string, bars = 96): Promise<number[]> {
  try {
    const AudioCtx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return generateSyntheticWaveform(bars);
    const res = await fetch(url);
    const buf = await res.arrayBuffer();
    const ctx = new AudioCtx();
    const decoded = await ctx.decodeAudioData(buf.slice(0));
    const channel = decoded.getChannelData(0);
    const blockSize = Math.max(1, Math.floor(channel.length / bars));
    const peaks: number[] = [];
    let maxPeak = 0.01;
    for (let i = 0; i < bars; i++) {
      let peak = 0;
      const start = i * blockSize;
      const end = Math.min(channel.length, start + blockSize);
      for (let j = start; j < end; j += 16) {
        const v = Math.abs(channel[j]);
        if (v > peak) peak = v;
      }
      peaks.push(peak);
      if (peak > maxPeak) maxPeak = peak;
    }
    void ctx.close();
    return peaks.map((p) => Math.max(0.08, p / maxPeak));
  } catch {
    return generateSyntheticWaveform(bars);
  }
}
