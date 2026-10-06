// Packages a self-contained snapshot of the site into dist-artifact/ for sharing as a Claude Artifact:
// the page body without its own <html>/<head> skeleton, candidate photos inlined as small data URIs, and a flag
// that turns off the live Polymarket calls (the artifact sandbox blocks outside requests).
// Usage: node scripts/build-artifact.mjs   (after update.mjs)
import fs from "node:fs";
import sharp from "sharp";

const root = new URL("../", import.meta.url);
const out = new URL("dist-artifact/", root);
const p = (u) => u.pathname.replace(/^\/([A-Za-z]:)/, "$1");
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(new URL("data/", out), { recursive: true });

// page: keep <title> + font link, drop the document skeleton and social meta
const html = fs.readFileSync(new URL("index.html", root), "utf8");
const title = html.match(/<title>[\s\S]*?<\/title>/)[0];
const fonts = html.match(/<link rel="stylesheet" href="https:\/\/fonts\.googleapis\.com[^>]+>/)[0];
const body = html.match(/<body>([\s\S]*)<\/body>/)[1].replace('<script src="/app.js" defer></script>', '<script>window.CR_STATIC = true;</script>\n<script src="app.js" defer></script>');
fs.writeFileSync(new URL("index.html", out), `${title}\n${fonts}\n<link rel="stylesheet" href="styles.css">\n${body.trim()}\n`);
for (const f of ["styles.css", "app.js"]) fs.copyFileSync(new URL(f, root), new URL(f, out));
for (const f of ["history.json", "states.json", "districts.json", "photos.json"]) fs.copyFileSync(new URL(`data/${f}`, root), new URL(`data/${f}`, out));

// inline photos (downsized) into latest.json
const latest = JSON.parse(fs.readFileSync(new URL("data/latest.json", root)));
const cache = new Map();
async function inline(src) {
  if (!src || src.startsWith("data:")) return src;
  if (cache.has(src)) return cache.get(src);
  const file = new URL(src, root);
  if (!fs.existsSync(file)) return null;
  const buf = await sharp(p(file)).resize(120, 120).webp({ quality: 68 }).toBuffer();
  const uri = `data:image/webp;base64,${buf.toString("base64")}`;
  cache.set(src, uri);
  return uri;
}
for (const r of latest.races) for (const c of r.c) c.img = await inline(c.img);
for (const d of latest.districts) for (const c of d.c) c.img = await inline(c.img);
fs.writeFileSync(new URL("data/latest.json", out), JSON.stringify(latest));
const size = fs.statSync(new URL("data/latest.json", out)).size;
console.log(`dist-artifact/ ready: ${cache.size} photos inlined, latest.json ${(size / 1024 / 1024).toFixed(2)} MB`);
