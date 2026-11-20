import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { tauriService } from "../services/tauri.service";
import type { CameraInfo, CameraPosition, CameraShape, CameraSize } from "../types";
import { CameraIcon, FlipIcon } from "./Icons";
import { SectionWrapper, ToggleSwitch } from "./SectionWrapper";

type Props = {
  cameraEnabled: boolean;
  onToggle: (enabled: boolean) => void;
  selectedCamera: string;
  onCameraChange: (index: string) => void;
  selectedPosition: CameraPosition;
  onPositionChange: (position: CameraPosition) => void;
  selectedSize: CameraSize;
  onSizeChange: (size: CameraSize) => void;
  selectedShape: CameraShape;
  onShapeChange: (shape: CameraShape) => void;
  cameraMirror: boolean;
  onMirrorChange: (mirror: boolean) => void;
  isRecording?: boolean;
};

const POSITIONS: { value: CameraPosition; label: string; short: string }[] = [
  { value: "TopLeft", label: "Top Left", short: "TL" },
  { value: "TopRight", label: "Top Right", short: "TR" },
  { value: "BottomLeft", label: "Bottom Left", short: "BL" },
  { value: "BottomRight", label: "Bottom Right", short: "BR" },
];

const SIZES: CameraSize[] = ["Small", "Medium", "Large"];
const SHAPES: { value: CameraShape; label: string }[] = [
  { value: "Rectangle", label: "Rect" },
  { value: "Rounded", label: "Rounded" },
  { value: "Circle", label: "Circle" },
];

export function CameraSettings({
  cameraEnabled,
  onToggle,
  selectedCamera,
  onCameraChange,
  selectedPosition,
  onPositionChange,
  selectedSize,
  onSizeChange,
  selectedShape,
  onShapeChange,
  cameraMirror,
  onMirrorChange,
  isRecording = false,
}: Props) {
  const [cameras, setCameras] = useState<CameraInfo[]>([]);
  const [browserDevices, setBrowserDevices] = useState<MediaDeviceInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setLoading(true);
        setError(null);
        const list = await tauriService.getCameras();
        if (!cancelled) setCameras(list);
      } catch (e) {
        if (!cancelled) setError(String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!cameraEnabled) return;
    let cancelled = false;
    const enumerateDevices = async () => {
      try {
        if (!navigator.mediaDevices?.enumerateDevices) return;
        const devices = await navigator.mediaDevices.enumerateDevices();
        const videoDevices = devices.filter((d) => d.kind === "videoinput");
        if (!cancelled) setBrowserDevices(videoDevices);
      } catch {
        // Ignore when browser blocks enumeration before permission
      }
    };
    void enumerateDevices();
    return () => {
      cancelled = true;
    };
  }, [cameraEnabled]);

  const stopPreview = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    setPreviewError(null);
  }, []);

  useEffect(() => {
    if (!cameraEnabled || isRecording) {
      stopPreview();
      return;
    }

    let cancelled = false;
    const startPreview = async () => {
      try {
        stopPreview();
        setPreviewError(null);
        if (!navigator.mediaDevices?.getUserMedia) {
          setPreviewError("Camera preview unavailable");
          return;
        }
        const cameraIndex = Number.parseInt(selectedCamera || "0", 10);
        const deviceId =
          Number.isFinite(cameraIndex) && browserDevices.length > cameraIndex
            ? browserDevices[cameraIndex]?.deviceId
            : undefined;

        const stream = await navigator.mediaDevices.getUserMedia({
          video: deviceId
            ? { deviceId: { exact: deviceId }, width: { ideal: 640 }, height: { ideal: 480 } }
            : { width: { ideal: 640 }, height: { ideal: 480 } },
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
        }
      } catch (e) {
        if (!cancelled) {
          setPreviewError(e instanceof Error ? e.message : String(e));
        }
      }
    };

    void startPreview();
    return () => {
      cancelled = true;
      stopPreview();
    };
  }, [cameraEnabled, selectedCamera, browserDevices, stopPreview, isRecording]);

  const cameraOptions = useMemo(
    () =>
      cameras.map((c) => ({
        value: String(c.index),
        label: c.width && c.height ? `${c.name} (${c.width}×${c.height})` : c.name,
      })),
    [cameras],
  );

  const previewRadiusClass =
    selectedShape === "Circle"
      ? "aspect-square w-36 rounded-full"
      : selectedShape === "Rounded"
        ? "aspect-video w-56 rounded-2xl"
        : "aspect-video w-56 rounded-sm";

  return (
    <SectionWrapper
      title="Camera Overlay"
      subtitle={
        cameraEnabled
          ? `Async PiP · ${selectedShape} · ${selectedPosition.replace(/([A-Z])/g, " $1").trim()}`
          : "Picture-in-picture webcam composited directly into your MP4"
      }
      icon={<CameraIcon className="h-4 w-4" />}
      headerRight={
        <ToggleSwitch
          checked={cameraEnabled}
          onChange={onToggle}
          disabled={isRecording}
          label="Enable camera overlay"
        />
      }
    >
      <div className={`flex flex-col gap-5 lg:flex-row lg:items-center ${!cameraEnabled ? "opacity-55" : ""}`}>
        <div className="flex-1 space-y-4">
          {/* Device selector */}
          <div className="space-y-1.5">
            <label className="block text-[11px] font-semibold uppercase tracking-wider text-zinc-400">
              Camera Device
            </label>
            <select
              value={cameraOptions.length === 0 ? "" : selectedCamera || cameraOptions[0]?.value || ""}
              onChange={(e) => onCameraChange(e.target.value)}
              disabled={!cameraEnabled || isRecording || loading || cameraOptions.length === 0}
              className="h-9 w-full rounded-xl border border-zinc-800 bg-zinc-950/90 px-3 text-xs text-zinc-100 focus:border-indigo-500 focus:outline-none disabled:cursor-not-allowed disabled:opacity-50"
            >
              {loading ? (
                <option>Scanning cameras...</option>
              ) : cameraOptions.length === 0 ? (
                <option>No cameras detected</option>
              ) : (
                cameraOptions.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))
              )}
            </select>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            {/* Shape */}
            <div className="space-y-1.5">
              <label className="block text-[11px] font-semibold uppercase tracking-wider text-zinc-400">
                Shape
              </label>
              <div className="grid grid-cols-3 gap-1 rounded-xl border border-zinc-800 bg-zinc-950/80 p-1">
                {SHAPES.map((s) => (
                  <button
                    key={s.value}
                    type="button"
                    disabled={!cameraEnabled || isRecording}
                    onClick={() => onShapeChange(s.value)}
                    className={`rounded-lg py-1.5 text-[11px] font-medium transition-all disabled:opacity-40 ${
                      selectedShape === s.value
                        ? "bg-zinc-800 text-white ring-1 ring-zinc-700"
                        : "text-zinc-400 hover:text-zinc-200"
                    }`}
                  >
                    {s.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Size */}
            <div className="space-y-1.5">
              <label className="block text-[11px] font-semibold uppercase tracking-wider text-zinc-400">
                Size
              </label>
              <div className="grid grid-cols-3 gap-1 rounded-xl border border-zinc-800 bg-zinc-950/80 p-1">
                {SIZES.map((sz) => (
                  <button
                    key={sz}
                    type="button"
                    disabled={!cameraEnabled || isRecording}
                    onClick={() => onSizeChange(sz)}
                    className={`rounded-lg py-1.5 text-[11px] font-medium transition-all disabled:opacity-40 ${
                      selectedSize === sz
                        ? "bg-zinc-800 text-white ring-1 ring-zinc-700"
                        : "text-zinc-400 hover:text-zinc-200"
                    }`}
                  >
                    {sz === "Small" ? "S" : sz === "Medium" ? "M" : "L"}
                  </button>
                ))}
              </div>
            </div>

            {/* Corner Position 2x2 */}
            <div className="space-y-1.5">
              <label className="block text-[11px] font-semibold uppercase tracking-wider text-zinc-400">
                Corner
              </label>
              <div className="grid grid-cols-2 gap-1 rounded-xl border border-zinc-800 bg-zinc-950/80 p-1">
                {POSITIONS.map((pos) => (
                  <button
                    key={pos.value}
                    type="button"
                    disabled={!cameraEnabled || isRecording}
                    onClick={() => onPositionChange(pos.value)}
                    title={pos.label}
                    className={`rounded-md py-1 text-[10px] font-semibold transition-all disabled:opacity-40 ${
                      selectedPosition === pos.value
                        ? "bg-indigo-500 text-white"
                        : "text-zinc-400 hover:bg-zinc-900 hover:text-zinc-200"
                    }`}
                  >
                    {pos.short}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Mirror toggle */}
          <div className="flex items-center justify-between rounded-xl border border-zinc-800/80 bg-zinc-950/50 px-3 py-2">
            <div className="flex items-center gap-2 text-xs text-zinc-300">
              <FlipIcon className="h-3.5 w-3.5 text-zinc-400" />
              <span>Mirror camera horizontally</span>
            </div>
            <ToggleSwitch
              checked={cameraMirror}
              onChange={onMirrorChange}
              disabled={!cameraEnabled || isRecording}
              label="Mirror camera horizontally"
            />
          </div>
        </div>

        {/* Live Shaped Preview */}
        <div className="flex shrink-0 flex-col items-center justify-center rounded-xl border border-zinc-800/80 bg-zinc-950/70 p-4 lg:w-64">
          <div
            className={`relative overflow-hidden border-2 border-zinc-600/80 bg-zinc-900 shadow-xl transition-all duration-200 ${previewRadiusClass}`}
          >
            {cameraEnabled && isRecording ? (
              <div className="flex h-full w-full flex-col items-center justify-center gap-1.5 bg-zinc-900">
                <span className="h-2.5 w-2.5 rounded-full bg-red-500 rf-recording-dot" />
                <span className="text-[11px] font-medium text-zinc-300">Live in MP4</span>
              </div>
            ) : cameraEnabled ? (
              <>
                <video
                  ref={videoRef}
                  autoPlay
                  muted
                  playsInline
                  className={`h-full w-full object-cover ${cameraMirror ? "scale-x-[-1]" : ""}`}
                />
                {previewError && (
                  <div className="absolute inset-0 flex items-center justify-center bg-zinc-950/90 p-3 text-center">
                    <span className="text-[11px] text-zinc-400">{previewError}</span>
                  </div>
                )}
              </>
            ) : (
              <div className="flex h-full w-full flex-col items-center justify-center gap-1 text-zinc-600">
                <CameraIcon className="h-5 w-5" />
                <span className="text-[11px]">Camera Off</span>
              </div>
            )}
          </div>
          <span className="mt-2.5 text-[10px] font-medium uppercase tracking-wider text-zinc-500">
            Overlay Preview
          </span>
        </div>
      </div>

      {error && <div className="mt-3 text-xs text-red-400">{error}</div>}
    </SectionWrapper>
  );
}
