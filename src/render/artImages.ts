/**
 * Optional watercolor pictures. Everything is drawn from procedural shapes first; a picture is used only if it
 * finished loading. A missing/broken file never breaks drawing (the shapes stay).
 */
type Source = CanvasImageSource & { width: number; height: number };

const store = new Map<string, Source>();

/** Registers a loaded picture (also used by tests). */
export function registerArt(name: string, src: Source): void {
  store.set(name, src);
}

export function clearArt(): void {
  store.clear();
}

export function artImage(name: string): Source | null {
  return store.get(name) ?? null;
}

/** Starts loading `${base}${name}.webp` for each name. Silent on failure. */
export function preloadArt(names: readonly string[], base = 'art/'): void {
  if (typeof Image === 'undefined') return;
  for (const name of names) {
    if (store.has(name)) continue;
    try {
      const img = new Image();
      img.onload = () => {
        if (img.naturalWidth > 0) store.set(name, img);
      };
      img.onerror = () => undefined;
      // a single-file build (hosted demo) may provide the pictures inline as data URIs
      const inline = (globalThis as { __ART__?: Record<string, string> }).__ART__;
      img.src = inline?.[name] ?? `${base}${name}.webp`;
    } catch {
      /* picture stays missing: shapes are drawn instead */
    }
  }
}

const silhouettes = new Map<string, CanvasImageSource | null>();

/** A solid-color copy of a picture's shape (for outlines); null when canvases are unavailable. Cached. */
function silhouette(name: string, img: Source, color: string): CanvasImageSource | null {
  const key = `${name}|${color}`;
  if (silhouettes.has(key)) return silhouettes.get(key) ?? null;
  let out: CanvasImageSource | null = null;
  try {
    if (typeof document !== 'undefined') {
      const w = (img as { naturalWidth?: number }).naturalWidth || img.width;
      const h = (img as { naturalHeight?: number }).naturalHeight || img.height;
      const c = document.createElement('canvas');
      c.width = w;
      c.height = h;
      const g = c.getContext('2d');
      if (g && w > 0 && h > 0) {
        g.drawImage(img, 0, 0, w, h);
        g.globalCompositeOperation = 'source-in';
        g.fillStyle = color;
        g.fillRect(0, 0, w, h);
        out = c;
      }
    }
  } catch {
    out = null;
  }
  silhouettes.set(key, out);
  return out;
}

const OUTLINE_DIRS = Array.from({ length: 12 }, (_, i) => [Math.cos((i / 12) * Math.PI * 2), Math.sin((i / 12) * Math.PI * 2)] as const);

/** Draws a picture fitted inside a box, centered at (cx, cy). Returns false when it is not available. */
export function drawArt(
  ctx: CanvasRenderingContext2D,
  name: string,
  cx: number,
  cy: number,
  boxW: number,
  boxH: number,
  rot = 0,
  scaleX = 1,
  scaleY = 1,
  outline = 0,
): boolean {
  const img = artImage(name);
  if (!img) return false;
  const iw = (img as { naturalWidth?: number }).naturalWidth || img.width;
  const ih = (img as { naturalHeight?: number }).naturalHeight || img.height;
  if (!(iw > 0) || !(ih > 0) || !Number.isFinite(cx) || !Number.isFinite(cy) || !(boxW > 0) || !(boxH > 0)) return false;
  const s = Math.min(boxW / iw, boxH / ih);
  ctx.save();
  try {
    ctx.translate(cx, cy);
    if (Number.isFinite(rot) && rot !== 0) ctx.rotate(rot);
    ctx.scale(Number.isFinite(scaleX) ? scaleX : 1, Number.isFinite(scaleY) ? scaleY : 1);
    const dw = iw * s;
    const dh = ih * s;
    if (outline > 0 && Number.isFinite(outline)) {
      // a cream ring with a dark outer edge, so the picture stays readable on any background
      const dark = silhouette(name, img, '#3a2216');
      const cream = silhouette(name, img, '#fff4dc');
      for (const [sil, r] of [[dark, outline * 1.9], [cream, outline]] as const) {
        if (!sil) continue;
        for (const [dx, dy] of OUTLINE_DIRS) ctx.drawImage(sil, -dw / 2 + dx * r, -dh / 2 + dy * r, dw, dh);
      }
    }
    ctx.drawImage(img, -dw / 2, -dh / 2, dw, dh);
  } finally {
    ctx.restore();
  }
  return true;
}
