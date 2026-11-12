"""Cuts sprite sheets (white background) into separate transparent webp files. Dev tool, not used at runtime.
usage: python3 tools/cutSheets.py <image> <prefix> [maxSide]   -> public/art/<prefix>-<n>.webp (row-major)"""
import sys, os
import numpy as np
from PIL import Image
from scipy import ndimage as nd

def cut(path, prefix, max_side=320, outdir='public/art'):
    raw = Image.open(path).convert('RGBA')
    ra = np.asarray(raw)
    has_alpha = ra[..., 3].min() < 200
    a = ra[..., :3].astype(np.int16)
    nonwhite = (ra[..., 3] > 24) if has_alpha else ((255 - a.min(axis=2)) > 14)
    grown = nd.binary_dilation(nonwhite, iterations=3)
    lab, n = nd.label(grown)
    objs = nd.find_objects(lab)
    items = []
    for i, sl in enumerate(objs):
        h = sl[0].stop - sl[0].start; w = sl[1].stop - sl[1].start
        if h * w < 60 * 60: continue
        items.append((sl, i + 1))
    # row-major ordering: group by vertical centre
    items.sort(key=lambda t: (t[0][0].start + t[0][0].stop) / 2)
    rows, cur = [], []
    for it in items:
        cy = (it[0][0].start + it[0][0].stop) / 2
        if cur and cy - np.mean([(c[0][0].start + c[0][0].stop) / 2 for c in cur]) > 110:
            rows.append(cur); cur = []
        cur.append(it)
    if cur: rows.append(cur)
    out = []
    os.makedirs(outdir, exist_ok=True)
    k = 0
    for r in rows:
        for sl, lid in sorted(r, key=lambda t: t[0][1].start):
            pad = 4
            y0 = max(0, sl[0].start - pad); y1 = min(a.shape[0], sl[0].stop + pad)
            x0 = max(0, sl[1].start - pad); x1 = min(a.shape[1], sl[1].stop + pad)
            crop = a[y0:y1, x0:x1]
            if has_alpha:
                al = ra[y0:y1, x0:x1, 3]
                lm = lab[y0:y1, x0:x1] == lid
                al = np.where(lm, al, 0).astype(np.uint8)
                solid = lm & (al > 24)
                holes = nd.binary_fill_holes(solid) & ~solid  # enclosed see-through spots (white highlights) -> opaque white
                crop = crop.copy(); crop[holes] = 250; al[holes] = 255
                img = Image.fromarray(np.dstack([crop.astype(np.uint8), al]), 'RGBA')
                bb = img.getchannel('A').point(lambda v: 255 if v > 8 else 0).getbbox()
                if bb: img = img.crop(bb)
                s = max_side / max(img.size)
                if s < 1: img = img.resize((max(1, round(img.width * s)), max(1, round(img.height * s))), Image.LANCZOS)
                k += 1
                name = f'{prefix}-{k}.webp'
                img.save(os.path.join(outdir, name), 'WEBP', quality=88, method=6)
                out.append((name, img.size))
                continue
            white = (255 - crop.min(axis=2)) <= 14
            wl, wn = nd.label(white)
            edge = set(np.unique(np.concatenate([wl[0], wl[-1], wl[:, 0], wl[:, -1]]))) - {0}
            bg = np.isin(wl, list(edge))
            alpha = (~bg).astype(np.uint8) * 255
            alpha = nd.binary_erosion(alpha > 0, iterations=1).astype(np.uint8) * 255
            alpha = (nd.gaussian_filter(alpha.astype(np.float32), 0.8)).clip(0, 255).astype(np.uint8)
            rgba = np.dstack([crop.astype(np.uint8), alpha])
            img = Image.fromarray(rgba, 'RGBA')
            bb = img.getchannel('A').point(lambda v: 255 if v > 8 else 0).getbbox()
            if bb: img = img.crop(bb)
            s = max_side / max(img.size)
            if s < 1: img = img.resize((max(1, round(img.width * s)), max(1, round(img.height * s))), Image.LANCZOS)
            k += 1
            name = f'{prefix}-{k}.webp'
            img.save(os.path.join(outdir, name), 'WEBP', quality=88, method=6)
            out.append((name, img.size))
    return out

if __name__ == '__main__':
    for n, s in cut(sys.argv[1], sys.argv[2], int(sys.argv[3]) if len(sys.argv) > 3 else 320): print(n, s)
