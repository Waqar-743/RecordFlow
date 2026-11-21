import { openUrl } from "@tauri-apps/plugin-opener";
import { isTauriApp } from "../services/tauri.service";

export const APP_VERSION = "1.3.3";
const GITHUB_RELEASES_API = "https://api.github.com/repos/Waqar-743/RecordFlow/releases/latest";

export interface AppUpdateInfo {
  version: string;
  notes: string;
  downloadUrl: string;
  releaseUrl: string;
}

function parseSemver(version: string): [number, number, number] {
  const cleaned = version.trim().replace(/^v/i, "").split("-")[0];
  const parts = cleaned.split(".").map((n) => Number.parseInt(n, 10) || 0);
  return [parts[0] ?? 0, parts[1] ?? 0, parts[2] ?? 0];
}

export function isNewerVersion(candidate: string, current: string): boolean {
  const a = parseSemver(candidate);
  const b = parseSemver(current);
  for (let i = 0; i < 3; i++) {
    if (a[i] > b[i]) return true;
    if (a[i] < b[i]) return false;
  }
  return false;
}

export async function checkForAppUpdate(currentVersion = APP_VERSION): Promise<AppUpdateInfo | null> {
  try {
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), 8000);
    const res = await fetch(GITHUB_RELEASES_API, {
      headers: { Accept: "application/vnd.github+json" },
      signal: controller.signal,
    });
    window.clearTimeout(timer);

    if (!res.ok) return null;
    const data = (await res.json()) as {
      tag_name?: string;
      body?: string;
      html_url?: string;
      assets?: Array<{ name?: string; browser_download_url?: string }>;
    };

    const tag = (data.tag_name ?? "").trim();
    if (!tag || !isNewerVersion(tag, currentVersion)) {
      return null;
    }

    const exeAsset = data.assets?.find(
      (a) => a.name?.toLowerCase().endsWith(".exe") && a.browser_download_url,
    );
    const msiAsset = data.assets?.find(
      (a) => a.name?.toLowerCase().endsWith(".msi") && a.browser_download_url,
    );
    const releaseUrl = data.html_url || "https://github.com/Waqar-743/RecordFlow/releases/latest";
    const downloadUrl = exeAsset?.browser_download_url || msiAsset?.browser_download_url || releaseUrl;

    const firstLine =
      (data.body ?? "")
        .split("\n")
        .map((l) => l.replace(/^#+\s*/, "").trim())
        .find((l) => l.length > 0) || "A newer version of RecordFlow is available.";

    return {
      version: tag.replace(/^v/i, ""),
      notes: firstLine,
      downloadUrl,
      releaseUrl,
    };
  } catch {
    return null;
  }
}

export async function openExternalUrl(url: string): Promise<void> {
  if (isTauriApp()) {
    try {
      await openUrl(url);
      return;
    } catch {
      // Fallback below
    }
  }
  window.open(url, "_blank", "noopener,noreferrer");
}
