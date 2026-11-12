// Packs a built game folder (dist) into ONE html file that works by double-click (no server, no internet).
// usage: node scripts/packSingle.mjs <distDir> <out.html>
import { readFileSync, readdirSync, existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const [dist, out] = process.argv.slice(2);
if (!dist || !out) throw new Error('usage: node scripts/packSingle.mjs <distDir> <out.html>');
const b64 = (f) => readFileSync(f).toString('base64');
const read = (f) => readFileSync(f, 'utf8');

let html = read(join(dist, 'index.html'));
const jsFile = /<script type="module" crossorigin src="\.\/(assets\/[^"]+)"><\/script>/.exec(html)?.[1];
const cssFile = /<link rel="stylesheet" crossorigin href="\.\/(assets\/[^"]+)">/.exec(html)?.[1];
if (!jsFile || !cssFile) throw new Error('could not find the built script/style in index.html');

// css: fonts as data: urls (woff2 only)
let css = read(join(dist, cssFile));
css = css.replace(/url\(([^)]+\.woff2)\)/g, (m, p) => {
  const f = join(dist, 'assets', p.split('/').pop());
  return existsSync(f) ? `url(data:font/woff2;base64,${b64(f)})` : m;
});
css = css.replace(/,\s*url\([^)]+\.woff\)\s*format\("woff"\)/g, '');

// pictures used by the game (same names the manifest lists) + backgrounds
const manifest = read('src/render/artManifest.ts');
const names = new Set([...manifest.matchAll(/'([A-Za-z0-9]+-\d+)'/g)].map((m) => m[1]));
for (const n of ['bg-day', 'bg-rain', 'bg-night']) names.add(n);
const art = {};
for (const n of [...names].sort()) {
  const f = join('public/art', `${n}.webp`);
  if (existsSync(f)) art[n] = `data:image/webp;base64,${b64(f)}`;
}
const sfx = {};
for (const [id, file] of [['meow', 'cat'], ['ghost', 'ghost'], ['ring', 'ring']]) {
  const f = join('public/sfx', `${file}.mp3`);
  if (existsSync(f)) sfx[id] = `data:audio/mpeg;base64,${b64(f)}`;
}
const voice = {};
if (existsSync('public/voice')) for (const f of readdirSync('public/voice')) if (/^[a-z0-9-]+\.mp3$/.test(f)) voice[f] = `data:audio/mpeg;base64,${b64(join('public/voice', f))}`;

const js = read(join(dist, jsFile)).replaceAll('</script', '<\\/script');
const pre = `<script>window.__ART__=${JSON.stringify(art)};window.__SFX__=${JSON.stringify(sfx)};window.__VOICE__=${JSON.stringify(voice)};</script>`;
html = html
  .replace(/<script type="module" crossorigin src="[^"]+"><\/script>/, '')
  .replace(/<link rel="stylesheet" crossorigin href="[^"]+">/, () => `<style>${css}</style>`)
  .replace('</body>', () => `${pre}\n<script type="module">\n${js}\n</script>\n</body>`); // function replacers: the code contains $ patterns that a string replacement would mangle
writeFileSync(out, html);
console.log(out, Math.round(html.length / 1024) + ' KB', Object.keys(art).length + ' pictures', Object.keys(voice).length + ' voice files');
