import { useEffect, useMemo, useState } from "react";
import { tauriService } from "../services/tauri.service";
import type { CaptureRegion, DisplayInfo } from "../types";
import { SectionWrapper } from "./SectionWrapper";
import { ScreenRegionPicker } from "./ScreenRegionPicker";

type Props = {
  onDisplayChange: (displayIndex: number) => void;
  selectedDisplay: number;
  screenEnabled: boolean;
  onScreenToggle: (enabled: boolean) => void;
  captureRegion: CaptureRegion | null;
  selectionRequestId?: number;
  onCaptureRegionChange: (region: CaptureRegion | null) => Promise<void>;
  onSelectionComplete?: () => Promise<void>;
};

export function DisplaySelector({
  onDisplayChange,
  selectedDisplay,
  screenEnabled,
  onScreenToggle,
  captureRegion,
  selectionRequestId,
  onCaptureRegionChange,
  onSelectionComplete,
}: Props) {
  const [displays, setDisplays] = useState<DisplayInfo[]>([]);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setLoading(true);
        setError(null);
        const list = await tauriService.getDisplays();
        if (cancelled) return;
        setDisplays(list);
      } catch (e) {
        if (cancelled) return;
        setError(String(e));
        setDisplays([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const options = useMemo(
    () =>
      displays.map((d) => ({
        value: String(d.index),
        label: `${d.name} - ${d.width}x${d.height}`,
      })),
    [displays],
  );

  const activeDisplay = useMemo(
    () => displays.find((display) => display.index === selectedDisplay) ?? displays[0] ?? null,
    [displays, selectedDisplay],
  );

  return (
    <SectionWrapper title="Display/Window Selection">
      <div className="flex items-center gap-6">
        <label className="flex items-center gap-2 cursor-pointer group shrink-0">
          <input 
            type="checkbox" 
            checked={screenEnabled}
            onChange={(e) => onScreenToggle(e.target.checked)}
            className="w-4 h-4 text-blue-600 rounded"
          />
          <span className="text-sm font-medium text-gray-800">Record Screen</span>
        </label>
        
        <div className="flex-1 relative">
          <select 
            value={options.length === 0 ? "" : String(selectedDisplay)}
            onChange={(e) => onDisplayChange(Number(e.target.value))}
            disabled={!screenEnabled || loading || options.length === 0}
            className="w-full bg-white border border-gray-300 rounded-md py-2 px-4 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 appearance-none shadow-sm disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading ? (
              <option>Loading...</option>
            ) : options.length === 0 ? (
              <option>No displays found</option>
            ) : (
              options.map((opt) => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))
            )}
          </select>
          <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-2 text-gray-700">
            <svg className="fill-current h-4 w-4" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20">
              <path d="M9.293 12.95l.707.707L15.657 8l-1.414-1.414L10 10.828 5.757 6.586 4.343 8z"/>
            </svg>
          </div>
        </div>
      </div>

      <ScreenRegionPicker
        display={activeDisplay}
        captureRegion={captureRegion}
        disabled={!screenEnabled || loading || options.length === 0}
        selectionRequestId={selectionRequestId}
        onCaptureRegionChange={onCaptureRegionChange}
        onSelectionComplete={onSelectionComplete}
      />
      
      {error && <div className="mt-2 text-sm text-red-600">{error}</div>}
    </SectionWrapper>
  );
}
