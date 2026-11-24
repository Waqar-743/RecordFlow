export interface ViewportRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ToolbarPlacement {
  left: number;
  top: number;
  mode: "below" | "above" | "inside-bottom";
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

/**
 * Computes a guaranteed visible, viewport-clamped fixed position for the floating
 * region-selection action toolbar ("Start recording", "Apply area", "Redraw", "Cancel").
 *
 * Placement priority:
 *  1. Below the selection box (when there is room above the bottom safe margin)
 *  2. Above the selection box (when there is room below the top safe margin)
 *  3. Docked inside the bottom-center of the selection (for full-screen or tall selections)
 *
 * Horizontal position tracks the selection's center and always clamps inside the viewport.
 */
export function computeRegionToolbarPlacement(
  selection: ViewportRect,
  viewportWidth: number,
  viewportHeight: number,
  toolbarWidth: number,
  toolbarHeight: number,
): ToolbarPlacement {
  const edgePad = 14;
  const bottomSafe = 24;
  const gap = 12;

  const vw = Math.max(320, viewportWidth);
  const vh = Math.max(240, viewportHeight);
  const tbW = Math.min(Math.max(200, toolbarWidth), Math.max(200, vw - edgePad * 2));
  const tbH = Math.max(40, toolbarHeight);

  const idealLeft = selection.x + selection.width / 2 - tbW / 2;
  const left = Math.round(clamp(idealLeft, edgePad, Math.max(edgePad, vw - tbW - edgePad)));

  const selBottom = selection.y + selection.height;

  // 1. Prefer directly below the selection
  if (selBottom + gap + tbH <= vh - bottomSafe) {
    return {
      left,
      top: Math.round(selBottom + gap),
      mode: "below",
    };
  }

  // 2. Otherwise try directly above the selection
  if (selection.y - gap - tbH >= edgePad) {
    return {
      left,
      top: Math.round(selection.y - gap - tbH),
      mode: "above",
    };
  }

  // 3. Full-screen or tall selection: dock cleanly inside the bottom-center of the selection
  const minInsideTop = Math.max(edgePad, selection.y + 16);
  const maxInsideTop = Math.max(minInsideTop, vh - tbH - bottomSafe);
  const preferredInsideTop = selBottom - tbH - 24;

  return {
    left,
    top: Math.round(clamp(preferredInsideTop, minInsideTop, maxInsideTop)),
    mode: "inside-bottom",
  };
}
