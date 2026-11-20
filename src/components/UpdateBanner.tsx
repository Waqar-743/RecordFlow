import { listen } from "@tauri-apps/api/event";
import { useCallback, useEffect, useRef, useState } from "react";
import { isTauriApp } from "../services/tauri.service";
import {
  APP_VERSION,
  checkForAppUpdate,
  openExternalUrl,
  type AppUpdateInfo,
} from "../utils/updates";
import { DownloadIcon, XIcon } from "./Icons";

type Props = {
  busy?: boolean;
  manualCheckToken?: number;
  onNotice?: (message: string) => void;
};

export function UpdateBanner({ busy = false, manualCheckToken = 0, onNotice }: Props) {
  const [update, setUpdate] = useState<AppUpdateInfo | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const checkingRef = useRef(false);
  const handledTokenRef = useRef(0);

  const runCheck = useCallback(
    async (manual: boolean) => {
      if (checkingRef.current) return;
      checkingRef.current = true;
      try {
        const found = await checkForAppUpdate(APP_VERSION);
        if (found) {
          setUpdate(found);
          setDismissed(false);
        } else if (manual) {
          onNotice?.(`You're on the latest version (v${APP_VERSION}).`);
        }
      } finally {
        checkingRef.current = false;
      }
    },
    [onNotice],
  );

  // Silent check 5 seconds after startup + tray "Check for Updates" listener
  useEffect(() => {
    const timer = window.setTimeout(() => {
      void runCheck(false);
    }, 5000);

    let unlisten: (() => void) | null = null;
    if (isTauriApp()) {
      void listen("recordflow-check-updates", () => {
        void runCheck(true);
      }).then((fn) => {
        unlisten = fn;
      });
    }

    return () => {
      window.clearTimeout(timer);
      unlisten?.();
    };
  }, [runCheck]);

  // Manual check triggered from header button
  useEffect(() => {
    if (!manualCheckToken || manualCheckToken === handledTokenRef.current) return;
    handledTokenRef.current = manualCheckToken;
    void runCheck(true);
  }, [manualCheckToken, runCheck]);

  if (!update || dismissed || busy) return null;

  return (
    <div
      role="status"
      className="fixed bottom-5 right-5 z-50 w-80 rounded-2xl border border-indigo-500/35 bg-zinc-900/95 p-4 text-zinc-100 shadow-2xl backdrop-blur-md"
    >
      <div className="flex items-start gap-3">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-indigo-500/15 text-indigo-400">
          <DownloadIcon className="h-4 w-4" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-xs font-semibold text-white">
            RecordFlow v{update.version} is available
          </div>
          <p className="mt-0.5 line-clamp-2 text-[11px] text-zinc-400">{update.notes}</p>
        </div>
        <button
          type="button"
          onClick={() => setDismissed(true)}
          aria-label="Dismiss update"
          className="rounded-md p-0.5 text-zinc-500 hover:text-zinc-200"
        >
          <XIcon className="h-4 w-4" />
        </button>
      </div>

      <div className="mt-3 flex gap-2">
        <button
          type="button"
          onClick={() => void openExternalUrl(update.downloadUrl)}
          className="flex-1 rounded-lg bg-indigo-500 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-indigo-400"
        >
          Download Update
        </button>
        <button
          type="button"
          onClick={() => setDismissed(true)}
          className="rounded-lg border border-zinc-700 px-3 py-1.5 text-xs font-medium text-zinc-300 transition-colors hover:bg-zinc-800 hover:text-white"
        >
          Later
        </button>
      </div>
    </div>
  );
}
