import { useEffect, useMemo, useRef, useState } from "react";
import { tauriService } from "../services/tauri.service";
import type { AudioDeviceInfo } from "../types";
import { createAudioLevelMeter } from "../utils/audioMeter";
import { MicIcon, SpeakerIcon } from "./Icons";
import { SectionWrapper, ToggleSwitch } from "./SectionWrapper";

type Props = {
  micEnabled: boolean;
  onMicToggle: (enabled: boolean) => void;
  selectedMic: string;
  onMicChange: (deviceName: string) => void;
  micVolume: number;
  onMicVolume: (volume: number) => void;

  systemAudioEnabled: boolean;
  onSystemAudioToggle: (enabled: boolean) => void;
  selectedSystemAudio: string;
  onSystemAudioChange: (deviceName: string) => void;
  systemAudioVolume: number;
  onSystemAudioVolume: (volume: number) => void;
  disabled?: boolean;
};

export function AudioSettings({
  micEnabled,
  onMicToggle,
  selectedMic,
  onMicChange,
  micVolume,
  onMicVolume,
  systemAudioEnabled,
  onSystemAudioToggle,
  selectedSystemAudio,
  onSystemAudioChange,
  systemAudioVolume,
  onSystemAudioVolume,
  disabled = false,
}: Props) {
  const [micDevices, setMicDevices] = useState<AudioDeviceInfo[]>([]);
  const [systemDevices, setSystemDevices] = useState<AudioDeviceInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [micLevel, setMicLevel] = useState(0);
  const [meterActive, setMeterActive] = useState(false);

  const [micTestRecording, setMicTestRecording] = useState(false);
  const [micTestUrl, setMicTestUrl] = useState<string | null>(null);
  const [micTestError, setMicTestError] = useState<string | null>(null);
  const micTestStreamRef = useRef<MediaStream | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setLoading(true);
        setError(null);
        const [mics, sys] = await Promise.all([
          tauriService.getAudioInputs(),
          tauriService.getSystemAudioDevices(),
        ]);
        if (cancelled) return;
        setMicDevices(mics);
        setSystemDevices(sys);
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

  // Live microphone VU meter — automatically releases stream during recording or 3s test
  // so Rust's cpal capture never experiences device contention on Windows.
  useEffect(() => {
    if (!micEnabled || disabled || micTestRecording || !navigator.mediaDevices?.getUserMedia) {
      setMicLevel(0);
      setMeterActive(false);
      return;
    }

    let cancelled = false;
    let stream: MediaStream | null = null;
    let stopMeter: (() => void) | null = null;

    void (async () => {
      try {
        let desiredId: string | undefined;
        if (selectedMic && navigator.mediaDevices.enumerateDevices) {
          const devs = await navigator.mediaDevices.enumerateDevices();
          desiredId = devs.find(
            (d) => d.kind === "audioinput" && d.label === selectedMic,
          )?.deviceId;
        }
        if (cancelled) return;

        stream = await navigator.mediaDevices.getUserMedia({
          audio: desiredId ? { deviceId: { exact: desiredId } } : true,
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }

        setMeterActive(true);
        stopMeter = createAudioLevelMeter(stream, (lvl) => {
          if (!cancelled) setMicLevel(lvl);
        });
      } catch {
        if (!cancelled) {
          setMeterActive(false);
          setMicLevel(0);
        }
      }
    })();

    return () => {
      cancelled = true;
      stopMeter?.();
      stream?.getTracks().forEach((t) => t.stop());
      setMicLevel(0);
      setMeterActive(false);
    };
  }, [disabled, micEnabled, micTestRecording, selectedMic]);

  useEffect(() => {
    return () => {
      if (micTestUrl) URL.revokeObjectURL(micTestUrl);
      micTestStreamRef.current?.getTracks().forEach((t) => t.stop());
    };
  }, [micTestUrl]);

  const micOptions = useMemo(
    () => micDevices.map((d) => ({ value: d.name, label: d.name })),
    [micDevices],
  );
  const sysOptions = useMemo(
    () => systemDevices.map((d) => ({ value: d.name, label: d.name })),
    [systemDevices],
  );

  const runMicTest = async () => {
    setMicTestError(null);
    if (micTestUrl) {
      URL.revokeObjectURL(micTestUrl);
      setMicTestUrl(null);
    }

    if (!navigator.mediaDevices?.getUserMedia) {
      setMicTestError("Microphone test is not supported in this environment.");
      return;
    }

    setMicTestRecording(true);
    try {
      let devices = await navigator.mediaDevices.enumerateDevices();
      let desired = devices.find(
        (d) => d.kind === "audioinput" && selectedMic && d.label === selectedMic,
      );

      if (!desired && selectedMic) {
        const warmup = await navigator.mediaDevices.getUserMedia({ audio: true });
        warmup.getTracks().forEach((t) => t.stop());
        devices = await navigator.mediaDevices.enumerateDevices();
        desired = devices.find(
          (d) => d.kind === "audioinput" && d.label === selectedMic,
        );
      }

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: desired ? { deviceId: { exact: desired.deviceId } } : true,
      });
      micTestStreamRef.current = stream;

      const chunks: BlobPart[] = [];
      const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
        ? "audio/webm;codecs=opus"
        : undefined;

      const recorder = new MediaRecorder(
        stream,
        mimeType ? { mimeType } : undefined,
      );

      const blob = await new Promise<Blob>((resolve, reject) => {
        recorder.ondataavailable = (e) => {
          if (e.data && e.data.size > 0) chunks.push(e.data);
        };
        recorder.onerror = () => reject(new Error("Microphone test failed."));
        recorder.onstop = () => resolve(new Blob(chunks, { type: recorder.mimeType }));
        recorder.start();
        window.setTimeout(() => recorder.stop(), 3000);
      });

      stream.getTracks().forEach((t) => t.stop());
      micTestStreamRef.current = null;
      setMicTestUrl(URL.createObjectURL(blob));
    } catch (e) {
      setMicTestError(String(e));
    } finally {
      setMicTestRecording(false);
    }
  };

  const mixerSummary =
    micEnabled && systemAudioEnabled
      ? "Mic + System mixed at 48 kHz AAC"
      : micEnabled
        ? "Microphone only · 48 kHz AAC"
        : systemAudioEnabled
          ? "System loopback only · 48 kHz AAC"
          : "Muted (video only)";

  const meterPct = Math.round(Math.min(1, micLevel * Math.max(0.25, micVolume)) * 100);
  const meterColor =
    meterPct > 85 ? "bg-red-500" : meterPct > 65 ? "bg-amber-400" : "bg-emerald-400";

  return (
    <SectionWrapper
      title="Audio Mixer"
      subtitle={mixerSummary}
      icon={<MicIcon className="h-4 w-4" />}
    >
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* Microphone Channel */}
        <div
          className={`flex flex-col gap-3.5 rounded-xl border p-4 transition-colors ${
            micEnabled
              ? "border-zinc-700/80 bg-zinc-950/70"
              : "border-zinc-800/70 bg-zinc-950/35 opacity-65"
          }`}
        >
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2.5">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-zinc-800/90 text-indigo-400">
                <MicIcon className="h-4 w-4" />
              </div>
              <div>
                <div className="text-xs font-semibold text-zinc-100">Microphone</div>
                <div className="text-[11px] text-zinc-500">Voice commentary</div>
              </div>
            </div>
            <ToggleSwitch
              checked={micEnabled}
              onChange={onMicToggle}
              disabled={disabled}
              label="Record microphone"
            />
          </div>

          <select
            value={selectedMic || ""}
            onChange={(e) => onMicChange(e.target.value)}
            disabled={!micEnabled || disabled || loading || micOptions.length === 0}
            className="h-9 w-full rounded-xl border border-zinc-800 bg-zinc-900/90 px-3 text-xs text-zinc-100 focus:border-indigo-500 focus:outline-none disabled:cursor-not-allowed disabled:opacity-50"
          >
            {loading ? (
              <option>Loading devices...</option>
            ) : micOptions.length === 0 ? (
              <option>No microphones found</option>
            ) : (
              <>
                <option value="">System Default Microphone</option>
                {micOptions.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </>
            )}
          </select>

          {/* Real-time Live Input Level Meter */}
          <div className="space-y-1">
            <div className="flex items-center justify-between text-[10px]">
              <span className="font-medium uppercase tracking-wider text-zinc-500">
                Live Input Level
              </span>
              <span className="text-zinc-500">
                {disabled
                  ? "Captured by recorder"
                  : meterActive
                    ? meterPct > 4
                      ? "Signal detected"
                      : "Listening..."
                    : "Inactive"}
              </span>
            </div>
            <div className="h-2 w-full overflow-hidden rounded-full bg-zinc-800/90">
              <div
                className={`h-full rounded-full transition-[width] duration-75 ${meterColor}`}
                style={{ width: `${micEnabled && meterActive ? meterPct : 0}%` }}
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-[11px]">
              <span className="text-zinc-400">Input Gain</span>
              <span className="font-mono font-medium text-zinc-200">
                {Math.round(micVolume * 100)}%
              </span>
            </div>
            <div className="flex items-center gap-3">
              <input
                type="range"
                min="0"
                max="100"
                value={Math.round(micVolume * 100)}
                onChange={(e) => onMicVolume(Number.parseInt(e.target.value, 10) / 100)}
                disabled={!micEnabled || disabled}
                className="rf-slider flex-1"
              />
              <button
                type="button"
                onClick={() => void runMicTest()}
                disabled={micTestRecording || !micEnabled || disabled}
                className="shrink-0 rounded-lg border border-zinc-700 bg-zinc-800/80 px-2.5 py-1 text-[11px] font-medium text-zinc-200 transition-colors hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {micTestRecording ? "Recording 3s..." : "Test (3s)"}
              </button>
            </div>
          </div>

          {micTestUrl && <audio controls src={micTestUrl} className="h-8 w-full" />}
          {micTestError && <div className="text-xs text-red-400">{micTestError}</div>}
        </div>

        {/* System Audio Channel (WASAPI Loopback) */}
        <div
          className={`flex flex-col gap-3.5 rounded-xl border p-4 transition-colors ${
            systemAudioEnabled
              ? "border-zinc-700/80 bg-zinc-950/70"
              : "border-zinc-800/70 bg-zinc-950/35 opacity-65"
          }`}
        >
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2.5">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-zinc-800/90 text-emerald-400">
                <SpeakerIcon className="h-4 w-4" />
              </div>
              <div>
                <div className="flex items-center gap-1.5">
                  <span className="text-xs font-semibold text-zinc-100">System Audio</span>
                  <span className="rounded bg-emerald-500/15 px-1.5 py-0.5 text-[10px] font-medium text-emerald-400">
                    WASAPI
                  </span>
                </div>
                <div className="text-[11px] text-zinc-500">App &amp; desktop playback</div>
              </div>
            </div>
            <ToggleSwitch
              checked={systemAudioEnabled}
              onChange={onSystemAudioToggle}
              disabled={disabled}
              label="Record system audio"
            />
          </div>

          <select
            value={selectedSystemAudio || ""}
            onChange={(e) => onSystemAudioChange(e.target.value)}
            disabled={!systemAudioEnabled || disabled || loading || sysOptions.length === 0}
            className="h-9 w-full rounded-xl border border-zinc-800 bg-zinc-900/90 px-3 text-xs text-zinc-100 focus:border-indigo-500 focus:outline-none disabled:cursor-not-allowed disabled:opacity-50"
          >
            {loading ? (
              <option>Loading outputs...</option>
            ) : sysOptions.length === 0 ? (
              <option>No output devices found</option>
            ) : (
              <>
                <option value="">System Default Output</option>
                {sysOptions.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </>
            )}
          </select>

          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-[11px]">
              <span className="text-zinc-400">Desktop Level</span>
              <span className="font-mono font-medium text-zinc-200">
                {Math.round(systemAudioVolume * 100)}%
              </span>
            </div>
            <input
              type="range"
              min="0"
              max="100"
              value={Math.round(systemAudioVolume * 100)}
              onChange={(e) => onSystemAudioVolume(Number.parseInt(e.target.value, 10) / 100)}
              disabled={!systemAudioEnabled || disabled}
              className="rf-slider w-full"
            />
          </div>

          <p className="text-[11px] leading-relaxed text-zinc-500">
            Captures desktop audio directly via Windows loopback and mixes cleanly with your mic in
            real time.
          </p>
        </div>
      </div>

      {error && <div className="mt-3 text-xs text-red-400">{error}</div>}
    </SectionWrapper>
  );
}
