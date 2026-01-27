import { useEffect, useMemo, useState, useRef, useCallback } from "react";
import { tauriService } from "../services/tauri.service";
import type { CameraInfo, CameraPosition, CameraSize } from "../types";
import { SectionWrapper } from "./SectionWrapper";

type Props = {
  onCameraChange: (index: string) => void;
  onPositionChange: (position: CameraPosition) => void;
  onSizeChange: (size: CameraSize) => void;
  cameraEnabled: boolean;
  onToggle: (enabled: boolean) => void;
  selectedCamera: string;
  selectedPosition: CameraPosition;
  selectedSize: CameraSize;
  isRecording?: boolean;
};

const positions: { value: CameraPosition; label: string }[] = [
  { value: "TopLeft", label: "Top Left" },
  { value: "TopRight", label: "Top Right" },
  { value: "BottomLeft", label: "Bottom Left" },
  { value: "BottomRight", label: "Bottom Right" },
];

const sizes: CameraSize[] = ["Small", "Medium", "Large"];

export function CameraSettings({
  onCameraChange,
  onPositionChange,
  onSizeChange,
  cameraEnabled,
  onToggle,
  selectedCamera,
  selectedPosition,
  selectedSize,
  isRecording = false,
}: Props) {
  const [cameras, setCameras] = useState<CameraInfo[]>([]);
  const [browserDevices, setBrowserDevices] = useState<MediaDeviceInfo[]>([]);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);

  // Fetch cameras from backend (nokhwa)
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

  // Enumerate browser video devices for preview
  useEffect(() => {
    let cancelled = false;
    
    const enumerateDevices = async () => {
      try {
        // First request permission to access camera (required for device labels)
        const tempStream = await navigator.mediaDevices.getUserMedia({ video: true });
        tempStream.getTracks().forEach(t => t.stop());
        
        // Now enumerate devices with labels
        const devices = await navigator.mediaDevices.enumerateDevices();
        const videoDevices = devices.filter(d => d.kind === 'videoinput');
        if (!cancelled) {
          setBrowserDevices(videoDevices);
          console.log('CameraSettings: Browser video devices:', videoDevices.map(d => ({ deviceId: d.deviceId, label: d.label })));
        }
      } catch (e) {
        console.error('CameraSettings: Failed to enumerate devices:', e);
      }
    };
    
    enumerateDevices();
    return () => { cancelled = true; };
  }, []);

  // Stop any existing preview stream
  const stopPreview = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => t.stop());
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    setPreviewError(null);
  }, []);

  // Camera preview - match backend camera index to browser device
  // Stop preview during recording to avoid camera conflicts with nokhwa
  useEffect(() => {
    if (!cameraEnabled || !selectedCamera || isRecording) {
      stopPreview();
      return;
    }

    const startPreview = async () => {
      try {
        stopPreview();
        setPreviewError(null);
        
        const cameraIndex = parseInt(selectedCamera, 10);
        
        // Try to match the camera by index
        // Browser devices and nokhwa devices may be in the same order
        let deviceId: string | undefined;
        
        if (browserDevices.length > cameraIndex) {
          deviceId = browserDevices[cameraIndex]?.deviceId;
          console.log(`CameraSettings: Using browser device at index ${cameraIndex}:`, browserDevices[cameraIndex]?.label);
        }
        
        // If we have a specific deviceId, use it; otherwise use any camera
        const constraints: MediaStreamConstraints = {
          video: deviceId 
            ? { deviceId: { exact: deviceId }, width: { ideal: 640 }, height: { ideal: 480 } }
            : { width: { ideal: 640 }, height: { ideal: 480 } }
        };
        
        console.log('CameraSettings: Requesting camera with constraints:', constraints);
        const stream = await navigator.mediaDevices.getUserMedia(constraints);
        streamRef.current = stream;
        
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
        }
        
        console.log('CameraSettings: Preview started successfully');
      } catch (e) {
        console.error('CameraSettings: Failed to start preview:', e);
        setPreviewError(e instanceof Error ? e.message : String(e));
      }
    };
    
    startPreview();
    
    return () => {
      stopPreview();
    };
  }, [cameraEnabled, selectedCamera, browserDevices, stopPreview, isRecording]);

  const cameraOptions = useMemo(
    () =>
      cameras.map((c) => ({
        value: String(c.index),
        label: c.width && c.height ? `${c.name} (${c.width}x${c.height})` : c.name,
      })),
    [cameras],
  );

  return (
    <SectionWrapper title="Camera">
      <div className="flex gap-8">
        <div className="flex-1 space-y-4">
          <label className="flex items-center gap-2 cursor-pointer">
            <input 
              type="checkbox" 
              checked={cameraEnabled}
              onChange={(e) => onToggle(e.target.checked)}
              className="w-4 h-4 text-blue-600 rounded"
            />
            <span className="text-sm font-medium text-gray-800">Record Camera</span>
          </label>
          
          <div className="space-y-1">
            <p className="text-xs font-bold text-gray-500">Select Camera</p>
            <div className="relative">
              <select 
                value={cameraOptions.length === 0 ? "" : selectedCamera}
                onChange={(e) => onCameraChange(e.target.value)}
                disabled={!cameraEnabled || loading || cameraOptions.length === 0}
                className="w-full bg-white border border-gray-300 rounded-md py-2 px-4 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 appearance-none shadow-sm disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {loading ? (
                  <option>Loading...</option>
                ) : cameraOptions.length === 0 ? (
                  <option>No cameras found</option>
                ) : (
                  cameraOptions.map((opt) => (
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

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1">
              <p className="text-xs font-bold text-gray-500">Camera Position</p>
              <div className="relative">
                <select 
                  value={selectedPosition}
                  onChange={(e) => onPositionChange(e.target.value as CameraPosition)}
                  disabled={!cameraEnabled}
                  className="w-full bg-white border border-gray-300 rounded-md py-2 px-4 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 appearance-none shadow-sm disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {positions.map((pos) => (
                    <option key={pos.value} value={pos.value}>{pos.label}</option>
                  ))}
                </select>
                <div className="absolute inset-y-0 right-0 flex items-center px-2 pointer-events-none">
                  <svg className="fill-current h-4 w-4 text-gray-700" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20">
                    <path d="M9.293 12.95l.707.707L15.657 8l-1.414-1.414L10 10.828 5.757 6.586 4.343 8z"/>
                  </svg>
                </div>
              </div>
            </div>
            <div className="space-y-1">
              <p className="text-xs font-bold text-gray-500">Camera Size</p>
              <div className="relative">
                <select 
                  value={selectedSize}
                  onChange={(e) => onSizeChange(e.target.value as CameraSize)}
                  disabled={!cameraEnabled}
                  className="w-full bg-white border border-gray-300 rounded-md py-2 px-4 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 appearance-none shadow-sm disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {sizes.map((size) => (
                    <option key={size} value={size}>{size}</option>
                  ))}
                </select>
                <div className="absolute inset-y-0 right-0 flex items-center px-2 pointer-events-none">
                  <svg className="fill-current h-4 w-4 text-gray-700" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20">
                    <path d="M9.293 12.95l.707.707L15.657 8l-1.414-1.414L10 10.828 5.757 6.586 4.343 8z"/>
                  </svg>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="w-64 aspect-video bg-gray-900 rounded-xl overflow-hidden shadow-xl border-4 border-gray-400 relative shrink-0">
          {cameraEnabled && isRecording ? (
            <div className="w-full h-full flex flex-col items-center justify-center bg-gray-800">
              <div className="absolute inset-0 flex items-center justify-center">
                <div className="flex flex-col items-center gap-2">
                  <div className="w-3 h-3 bg-red-500 rounded-full animate-pulse" />
                  <span className="text-xs text-white/70 font-medium">Recording...</span>
                </div>
              </div>
            </div>
          ) : cameraEnabled ? (
            <>
              <video 
                ref={videoRef} 
                autoPlay 
                muted 
                playsInline 
                className="w-full h-full object-cover scale-x-[-1]"
              />
              {previewError && (
                <div className="absolute inset-0 flex items-center justify-center bg-gray-800/90">
                  <span className="text-xs text-red-400 font-medium px-2 text-center">Preview error: {previewError}</span>
                </div>
              )}
            </>
          ) : (
            <div className="w-full h-full flex flex-col items-center justify-center bg-gray-800">
              <div className="absolute inset-0 flex items-center justify-center">
                <span className="text-xs text-white/50 font-medium">Preview disabled</span>
              </div>
            </div>
          )}
        </div>
      </div>
      
      {error && <div className="mt-2 text-sm text-red-600">{error}</div>}
    </SectionWrapper>
  );
}
