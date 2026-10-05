// Downloads candidate headshots into img/c/ and records them in data/photos.json.
// Sitting members are matched through their congressional Wikipedia IDs; challengers by name, accepted only when the
// Wikipedia description reads like a politician. Already-downloaded photos are skipped, so reruns are cheap.
// Usage: node scripts/photos.mjs   (run after update.mjs so data/latest.json lists the candidates)
import fs from "node:fs";
import sharp from "sharp";

const root = new URL("../", import.meta.url);
const latest = JSON.parse(fs.readFileSync(new URL("data/latest.json", root)));
const LEG = JSON.parse(fs.readFileSync(new URL("scripts/legislators-current.json", root)));
const photosPath = new URL("data/photos.json", root);
const photos = fs.existsSync(photosPath) ? JSON.parse(fs.readFileSync(photosPath)) : {};
const missesPath = new URL("data/photo-misses.json", root);
const misses = fs.existsSync(missesPath) ? JSON.parse(fs.readFileSync(missesPath)) : {};
const UA = { "User-Agent": "midterm-tracker/1.0 (https://github.com/sulaimwn; election dashboard photo cache)" };

const norm = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[“”"’']/g, "").replace(/\b(jr|sr|ii|iii)\b\.?/g, "").replace(/\s+/g, " ").trim();
const slug = (s) => norm(s).replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const CFG = JSON.parse(fs.readFileSync(new URL("config/senate.json", root)));
const WIKI = {};
for (const r of CFG.races) for (const c of r.c) if (c.wiki) WIKI[`${r.st}|${slug(c.name)}`] = c.wiki;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const STATE_NAMES = { AL: "Alabama", AK: "Alaska", AZ: "Arizona", AR: "Arkansas", CA: "California", CO: "Colorado", CT: "Connecticut", DE: "Delaware", FL: "Florida", GA: "Georgia", HI: "Hawaii", ID: "Idaho", IL: "Illinois", IN: "Indiana", IA: "Iowa", KS: "Kansas", KY: "Kentucky", LA: "Louisiana", ME: "Maine", MD: "Maryland", MA: "Massachusetts", MI: "Michigan", MN: "Minnesota", MS: "Mississippi", MO: "Missouri", MT: "Montana", NE: "Nebraska", NV: "Nevada", NH: "New Hampshire", NJ: "New Jersey", NM: "New Mexico", NY: "New York", NC: "North Carolina", ND: "North Dakota", OH: "Ohio", OK: "Oklahoma", OR: "Oregon", PA: "Pennsylvania", RI: "Rhode Island", SC: "South Carolina", SD: "South Dakota", TN: "Tennessee", TX: "Texas", UT: "Utah", VT: "Vermont", VA: "Virginia", WA: "Washington", WV: "West Virginia", WI: "Wisconsin", WY: "Wyoming" };

const members = LEG.map((l) => { const t = l.terms[l.terms.length - 1]; return { first: norm(l.name.first), nick: norm(l.name.nickname || ""), last: norm(l.name.last), state: t.state, wiki: l.id.wikipedia, bioguide: l.id.bioguide }; });
function member(name, st) {
  const n = norm(name).split(" "), fn = n[0], ln = n[n.length - 1];
  return members.find((m) => m.state === st && (m.last.endsWith(ln) || ln.endsWith(m.last.split(" ").pop())) && (m.first.startsWith(fn) || fn.startsWith(m.first) || (m.nick && fn.startsWith(m.nick)) || fn[0] === m.first[0]));
}

// Candidate list
const want = [];
for (const r of latest.races) for (const c of r.c) if (!c.generic) want.push({ name: c.name, st: r.st, wiki: WIKI[`${r.st}|${slug(c.name)}`] || null });
for (const d of latest.districts) for (const c of d.c) if (!c.generic && c.party !== "O" || (c.party === "O" && c.pm > 0.05)) want.push({ name: c.name, st: d.st });
const todo = want.filter((w) => !photos[`${w.st}|${slug(w.name)}`] && (w.wiki || !misses[`${w.st}|${slug(w.name)}`]));
console.log(`${want.length} candidates, ${todo.length} still need a photo lookup`);

async function wikiQuery(titles) {
  const url = `https://en.wikipedia.org/w/api.php?action=query&format=json&redirects=1&prop=pageimages|description|pageprops|extracts&exintro=1&explaintext=1&exsentences=2&exlimit=max&ppprop=disambiguation&piprop=thumbnail|name&pithumbsize=320&titles=${encodeURIComponent(titles.join("|"))}`;
  for (let i = 0; i < 4; i++) {
    try { const r = await fetch(url, { headers: UA }); if (r.ok) return await r.json(); } catch {}
    await sleep(1000 * (i + 1));
  }
  return null;
}
const POL = /politician|senator|representative|congress|legislat|state house|state senate|mayor|lawyer|attorney|activist|businessman|businesswoman|executive|official|veteran|candidate|nominee|commissioner|educator|physician|nurse|teacher|pastor|farmer|journalist|broadcaster|sportscaster|football|military|officer|judge|prosecutor|economist|engineer|politic/i;

// Resolve titles in batches: member wiki IDs first, then name guesses.
const resolved = new Map();
const guesses = [];
for (const w of todo) {
  const m = member(w.name, w.st);
  const titles = w.wiki ? [w.wiki] : m?.wiki ? [m.wiki] : [w.name, `${w.name} (politician)`, `${w.name} (American politician)`, `${w.name} (${STATE_NAMES[w.st]} politician)`];
  w.isMember = !!m; w.bioguide = m?.bioguide;
  for (const t of titles) guesses.push({ w, t });
}
const titleSet = [...new Set(guesses.map((g) => g.t))];
const pages = new Map();
for (let i = 0; i < titleSet.length; i += 20) {
  const res = await wikiQuery(titleSet.slice(i, i + 20));
  if (!res?.query) continue;
  const redir = new Map();
  for (const x of [...(res.query.normalized || []), ...(res.query.redirects || [])]) redir.set(x.from, x.to);
  const byTitle = new Map(Object.values(res.query.pages || {}).map((p) => [p.title, p]));
  for (const t of titleSet.slice(i, i + 20)) {
    let tt = t; for (let k = 0; k < 3 && redir.has(tt); k++) tt = redir.get(tt);
    const p = byTitle.get(tt);
    if (p && !p.missing && p.pageid) pages.set(t, p);
  }
  await sleep(150);
}
for (const { w, t } of guesses) {
  const key = `${w.st}|${slug(w.name)}`;
  if (resolved.has(key)) continue;
  const p = pages.get(t);
  if (!p || p.pageprops?.disambiguation !== undefined || !p.thumbnail) continue;
  const text = `${p.description || ""} ${p.extract || ""}`;
  const lastOk = norm(p.title).includes(norm(w.name).split(" ").pop());
  const plausible = w.isMember || w.wiki || (lastOk && POL.test(text) && (/american/i.test(text) || text.includes(STATE_NAMES[w.st])));
  if (plausible) resolved.set(key, { w, page: p });
}
console.log(`resolved ${resolved.size} of ${todo.length}`);

let ok = 0;
const entries = [...resolved.entries()];
const failed = new Set();
const workers = Array.from({ length: 2 }, async () => {
  while (entries.length) {
    const [key, { w, page }] = entries.shift();
    try {
      let r;
      for (let i = 0; i < 5; i++) { r = await fetch(page.thumbnail.source, { headers: UA }); if (r.status !== 429) break; await sleep(4000 * (i + 1)); }
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const buf = Buffer.from(await r.arrayBuffer());
      const file = `img/c/${w.st.toLowerCase()}-${slug(w.name)}.webp`;
      await sharp(buf).resize(200, 200, { fit: "cover", position: sharp.strategy.attention }).webp({ quality: 74 }).toFile(new URL(file, root).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
      photos[key] = { src: file, title: page.title, file: page.pageimage, wiki: `https://en.wikipedia.org/wiki/${encodeURIComponent(page.title.replace(/ /g, "_"))}` };
      ok++;
    } catch (e) { failed.add(key); console.warn(`  ! ${w.name}: ${e.message}`); }
    await sleep(350);
  }
});
await Promise.all(workers);
// Fallback for sitting members: official portrait from the congressional bioguide collection (public domain).
for (const w of todo) {
  const key = `${w.st}|${slug(w.name)}`;
  if (photos[key] || !w.bioguide) continue;
  try {
    const r = await fetch(`https://unitedstates.github.io/images/congress/225x275/${w.bioguide}.jpg`, { headers: UA });
    if (!r.ok) continue;
    const file = `img/c/${w.st.toLowerCase()}-${slug(w.name)}.webp`;
    await sharp(Buffer.from(await r.arrayBuffer())).resize(200, 200, { fit: "cover", position: "north" }).webp({ quality: 74 }).toFile(new URL(file, root).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
    photos[key] = { src: file, title: w.name, file: `${w.bioguide}.jpg`, wiki: `https://bioguide.congress.gov/search/bio/${w.bioguide}` };
    failed.delete(key); resolved.set(key, true); ok++;
  } catch {}
}
for (const w of todo) { const k = `${w.st}|${slug(w.name)}`; if (!photos[k] && !failed.has(k) && !resolved.has(k)) misses[k] = new Date().toISOString().slice(0, 10); }
fs.writeFileSync(photosPath, JSON.stringify(photos, null, 0));
fs.writeFileSync(missesPath, JSON.stringify(misses, null, 0));
console.log(`downloaded ${ok}; ${Object.keys(photos).length} photos total; ${Object.keys(misses).length} without a usable photo`);
