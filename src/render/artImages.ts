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
    ctx.drawImage(img, (-iw * s) / 2, (-ih * s) / 2, iw * s, ih * s);
  } finally {
    ctx.restore();
  }
  return true;
}
