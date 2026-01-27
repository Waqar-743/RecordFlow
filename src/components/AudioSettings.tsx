import { useEffect, useMemo, useRef, useState } from "react";
import { tauriService } from "../services/tauri.service";
import type { AudioDeviceInfo } from "../types";
import { SectionWrapper } from "./SectionWrapper";

type Props = {
  micEnabled: boolean;
  onMicToggle: (enabled: boolean) => void;
  selectedMic: string;
  onMicChange: (deviceName: string) => void;
  micVolume: number; // 0.0-1.0
  onMicVolume: (volume: number) => void;

  systemAudioEnabled: boolean;
  onSystemAudioToggle: (enabled: boolean) => void;
  selectedSystemAudio: string;
  onSystemAudioChange: (deviceName: string) => void;
  systemAudioVolume: number; // 0.0-1.0
  onSystemAudioVolume: (volume: number) => void;
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
}: Props) {
  const [micDevices, setMicDevices] = useState<AudioDeviceInfo[]>([]);
  const [systemDevices, setSystemDevices] = useState<AudioDeviceInfo[]>([]);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

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

  return (
    <SectionWrapper title="Audio">
      <div className="space-y-6">
        <div className="flex items-start gap-12 flex-wrap">
          <div className="space-y-4 flex-1 min-w-[250px]">
            <label className="flex items-center gap-2 cursor-pointer">
              <input 
                type="checkbox" 
                checked={micEnabled}
                onChange={(e) => onMicToggle(e.target.checked)}
                className="w-4 h-4 text-blue-600 rounded"
              />
              <span className="text-sm font-medium text-gray-800">Record Microphone</span>
            </label>
            
            <div className="space-y-1">
              <p className="text-xs font-bold text-gray-500">Select Microphone</p>
              <div className="relative">
                <select 
                  value={selectedMic || ""}
                  onChange={(e) => onMicChange(e.target.value)}
                  disabled={!micEnabled || loading || micOptions.length === 0}
                  className="w-full bg-white border border-gray-300 rounded-md py-2 px-4 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 appearance-none shadow-sm disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {loading ? (
                    <option>Loading...</option>
                  ) : micOptions.length === 0 ? (
                    <option>No microphones found</option>
                  ) : (
                    micOptions.map((opt) => (
                      <option key={opt.value} value={opt.value}>{opt.label}</option>
                    ))
                  )}
                </select>
                <div className="absolute inset-y-0 right-0 flex items-center px-2 pointer-events-none">
                  <svg className="fill-current h-4 w-4 text-gray-700" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20">
                    <path d="M9.293 12.95l.707.707L15.657 8l-1.414-1.414L10 10.828 5.757 6.586 4.343 8z"/>
                  </svg>
                </div>
              </div>
            </div>
          </div>

          <div className="flex-1 space-y-4 min-w-[250px]">
            <p className="text-xs font-bold text-gray-500">Volume ({Math.round(micVolume * 100)}%)</p>
            <div className="flex items-center gap-4">
              <svg className="w-5 h-5 text-gray-500 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
              </svg>
              <input 
                type="range" 
                min="0" 
                max="100" 
                value={Math.round(micVolume * 100)} 
                onChange={(e) => onMicVolume(parseInt(e.target.value) / 100)}
                disabled={!micEnabled}
                className="flex-1 h-1.5 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-blue-600 disabled:opacity-50"
              />
              <button 
                onClick={runMicTest}
                disabled={micTestRecording || !micEnabled}
                className="bg-gray-100 border border-gray-300 px-3 py-1.5 rounded-md text-xs font-bold text-gray-700 hover:bg-gray-200 shadow-sm transition-colors shrink-0 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {micTestRecording ? "Testing..." : "Test Microphone (3s)"}
              </button>
            </div>
            
            {micTestUrl && (
              <audio controls src={micTestUrl} className="w-full h-8" />
            )}
            
            {micTestError && <div className="text-sm text-red-600">{micTestError}</div>}
          </div>
        </div>

        <div className="flex items-center gap-6 border-t border-gray-100 pt-6 flex-wrap">
          <label className="flex items-center gap-2 cursor-pointer shrink-0">
            <input 
              type="checkbox" 
              checked={systemAudioEnabled}
              onChange={(e) => onSystemAudioToggle(e.target.checked)}
              className="w-4 h-4 text-blue-600 rounded"
            />
            <span className="text-sm font-medium text-gray-800">Record System Audio</span>
          </label>
          
          <div className="flex-1 space-y-1 min-w-[250px]">
            <p className="text-xs font-bold text-gray-400 uppercase">Select System Audio</p>
            <div className="relative">
              <select 
                value={selectedSystemAudio || ""}
                onChange={(e) => onSystemAudioChange(e.target.value)}
                disabled={!systemAudioEnabled || loading || sysOptions.length === 0}
                className="w-full bg-white border border-gray-300 rounded-md py-2 px-4 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 appearance-none shadow-sm disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {loading ? (
                  <option>Loading...</option>
                ) : sysOptions.length === 0 ? (
                  <option>No system audio devices found</option>
                ) : (
                  sysOptions.map((opt) => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                  ))
                )}
              </select>
              <div className="absolute inset-y-0 right-0 flex items-center px-2 pointer-events-none">
                <svg className="fill-current h-4 w-4 text-gray-700" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20">
                  <path d="M9.293 12.95l.707.707L15.657 8l-1.414-1.414L10 10.828 5.757 6.586 4.343 8z"/>
                </svg>
              </div>
            </div>
          </div>
          
          <div className="flex-1 min-w-[200px]">
            <p className="text-xs font-bold text-gray-400 uppercase mb-2">Volume ({Math.round(systemAudioVolume * 100)}%)</p>
            <div className="flex items-center gap-4">
              <svg className="w-5 h-5 text-gray-500 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15.536 8.464a5 5 0 010 7.072m2.828-9.9a9 9 0 010 12.728M5.586 15.536a5 5 0 001.414 1.414m2.828-9.9a9 9 0 010 12.728" />
              </svg>
              <input 
                type="range" 
                min="0" 
                max="100" 
                value={Math.round(systemAudioVolume * 100)} 
                onChange={(e) => onSystemAudioVolume(parseInt(e.target.value) / 100)}
                disabled={!systemAudioEnabled}
                className="flex-1 h-1.5 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-blue-600 disabled:opacity-50"
              />
            </div>
          </div>
        </div>
      </div>
      
      {error && <div className="mt-2 text-sm text-red-600">{error}</div>}
    </SectionWrapper>
  );
}
