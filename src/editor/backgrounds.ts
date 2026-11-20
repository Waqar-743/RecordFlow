export type BackgroundCategory = "gradient" | "abstract" | "scenic" | "solid";

export interface StudioBackground {
  id: string;
  name: string;
  category: BackgroundCategory;
  /** CSS background string for crisp swatch previews */
  css: string;
  /** Canvas draw function for deterministic real-time & export rendering */
  draw: (ctx: CanvasRenderingContext2D, width: number, height: number) => void;
}

function drawLinearGradient(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  angleDeg: number,
  stops: Array<[number, string]>,
) {
  const rad = ((angleDeg - 90) * Math.PI) / 180;
  const cx = w / 2;
  const cy = h / 2;
  const len = Math.hypot(w, h) / 2;
  const grad = ctx.createLinearGradient(
    cx - Math.cos(rad) * len,
    cy - Math.sin(rad) * len,
    cx + Math.cos(rad) * len,
    cy + Math.sin(rad) * len,
  );
  for (const [offset, color] of stops) {
    grad.addColorStop(offset, color);
  }
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, w, h);
}

function drawMeshOrbs(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  base: string,
  orbs: Array<{ x: number; y: number; r: number; color: string }>,
) {
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, w, h);
  for (const orb of orbs) {
    const gx = orb.x * w;
    const gy = orb.y * h;
    const gr = orb.r * Math.max(w, h);
    const g = ctx.createRadialGradient(gx, gy, 0, gx, gy, gr);
    g.addColorStop(0, orb.color);
    g.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  }
}

function drawMountainScene(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  sky: Array<[number, string]>,
  sun: { x: number; y: number; r: number; color: string },
  ridges: Array<{ y: number; color: string; seed: number; amp: number }>,
) {
  drawLinearGradient(ctx, w, h, 180, sky);

  // Sun / moon glow
  const sx = sun.x * w;
  const sy = sun.y * h;
  const sr = sun.r * Math.min(w, h);
  const halo = ctx.createRadialGradient(sx, sy, sr * 0.2, sx, sy, sr * 3.4);
  halo.addColorStop(0, sun.color);
  halo.addColorStop(0.3, sun.color + "55");
  halo.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = halo;
  ctx.fillRect(0, 0, w, h);

  ctx.fillStyle = sun.color;
  ctx.beginPath();
  ctx.arc(sx, sy, sr, 0, Math.PI * 2);
  ctx.fill();

  // Layered silhouettes
  for (const ridge of ridges) {
    ctx.fillStyle = ridge.color;
    ctx.beginPath();
    ctx.moveTo(0, h);
    const steps = 40;
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const x = t * w;
      const wave =
        Math.sin(t * Math.PI * 2.4 + ridge.seed) * ridge.amp +
        Math.sin(t * Math.PI * 6.2 + ridge.seed * 1.9) * (ridge.amp * 0.35) +
        Math.cos(t * Math.PI * 11 + ridge.seed) * (ridge.amp * 0.12);
      const y = (ridge.y + wave) * h;
      ctx.lineTo(x, y);
    }
    ctx.lineTo(w, h);
    ctx.closePath();
    ctx.fill();
  }
}

export const STUDIO_BACKGROUNDS: StudioBackground[] = [
  // Gradients
  {
    id: "aurora-indigo",
    name: "Aurora Indigo",
    category: "gradient",
    css: "linear-gradient(135deg, #1e1b4b 0%, #3730a3 45%, #0ea5e9 100%)",
    draw: (ctx, w, h) =>
      drawLinearGradient(ctx, w, h, 135, [
        [0, "#1e1b4b"],
        [0.45, "#3730a3"],
        [1, "#0ea5e9"],
      ]),
  },
  {
    id: "sunset-coral",
    name: "Sunset Coral",
    category: "gradient",
    css: "linear-gradient(135deg, #ff7e5f 0%, #c850c0 55%, #4158d0 100%)",
    draw: (ctx, w, h) =>
      drawLinearGradient(ctx, w, h, 135, [
        [0, "#ff7e5f"],
        [0.55, "#c850c0"],
        [1, "#4158d0"],
      ]),
  },
  {
    id: "emerald-tide",
    name: "Emerald Tide",
    category: "gradient",
    css: "linear-gradient(135deg, #064e3b 0%, #0d9488 52%, #38bdf8 100%)",
    draw: (ctx, w, h) =>
      drawLinearGradient(ctx, w, h, 135, [
        [0, "#064e3b"],
        [0.52, "#0d9488"],
        [1, "#38bdf8"],
      ]),
  },
  {
    id: "amber-dusk",
    name: "Amber Dusk",
    category: "gradient",
    css: "linear-gradient(135deg, #271510 0%, #9a3412 52%, #f59e0b 100%)",
    draw: (ctx, w, h) =>
      drawLinearGradient(ctx, w, h, 135, [
        [0, "#271510"],
        [0.52, "#9a3412"],
        [1, "#f59e0b"],
      ]),
  },
  {
    id: "rose-silk",
    name: "Rosé Silk",
    category: "gradient",
    css: "linear-gradient(135deg, #3b1d3e 0%, #be185d 52%, #fda4af 100%)",
    draw: (ctx, w, h) =>
      drawLinearGradient(ctx, w, h, 135, [
        [0, "#3b1d3e"],
        [0.52, "#be185d"],
        [1, "#fda4af"],
      ]),
  },
  {
    id: "cloud-mist",
    name: "Cloud Mist",
    category: "gradient",
    css: "linear-gradient(135deg, #e2e8f0 0%, #dbeafe 50%, #fce7f3 100%)",
    draw: (ctx, w, h) =>
      drawLinearGradient(ctx, w, h, 135, [
        [0, "#e2e8f0"],
        [0.5, "#dbeafe"],
        [1, "#fce7f3"],
      ]),
  },

  // Abstract Meshes & Textures
  {
    id: "mesh-cobalt",
    name: "Cobalt Mesh",
    category: "abstract",
    css: "radial-gradient(circle at 20% 20%, #6366f1 0%, transparent 55%), radial-gradient(circle at 80% 80%, #06b6d4 0%, transparent 55%), #090d1f",
    draw: (ctx, w, h) =>
      drawMeshOrbs(ctx, w, h, "#090d1f", [
        { x: 0.18, y: 0.2, r: 0.62, color: "rgba(99, 102, 241, 0.78)" },
        { x: 0.84, y: 0.82, r: 0.65, color: "rgba(6, 182, 212, 0.72)" },
        { x: 0.78, y: 0.15, r: 0.45, color: "rgba(192, 132, 252, 0.45)" },
      ]),
  },
  {
    id: "mesh-ember",
    name: "Ember Bloom",
    category: "abstract",
    css: "radial-gradient(circle at 25% 75%, #f97316 0%, transparent 55%), radial-gradient(circle at 80% 25%, #e11d48 0%, transparent 55%), #160c0a",
    draw: (ctx, w, h) =>
      drawMeshOrbs(ctx, w, h, "#160c0a", [
        { x: 0.22, y: 0.75, r: 0.6, color: "rgba(249, 115, 22, 0.72)" },
        { x: 0.8, y: 0.24, r: 0.6, color: "rgba(225, 29, 72, 0.68)" },
        { x: 0.5, y: 0.5, r: 0.45, color: "rgba(251, 191, 36, 0.25)" },
      ]),
  },
  {
    id: "mesh-nordic",
    name: "Nordic Aura",
    category: "abstract",
    css: "radial-gradient(circle at 18% 30%, #88c0d0 0%, transparent 55%), radial-gradient(circle at 82% 75%, #81a1c1 0%, transparent 55%), #242933",
    draw: (ctx, w, h) =>
      drawMeshOrbs(ctx, w, h, "#242933", [
        { x: 0.18, y: 0.3, r: 0.6, color: "rgba(136, 192, 208, 0.55)" },
        { x: 0.82, y: 0.74, r: 0.62, color: "rgba(129, 161, 193, 0.52)" },
        { x: 0.55, y: 0.15, r: 0.45, color: "rgba(180, 142, 173, 0.35)" },
      ]),
  },
  {
    id: "studio-grid",
    name: "Studio Grid",
    category: "abstract",
    css: "repeating-linear-gradient(90deg, rgba(255,255,255,0.06) 0 1px, transparent 1px 20px), repeating-linear-gradient(0deg, rgba(255,255,255,0.06) 0 1px, transparent 1px 20px), linear-gradient(135deg, #11131a, #1d2233)",
    draw: (ctx, w, h) => {
      drawLinearGradient(ctx, w, h, 135, [
        [0, "#101218"],
        [1, "#1c2234"],
      ]);
      const step = Math.max(24, Math.round(Math.min(w, h) / 18));
      ctx.strokeStyle = "rgba(255, 255, 255, 0.055)";
      ctx.lineWidth = 1;
      for (let x = 0; x <= w; x += step) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, h);
        ctx.stroke();
      }
      for (let y = 0; y <= h; y += step) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(w, y);
        ctx.stroke();
      }
      const glow = ctx.createRadialGradient(w * 0.5, h * 0.45, 0, w * 0.5, h * 0.45, w * 0.55);
      glow.addColorStop(0, "rgba(142, 162, 255, 0.18)");
      glow.addColorStop(1, "rgba(0, 0, 0, 0)");
      ctx.fillStyle = glow;
      ctx.fillRect(0, 0, w, h);
    },
  },

  // Scenic Wallpapers
  {
    id: "scenic-alpine",
    name: "Alpine Dusk",
    category: "scenic",
    css: "linear-gradient(180deg, #1e1b4b 0%, #6d28d9 42%, #fb7185 72%, #1c1936 100%)",
    draw: (ctx, w, h) =>
      drawMountainScene(
        ctx,
        w,
        h,
        [
          [0, "#141332"],
          [0.42, "#4c1d95"],
          [0.72, "#f472b6"],
          [1, "#fda4af"],
        ],
        { x: 0.72, y: 0.34, r: 0.085, color: "#fef08a" },
        [
          { y: 0.64, color: "#3b235a", seed: 1.2, amp: 0.07 },
          { y: 0.74, color: "#261844", seed: 2.7, amp: 0.06 },
          { y: 0.85, color: "#140e28", seed: 4.4, amp: 0.045 },
        ],
      ),
  },
  {
    id: "scenic-desert",
    name: "Golden Dunes",
    category: "scenic",
    css: "linear-gradient(180deg, #2b1d2e 0%, #b45309 48%, #fcd34d 72%, #451a03 100%)",
    draw: (ctx, w, h) =>
      drawMountainScene(
        ctx,
        w,
        h,
        [
          [0, "#24192b"],
          [0.45, "#b45309"],
          [0.72, "#fbbf24"],
          [1, "#fef3c7"],
        ],
        { x: 0.3, y: 0.36, r: 0.095, color: "#fffbeb" },
        [
          { y: 0.66, color: "#92400e", seed: 0.5, amp: 0.05 },
          { y: 0.76, color: "#78350f", seed: 3.1, amp: 0.045 },
          { y: 0.87, color: "#451a03", seed: 5.2, amp: 0.035 },
        ],
      ),
  },
  {
    id: "scenic-fjord",
    name: "Midnight Fjord",
    category: "scenic",
    css: "linear-gradient(180deg, #071324 0%, #0f3a52 45%, #34d399 72%, #071320 100%)",
    draw: (ctx, w, h) =>
      drawMountainScene(
        ctx,
        w,
        h,
        [
          [0, "#050d1a"],
          [0.4, "#0f2e42"],
          [0.68, "#10b981"],
          [1, "#064e3b"],
        ],
        { x: 0.25, y: 0.25, r: 0.065, color: "#e0f2fe" },
        [
          { y: 0.62, color: "#0c2536", seed: 2.0, amp: 0.08 },
          { y: 0.75, color: "#081c2b", seed: 4.1, amp: 0.06 },
          { y: 0.87, color: "#04101a", seed: 6.3, amp: 0.03 },
        ],
      ),
  },
  {
    id: "scenic-paper-hills",
    name: "Warm Horizon",
    category: "scenic",
    css: "linear-gradient(180deg, #f8efe2 0%, #f1d3b3 48%, #d9825b 75%, #7c3f2c 100%)",
    draw: (ctx, w, h) =>
      drawMountainScene(
        ctx,
        w,
        h,
        [
          [0, "#f9f2e7"],
          [0.5, "#f2d2b1"],
          [0.78, "#e39c73"],
          [1, "#c46b47"],
        ],
        { x: 0.68, y: 0.32, r: 0.09, color: "#fffaf0" },
        [
          { y: 0.68, color: "#c97a57", seed: 1.5, amp: 0.05 },
          { y: 0.78, color: "#a4573a", seed: 3.4, amp: 0.045 },
          { y: 0.88, color: "#6e3726", seed: 5.8, amp: 0.03 },
        ],
      ),
  },

  // Solid Tones
  {
    id: "solid-obsidian",
    name: "Obsidian",
    category: "solid",
    css: "#0d0e12",
    draw: (ctx, w, h) => {
      ctx.fillStyle = "#0d0e12";
      ctx.fillRect(0, 0, w, h);
    },
  },
  {
    id: "solid-slate",
    name: "Studio Slate",
    category: "solid",
    css: "#1e2430",
    draw: (ctx, w, h) => {
      ctx.fillStyle = "#1e2430";
      ctx.fillRect(0, 0, w, h);
    },
  },
  {
    id: "solid-cream",
    name: "Warm Paper",
    category: "solid",
    css: "#f3ede2",
    draw: (ctx, w, h) => {
      ctx.fillStyle = "#f3ede2";
      ctx.fillRect(0, 0, w, h);
    },
  },
  {
    id: "solid-snow",
    name: "Crisp White",
    category: "solid",
    css: "#f8fafc",
    draw: (ctx, w, h) => {
      ctx.fillStyle = "#f8fafc";
      ctx.fillRect(0, 0, w, h);
    },
  },
];

export function getBackgroundById(id: string): StudioBackground {
  return STUDIO_BACKGROUNDS.find((b) => b.id === id) ?? STUDIO_BACKGROUNDS[0];
}
