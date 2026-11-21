import { useCallback, useEffect, useRef, useState } from "react";
import { tauriService } from "../services/tauri.service";
import type { RecordingSettings } from "../types";

type UseSettingsResult = {
  settings: RecordingSettings | null;
  loading: boolean;
  error: string | null;
  updateSettings: (patch: Partial<RecordingSettings>) => Promise<void>;
  replaceSettings: (next: RecordingSettings) => Promise<void>;
};

export function useSettings(): UseSettingsResult {
  const [settings, setSettings] = useState<RecordingSettings | null>(null);
  const settingsRef = useRef<RecordingSettings | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setLoading(true);
        const s = await tauriService.getSettings();
        if (!cancelled) {
          settingsRef.current = s;
          setSettings(s);
        }
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

  const replaceSettings = useCallback(async (next: RecordingSettings) => {
    settingsRef.current = next;
    setSettings(next);
    await tauriService.updateSettings(next);
  }, []);

  const updateSettings = useCallback(
    async (patch: Partial<RecordingSettings>) => {
      const current = settingsRef.current;
      if (!current) return;
      const next = { ...current, ...patch };
      await replaceSettings(next);
    },
    [replaceSettings],
  );

  return { settings, loading, error, updateSettings, replaceSettings };
}
