"""Splits transparent sprite sheets into separate webp files: crops each piece to its own box and nothing else.
The artist's pixels and transparency are kept exactly (no background removal, no white removal, no hole filling, no
blur). Drips and small parts stay with their item. Optional clean-up only if TOUCHUP=1. Dev tool, not used at runtime.
usage: python3 tools/cutSheets.py <image> <prefix> [maxSide] [outdir]"""
import sys, os
import numpy as np
from PIL import Image
from scipy import ndimage as nd

TOUCHUP = bool(os.environ.get('TOUCHUP'))
WHITE = 196      # min channel above this counts as "near white"
HALO_REACH = 22
AGG = {int(v) for v in os.environ.get('AGGRESSIVE_ITEMS', '').split(',') if v.strip()}  # 1-based items with no legitimately white parts  # white halo is only removed within this many pixels of the outside
GROUP = int(os.environ.get('GROUP', '5'))        # parts closer than this belong to the same item
REACH = 70       # small parts within this distance of a bigger item belong to it


def defringe(rgb, alpha, aggressive=False):
    solid = alpha > 24
    outside = ~solid
    cand = solid & (rgb.min(axis=2) > WHITE)
    grow = outside.copy()
    removed = np.zeros_like(solid)
    for _ in range(HALO_REACH):
        nxt = nd.binary_dilation(grow, structure=np.ones((3, 3), bool)) & cand & ~removed
        if not nxt.any():
            break
        removed |= nxt
        grow = grow | nxt
    if aggressive:  # pieces with no legitimately white parts (egg-yolk threads): drop any pale pixel near the edge
        dist = nd.distance_transform_edt(solid)
        removed |= solid & (dist <= 70) & (rgb.min(axis=2) > 150)
    alpha = alpha.copy()
    alpha[removed] = 0
    return alpha


def cut(path, prefix, max_side=360, outdir='public/art'):
    raw = Image.open(path).convert('RGBA')
    ra = np.asarray(raw)
    rgb = ra[..., :3].astype(np.int16)
    alpha0 = ra[..., 3]
    mask = alpha0 > 24
    grouped = nd.binary_dilation(mask, iterations=GROUP)
    lab, n = nd.label(grouped)
    objs = nd.find_objects(lab)
    area = [((lab[sl] == i + 1) & mask[sl]).sum() for i, sl in enumerate(objs)]
    big = [i for i in range(n) if area[i] >= 2500]
    # small parts (drips, bubbles, crumbs) join the nearest big item whose box (grown by REACH) contains them
    for i in range(n):
        if i in big or area[i] < 40:
            continue
        sl = objs[i]
        cy, cx = (sl[0].start + sl[0].stop) / 2, (sl[1].start + sl[1].stop) / 2
        best, bd = None, 1e9
        for j in big:
            bs = objs[j]
            dy = max(bs[0].start - cy, 0, cy - bs[0].stop)
            dx = max(bs[1].start - cx, 0, cx - bs[1].stop)
            d = (dx * dx + dy * dy) ** 0.5
            if d < bd:
                best, bd = j, d
        if best is not None and bd <= REACH:
            lab[lab == i + 1] = best + 1
    objs = nd.find_objects(lab)
    items = [(objs[i], i + 1) for i in big]
    items.sort(key=lambda t: (t[0][0].start + t[0][0].stop) / 2)
    rows, cur = [], []
    for it in items:
        cy = (it[0][0].start + it[0][0].stop) / 2
        if cur and cy - np.mean([(c[0][0].start + c[0][0].stop) / 2 for c in cur]) > 110:
            rows.append(cur); cur = []
        cur.append(it)
    if cur:
        rows.append(cur)
    os.makedirs(outdir, exist_ok=True)
    out, k = [], 0
    for r in rows:
        for sl, lid in sorted(r, key=lambda t: t[0][1].start):
            y0, y1 = sl[0].start, sl[0].stop
            x0, x1 = sl[1].start, sl[1].stop
            lm = lab[y0:y1, x0:x1] == lid
            al = np.where(lm, alpha0[y0:y1, x0:x1], 0).astype(np.uint8)
            c = rgb[y0:y1, x0:x1]
            if TOUCHUP:
                al = defringe(c, al, (k + 1) in AGG)
            if TOUCHUP:
                solid = al > 24
                holes_all = nd.binary_fill_holes(solid) & ~solid
                hl, hn = nd.label(holes_all)
                holes = np.zeros_like(holes_all)
                for h in range(1, hn + 1):
                    m = hl == h
                    if m.sum() <= 0.012 * solid.sum():
                        holes |= m
                c = c.copy(); c[holes] = 250; al[holes] = 255
                al = nd.gaussian_filter(al.astype(np.float32), 0.6).clip(0, 255).astype(np.uint8)
            img = Image.fromarray(np.dstack([c.astype(np.uint8), al]), 'RGBA')
            bb = img.getchannel('A').point(lambda v: 255 if v > 8 else 0).getbbox()
            if bb:
                img = img.crop(bb)
            s = max_side / max(img.size)
            if s < 1:
                img = img.resize((max(1, round(img.width * s)), max(1, round(img.height * s))), Image.LANCZOS)
            k += 1
            name = f'{prefix}-{k}.webp'
            img.save(os.path.join(outdir, name), 'WEBP', quality=92, method=6, exact=True)
            out.append((name, img.size))
    return out


if __name__ == '__main__':
    for n, s in cut(sys.argv[1], sys.argv[2], int(sys.argv[3]) if len(sys.argv) > 3 else 360, sys.argv[4] if len(sys.argv) > 4 else 'public/art'):
        print(n, s)
