import { useEffect, useMemo, useState } from "react";
import { AudioSettings } from "../components/AudioSettings";
import { CameraSettings } from "../components/CameraSettings";
import { DisplaySelector } from "../components/DisplaySelector";
import { VideoSettings } from "../components/VideoSettings";
import { Sidebar } from "../components/Sidebar";
import { useRecording } from "../hooks/useRecording";
import { useSettings } from "../hooks/useSettings";
import { useTimerHistory } from "../hooks/useTimerHistory";
import { tauriService } from "../services/tauri.service";
import type { CameraPosition, CameraSize, CaptureRegion, RecordingInfo, Resolution } from "../types";

export function RecorderPage() {
  const { settings, loading: settingsLoading, error: settingsError, updateSettings } = useSettings();
  const recording = useRecording();
  const history = useTimerHistory();
  const [lastInfo, setLastInfo] = useState<RecordingInfo | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [selectionRequestId, setSelectionRequestId] = useState(0);

  useEffect(() => {
    if (!recording.status.is_recording && recording.status.output_file) {
      void (async () => {
        try {
          setFileError(null);
          const info = await tauriService.getLastRecordingInfo();
          setLastInfo(info);
        } catch (e) {
          setFileError(String(e));
        }
      })();

      void history.refresh();
    }
  }, [history.refresh, recording.status.is_recording, recording.status.output_file]);

  const canStart = useMemo(() => {
    if (!settings) return false;
    return settings.screen_enabled || settings.camera_enabled || settings.mic_enabled || settings.system_audio_enabled;
  }, [settings]);

  if (settingsLoading) {
    return (
      <div className="flex min-h-screen bg-gray-100 text-gray-800">
        <div className="w-80 bg-white border-r border-gray-200 p-8 flex flex-col shadow-sm shrink-0">
          <h1 className="text-3xl font-bold text-gray-900 tracking-tight">RecordFlow</h1>
          <p className="text-sm text-gray-500 mt-1">Loading...</p>
        </div>
      </div>
    );
  }

  if (settingsError && !settings) {
    return (
      <div className="flex min-h-screen bg-gray-100 text-gray-800">
        <div className="w-80 bg-white border-r border-gray-200 p-8 flex flex-col shadow-sm shrink-0">
          <h1 className="text-3xl font-bold text-gray-900 tracking-tight">RecordFlow</h1>
          <p className="text-sm text-gray-500 mt-1">Error</p>
          <div className="mt-4 p-4 bg-red-50 rounded-lg text-red-600 text-sm">
            <p>Failed to load settings. Is the Tauri backend running?</p>
            <pre className="mt-2 text-xs whitespace-pre-wrap">{settingsError}</pre>
          </div>
        </div>
      </div>
    );
  }

  if (!settings) return null;

  const onResolutionChange = async (r: Resolution) => {
    await updateSettings({ resolution: r, fps: 30, bitrate: 5000 });
  };

  const onScreenToggle = async (enabled: boolean) => {
    await updateSettings({ screen_enabled: enabled });
  };

  const onDisplayChange = async (idx: number) => {
    await updateSettings({ selected_display: idx, capture_region: null });
  };

  const onCaptureRegionChange = async (region: CaptureRegion | null) => {
    await updateSettings({ capture_region: region });
  };

  const onCameraToggle = async (enabled: boolean) => {
    await updateSettings({ camera_enabled: enabled });
  };

  const onCameraChange = async (idx: string) => {
    await updateSettings({ selected_camera: idx });
  };

  const onPositionChange = async (pos: CameraPosition) => {
    await updateSettings({ camera_position: pos });
  };

  const onSizeChange = async (size: CameraSize) => {
    await updateSettings({ camera_size: size });
  };

  const onMicToggle = async (enabled: boolean) => {
    await updateSettings({ mic_enabled: enabled });
  };

  const onMicChange = async (name: string) => {
    await updateSettings({ microphone_device: name });
  };

  const onMicVolume = async (v: number) => {
    await updateSettings({ mic_volume: v });
  };

  const onSystemToggle = async (enabled: boolean) => {
    await updateSettings({ system_audio_enabled: enabled });
  };

  const onSystemChange = async (name: string) => {
    await updateSettings({ system_audio_device: name });
  };

  const onSystemVolume = async (v: number) => {
    await updateSettings({ system_audio_volume: v });
  };

  const start = async () => {
    if (!canStart) return;
    if (settings.screen_enabled) {
      setSelectionRequestId((value) => value + 1);
      return;
    }

    await recording.start();
  };

  const startAfterRegionSelection = async () => {
    await recording.start();
  };

  return (
    <div className="flex min-h-screen bg-gray-100 text-gray-800">
      <Sidebar
        isRecording={recording.status.is_recording}
        isPaused={recording.status.is_paused}
        elapsedSeconds={recording.status.elapsed_seconds}
        lastRecording={lastInfo}
        history={history.sessions}
        onStart={start}
        onStop={recording.stop}
        onPause={recording.pause}
        onResume={recording.resume}
        loading={recording.loading}
        error={!canStart ? "Enable at least one input (screen/camera/audio)" : recording.error}
        canStart={canStart}
        onClearHistory={history.clear}
        onRemoveSession={history.remove}
        historyLoading={history.loading}
        historyError={history.error}
        fileError={fileError}
      />
      
      <div className="flex-1 p-8 overflow-y-auto max-w-5xl mx-auto space-y-6">
        {settingsError && (
          <div className="p-4 bg-red-50 rounded-lg text-red-600 text-sm">
            {settingsError}
          </div>
        )}
        
        <VideoSettings
          selectedResolution={settings.resolution}
          onResolutionChange={onResolutionChange}
        />
        
        <DisplaySelector
          selectedDisplay={settings.selected_display}
          onDisplayChange={onDisplayChange}
          screenEnabled={settings.screen_enabled}
          onScreenToggle={onScreenToggle}
          captureRegion={settings.capture_region}
          selectionRequestId={selectionRequestId}
          onCaptureRegionChange={onCaptureRegionChange}
          onSelectionComplete={startAfterRegionSelection}
        />
        
        <CameraSettings
          cameraEnabled={settings.camera_enabled}
          onToggle={onCameraToggle}
          selectedCamera={settings.selected_camera ?? ""}
          onCameraChange={onCameraChange}
          selectedPosition={settings.camera_position}
          onPositionChange={onPositionChange}
          selectedSize={settings.camera_size}
          onSizeChange={onSizeChange}
          isRecording={recording.status.is_recording}
        />
        
        <AudioSettings
          micEnabled={settings.mic_enabled}
          onMicToggle={onMicToggle}
          selectedMic={settings.microphone_device}
          onMicChange={onMicChange}
          micVolume={settings.mic_volume}
          onMicVolume={onMicVolume}
          systemAudioEnabled={settings.system_audio_enabled}
          onSystemAudioToggle={onSystemToggle}
          selectedSystemAudio={settings.system_audio_device}
          onSystemAudioChange={onSystemChange}
          systemAudioVolume={settings.system_audio_volume}
          onSystemAudioVolume={onSystemVolume}
        />
      </div>
    </div>
  );
}
