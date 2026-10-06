// Builds the deployable site into an output folder (default _site):
//   - the app and its data
//   - a page for every Senate race (/senate/texas/), House district (/house/pa-08/) and state (/state/ohio/),
//     each with its own title, description and link-preview image (/og/...png) so shared links look right
//   - sitemap.xml listing every page
// Usage: node scripts/build-site.mjs [outDir]   (run after update.mjs)
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")), "..");
const OUT = path.resolve(ROOT, process.argv[2] || "_site");
const SITE = "https://pollsvsodds.com";
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");
const L = JSON.parse(read("data/latest.json"));
const H = JSON.parse(read("data/history.json"));

const STATE_NAMES = { AL: "Alabama", AK: "Alaska", AZ: "Arizona", AR: "Arkansas", CA: "California", CO: "Colorado", CT: "Connecticut", DE: "Delaware", FL: "Florida", GA: "Georgia", HI: "Hawaii", ID: "Idaho", IL: "Illinois", IN: "Indiana", IA: "Iowa", KS: "Kansas", KY: "Kentucky", LA: "Louisiana", ME: "Maine", MD: "Maryland", MA: "Massachusetts", MI: "Michigan", MN: "Minnesota", MS: "Mississippi", MO: "Missouri", MT: "Montana", NE: "Nebraska", NV: "Nevada", NH: "New Hampshire", NJ: "New Jersey", NM: "New Mexico", NY: "New York", NC: "North Carolina", ND: "North Dakota", OH: "Ohio", OK: "Oklahoma", OR: "Oregon", PA: "Pennsylvania", RI: "Rhode Island", SC: "South Carolina", SD: "South Dakota", TN: "Tennessee", TX: "Texas", UT: "Utah", VT: "Vermont", VA: "Virginia", WA: "Washington", WV: "West Virginia", WI: "Wisconsin", WY: "Wyoming" };
const PARTY = { D: "Democrat", R: "Republican", I: "Independent", O: "Other" };
const PARTIES = { D: "Democrats", R: "Republicans", I: "Independents" };
const COL = { D: "#1f5fd1", R: "#cf3131", I: "#7b4fc2", O: "#7b4fc2" };
const RATING_FILL = { D1: "#1f5fd1", D2: "#5f8fe4", D3: "#b3c9f2", T: "#d8c793", R3: "#f3b8b2", R2: "#e5736b", R1: "#cf3131", I1: "#7b4fc2", I2: "#a487d9", I3: "#d6c8ef" };
const F = "'Libre Franklin', 'Franklin Gothic Medium', Arial, 'DejaVu Sans', sans-serif";

// ---------- small helpers ----------
const slugify = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const pct = (p) => (p == null ? "—" : p > 0.995 ? ">99%" : p < 0.005 ? "<1%" : `${Math.round(p * 100)}%`);
const avg = (a, b) => (a != null && b != null ? (a + b) / 2 : a ?? b);
const words = (n) => n.replace(/["“”][^"“”]*["“”]/g, " ").split(/\s+/).filter((w) => w && !/^(jr|sr|ii|iii)\.?,?$/i.test(w));
const lastName = (n) => { const w = words(n); return w[w.length - 1] || n; };
const initials = (n) => { const w = words(n); return ((w[0]?.[0] || "") + (w.length > 1 ? w[w.length - 1][0] : "")).toUpperCase(); };
const poss = (s) => (s.endsWith("s") ? `${s}'` : `${s}'s`);
const ord = (n) => { const s = ["th", "st", "nd", "rd"], v = n % 100; return n + (s[(v - 20) % 10] || s[v] || s[0]); };
const updated = new Date(L.updated).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "America/New_York" });
function rating(pD, pR, pI = 0) {
  const lead = pD >= pR && pD >= pI ? "D" : pR >= pI ? "R" : "I", p = Math.max(pD, pR, pI);
  const tier = p >= 0.95 ? 1 : p >= 0.8 ? 2 : p >= 0.6 ? 3 : 0;
  return { lead, p, key: tier ? lead + tier : "T", label: tier ? `${["", "Very likely", "Likely", "Leaning"][tier]} ${PARTY[lead]}` : "Too close to call" };
}
const write = (rel, data) => { const f = path.join(OUT, rel); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, data); };

// ---------- 1) the app and its data ----------
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(path.join(OUT, "data"), { recursive: true });
for (const f of ["index.html", "app.js", "styles.css", "og.png", "robots.txt", "favicon.ico", "favicon.svg", "favicon-96.png", "apple-touch-icon.png"]) fs.copyFileSync(path.join(ROOT, f), path.join(OUT, f));
for (const f of ["latest.json", "history.json", "states.json", "districts.json", "photos.json"]) fs.copyFileSync(path.join(ROOT, "data", f), path.join(OUT, "data", f));
fs.cpSync(path.join(ROOT, "img"), path.join(OUT, "img"), { recursive: true });

// ---------- 2) preview images ----------
const xml = esc;
const photoCache = new Map();
async function photoURI(img) {
  if (!img || img.startsWith("data:")) return img || null;
  if (photoCache.has(img)) return photoCache.get(img);
  const file = path.join(ROOT, img);
  const uri = fs.existsSync(file) ? `data:image/png;base64,${(await sharp(file).resize(200, 200).png().toBuffer()).toString("base64")}` : null;
  photoCache.set(img, uri);
  return uri;
}
function avatar(id, cx, cy, r, c, uri) {
  const col = COL[c.party] || COL.O;
  const inner = uri
    ? `<clipPath id="${id}"><circle cx="${cx}" cy="${cy}" r="${r}"/></clipPath><image x="${cx - r}" y="${cy - r}" width="${2 * r}" height="${2 * r}" href="${uri}" xlink:href="${uri}" preserveAspectRatio="xMidYMid slice" clip-path="url(#${id})"/>`
    : `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${col}" opacity="0.85"/><text x="${cx}" y="${cy + r * 0.3}" text-anchor="middle" font-family="${F}" font-weight="800" font-size="${Math.round(r * 0.8)}" fill="#ffffff">${xml(c.generic ? c.party : initials(c.name))}</text>`;
  return `${inner}<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${col}" stroke-width="6"/>`;
}
const frame = (title, subtitle, body) => `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="1200" height="630" viewBox="0 0 1200 630">
  <rect width="1200" height="630" fill="#ffffff"/>
  <rect x="70" y="46" width="34" height="24" rx="3" fill="${COL.D}"/><rect x="87" y="46" width="17" height="24" fill="${COL.R}"/>
  <text x="116" y="67" font-family="${F}" font-weight="800" font-size="26" fill="#15171c">Polls vs. Odds</text>
  <text x="1130" y="67" text-anchor="end" font-family="${F}" font-weight="600" font-size="22" fill="#464b55">pollsvsodds.com</text>
  <text x="70" y="140" font-family="${F}" font-weight="800" font-size="50" fill="#15171c">${xml(title)}</text>
  <text x="70" y="180" font-family="${F}" font-size="24" fill="#464b55">${xml(subtitle)}</text>
  ${body}
  <text x="70" y="602" font-family="${F}" font-size="20" fill="#6f7480">Chance of winning from polls plus Polymarket and Kalshi · updated ${xml(updated)}</text>
</svg>`;
function candidate(x0, idx, c, p, uri) {
  const big = pct(p), col = COL[c.party] || COL.O;
  const meta = `${PARTY[c.party] || "Other"}${c.inc ? " · incumbent" : ""}`;
  const name = c.name.length > 24 ? lastName(c.name) : c.name;
  return `${avatar(`a${idx}`, x0 + 66, 286, 62, c, uri)}
    <text x="${x0 + 150}" y="262" font-family="${F}" font-weight="800" font-size="32" fill="#15171c">${xml(name)}</text>
    <text x="${x0 + 150}" y="294" font-family="${F}" font-size="22" fill="#464b55">${xml(meta)}</text>
    <text x="${x0 + 150}" y="352" font-family="${F}" font-weight="900" font-size="54" fill="${col}">${xml(big)}<tspan font-size="22" font-weight="600" fill="#464b55" dx="10">to win</tspan></text>`;
}
function bars(x, width, label, rows, P) {
  const col = COL[P] || COL.O, track = width - 230;
  return `<text x="${x}" y="422" font-family="${F}" font-weight="700" font-size="20" fill="#6f7480">${xml(label)}</text>` + rows.map(([name, v], i) => {
    const y = 448 + i * 46;
    return `<text x="${x}" y="${y + 8}" font-family="${F}" font-weight="${i === 2 ? 800 : 600}" font-size="22" fill="#15171c">${name}</text>
      <rect x="${x + 150}" y="${y - 10}" width="${track}" height="22" rx="11" fill="#eceef1"/>
      ${v != null ? `<rect x="${x + 150}" y="${y - 10}" width="${Math.max(11, track * v)}" height="22" rx="11" fill="${col}" opacity="${i === 2 ? 1 : 0.7}"/>` : ""}
      <text x="${x + width}" y="${y + 8}" text-anchor="end" font-family="${F}" font-weight="800" font-size="22" fill="${v != null ? col : "#6f7480"}">${v != null ? xml(pct(v)) : "n/a"}</text>`;
  }).join("");
}
function sparkline(x, width, series, P) {
  if (!series || series.length < 5) return "";
  const col = COL[P] || COL.O, y0 = 432, h = 118;
  const t0 = series[0][0], t1 = series[series.length - 1][0];
  const X = (t) => x + ((t - t0) / (t1 - t0 || 1)) * width, Y = (v) => y0 + (1 - v) * h;
  const pts = series.map(([t, v]) => `${X(t).toFixed(1)},${Y(v).toFixed(1)}`).join(" ");
  const last = series[series.length - 1];
  const days = Math.round((t1 - t0) / 86400);
  return `<text x="${x}" y="422" font-family="${F}" font-weight="700" font-size="20" fill="#6f7480">Betting odds, last ${days} days</text>
    <line x1="${x}" x2="${x + width}" y1="${Y(0.5)}" y2="${Y(0.5)}" stroke="#b9bec9" stroke-dasharray="6 6"/>
    <text x="${x + width + 8}" y="${Y(0.5) + 6}" font-family="${F}" font-size="16" fill="#6f7480">50%</text>
    <polyline points="${pts}" fill="none" stroke="${col}" stroke-width="5" stroke-linejoin="round" stroke-linecap="round"/>
    <circle cx="${X(last[0])}" cy="${Y(last[1])}" r="8" fill="${col}"/>`;
}
const toPNG = (svg, rel) => sharp(Buffer.from(svg)).png({ compressionLevel: 8 }).toBuffer().then((b) => write(rel, b));

// ---------- 3) pages ----------
const TEMPLATE = read("index.html");
const pages = [];
function page({ route, title, desc, urlPath, image }) {
  let h = TEMPLATE;
  const sub = (re, val) => { if (!re.test(h)) throw new Error(`index.html no longer matches ${re}`); h = h.replace(re, () => val); };
  const url = SITE + urlPath, img = SITE + image;
  sub(/<title>[^<]*<\/title>/, `<title>${esc(title)}</title>`);
  sub(/<link rel="canonical" href="[^"]*">/, `<link rel="canonical" href="${url}">`);
  sub(/<meta name="description" content="[^"]*">/, `<meta name="description" content="${esc(desc)}">`);
  sub(/<meta property="og:title" content="[^"]*">/, `<meta property="og:title" content="${esc(title)}">`);
  sub(/<meta property="og:description" content="[^"]*">/, `<meta property="og:description" content="${esc(desc)}">`);
  sub(/<meta property="og:image" content="[^"]*">/, `<meta property="og:image" content="${img}">`);
  sub(/<meta property="og:url" content="[^"]*">/, `<meta property="og:url" content="${url}">`);
  sub(/<meta name="twitter:card" content="summary_large_image">/, `<meta name="twitter:card" content="summary_large_image">\n<meta name="twitter:title" content="${esc(title)}">\n<meta name="twitter:description" content="${esc(desc)}">\n<meta name="twitter:image" content="${img}">`);
  sub(/<script src="\/app\.js" defer><\/script>/, `<script>window.CR_ROUTE = ${JSON.stringify(route)};</script>\n<script src="/app.js" defer></script>`);
  write(path.join(urlPath, "index.html"), h);
  pages.push(urlPath);
}

const jobs = [];
const queue = (fn) => jobs.push(fn);

// Senate races
const senateImage = {};
for (const r of L.races) {
  const A = r.altParty, alt = r.c.find((c) => c.party === A), rep = r.c.find((c) => c.party === "R");
  const p = r.p, odds = avg(r.pm?.[A], r.k?.[A]), rt = rating(p.D, p.R, p.I);
  const leader = p[A] >= p.R ? alt : rep, lp = Math.max(p[A], p.R);
  const slug = slugify(r.name), urlPath = `/senate/${slug}/`, image = `/og/senate-${slug}.png`;
  senateImage[r.st] = image;
  const title = `${r.name} Senate 2026: ${lastName(alt.name)} vs. ${lastName(rep.name)} | Polls vs. Odds`;
  const desc = `${leader.name} (${PARTY[leader.party]}) has a ${pct(lp)} chance to win the ${r.name} Senate race${r.special ? " (special election)" : ""}. Polls give ${lastName(alt.name)} ${pct(r.poll[A])}; Polymarket and Kalshi give ${pct(odds)}. Updated ${updated}.`;
  page({ route: { type: "senate", st: r.st }, title, desc, urlPath, image });
  queue(async () => {
    const [ua, ur] = await Promise.all([photoURI(alt.img), photoURI(rep.img)]);
    const hist = H.races?.[r.st];
    const histSeries = hist ? (hist.party === A ? hist.h : hist.h.map(([t, v]) => [t, 1 - v])) : null;
    const body = `${candidate(70, 1, alt, p[A], ua)}${candidate(640, 2, rep, p.R, ur)}
      <line x1="70" x2="1130" y1="388" y2="388" stroke="#dfe2e7" stroke-width="2"/>
      ${histSeries ? bars(70, 500, `Chance for ${lastName(alt.name)} (${A})`, [["Polls", r.poll[A]], ["Betting odds", odds], ["Combined", p[A]]], A) + sparkline(660, 420, histSeries, A)
        : bars(70, 1060, `Chance for ${lastName(alt.name)} (${A})`, [["Polls", r.poll[A]], ["Betting odds", odds], ["Combined", p[A]]], A)}`;
    await toPNG(frame(`${r.name} Senate race`, `2026${r.special ? " special election" : ""} · ${rt.label}`, body), image);
  });
}

// House districts
for (const d of L.districts) {
  const name = STATE_NAMES[d.st], id = d.id.toLowerCase(), urlPath = `/house/${id}/`, image = `/og/house-${id}.png`;
  const place = d.n ? `${poss(name)} ${ord(d.n)} District` : `${name} at-large district`;
  const dc = d.c.find((c) => c.party === "D"), rc = d.c.find((c) => c.party === "R");
  const odds = avg(d.pmD, d.kD), rt = rating(d.p, 1 - d.p);
  let title, desc;
  if (d.sameParty || !dc || !rc) {
    const [c1, c2] = d.c;
    title = `${place} 2026: ${lastName(c1.name)}${c2 ? ` vs. ${lastName(c2.name)}` : ""} | Polls vs. Odds`;
    desc = `${place} is a same-party race between ${d.c.slice(0, 2).map((c) => c.name).join(" and ")}, so the seat stays ${PARTY[c1.party]}. Updated ${updated}.`;
  } else {
    const leader = d.p >= 0.5 ? dc : rc;
    title = `${place} 2026: ${lastName(dc.name)} vs. ${lastName(rc.name)} | Polls vs. Odds`;
    desc = `${leader.name} (${PARTY[leader.party]}) has a ${pct(Math.max(d.p, 1 - d.p))} chance to win ${place}. Polls and past results give the Democrat ${pct(d.modelD)}; betting odds give ${pct(odds)}. Updated ${updated}.`;
  }
  page({ route: { type: "house", st: d.st, id: d.id }, title, desc, urlPath, image });
  queue(async () => {
    const [c1, c2] = d.sameParty || !dc || !rc ? d.c.slice(0, 2) : [dc, rc];
    const [u1, u2] = await Promise.all([photoURI(c1?.img), photoURI(c2?.img)]);
    const pOf = (c) => (d.sameParty ? c.pm : c.party === "D" ? d.p : c.party === "R" ? 1 - d.p : c.pm);
    let body = `${c1 ? candidate(70, 1, c1, pOf(c1), u1) : ""}${c2 ? candidate(640, 2, c2, pOf(c2), u2) : ""}
      <line x1="70" x2="1130" y1="388" y2="388" stroke="#dfe2e7" stroke-width="2"/>`;
    body += d.sameParty
      ? `<text x="70" y="470" font-family="${F}" font-weight="700" font-size="30" fill="#15171c">Both candidates are ${xml(PARTIES[c1.party] || "the same party")}, so this seat stays ${xml(PARTY[c1.party] || "")}.</text>`
      : bars(70, 1060, `Chance for ${lastName(dc.name)} (D)`, [["Polls", d.modelD], ["Betting odds", odds], ["Combined", d.p]], "D");
    await toPNG(frame(place, `2026 House race · ${d.sameParty ? "Same-party race" : rt.label}`, body), image);
  });
}

// States
for (const [st, name] of Object.entries(STATE_NAMES)) {
  const race = L.races.find((r) => r.st === st), ds = L.districts.filter((d) => d.st === st);
  const eD = Math.round(ds.reduce((a, d) => a + d.p, 0)), slug = slugify(name), urlPath = `/state/${slug}/`;
  const close = ds.filter((d) => !d.sameParty && d.p > 0.2 && d.p < 0.8).sort((a, b) => Math.abs(a.p - 0.5) - Math.abs(b.p - 0.5));
  const image = race ? senateImage[st] : `/og/state-${slug}.png`;
  const title = `${name} 2026 elections: ${race ? "Senate and House" : "House"} forecast | Polls vs. Odds`;
  let desc = `${name} has ${ds.length} House seat${ds.length > 1 ? "s" : ""}: our best guess is ${eD} Democrat${eD === 1 ? "" : "s"} and ${ds.length - eD} Republican${ds.length - eD === 1 ? "" : "s"}.`;
  if (race) { const p = race.p, rt = rating(p.D, p.R, p.I); desc = `${name} Senate race: ${rt.label.toLowerCase()} (${pct(rt.p)}). ` + desc; }
  if (close.length) desc += ` Closest: ${close.slice(0, 2).map((d) => `District ${d.n}`).join(", ")}.`;
  page({ route: { type: "state", st }, title, desc: `${desc} From polls plus Polymarket and Kalshi.`, urlPath, image });
  if (race) continue;
  queue(async () => {
    const n = ds.length, gap = 6, size = Math.min(70, (1060 - gap * (n - 1)) / n);
    const squares = ds.slice().sort((a, b) => b.p - a.p).map((d, i) => {
      const rt = rating(d.p, 1 - d.p);
      return `<rect x="${(70 + i * (size + gap)).toFixed(1)}" y="300" width="${size.toFixed(1)}" height="${Math.min(size, 70).toFixed(1)}" rx="6" fill="${RATING_FILL[d.sameParty ? (d.p > 0.5 ? "D1" : "R1") : rt.key]}"/>`;
    }).join("");
    const closeTxt = close.slice(0, 3).map((d, i) => {
      const rt = rating(d.p, 1 - d.p), dc = d.c.find((c) => c.party === "D"), rc = d.c.find((c) => c.party === "R");
      return `<text x="70" y="${470 + i * 40}" font-family="${F}" font-size="26" fill="#15171c"><tspan font-weight="800">District ${d.n}</tspan>  ${xml(dc ? lastName(dc.name) : "Dem")} vs. ${xml(rc ? lastName(rc.name) : "Rep")}  <tspan font-weight="800" fill="${COL[rt.lead]}">${rt.lead} ${xml(pct(rt.p))}</tspan></text>`;
    }).join("");
    const body = `<text x="70" y="262" font-family="${F}" font-weight="800" font-size="40" fill="#15171c">Best guess: <tspan fill="${COL.D}">${eD} D</tspan>, <tspan fill="${COL.R}">${n - eD} R</tspan></text>${squares}
      <text x="70" y="430" font-family="${F}" font-weight="700" font-size="20" fill="#6f7480">${close.length ? "Closest races" : "No close House races here"}</text>${closeTxt}`;
    await toPNG(frame(name, `2026 House races · ${n} seat${n > 1 ? "s" : ""}`, body), image);
  });
}

// render images a few at a time
const t0 = Date.now();
for (let i = 0; i < jobs.length; i += 8) await Promise.all(jobs.slice(i, i + 8).map((f) => f()));

// ---------- 4) redirects for near-miss links, and a real "not found" page ----------
// /senate/pennsylvania/ (no Senate race this year) -> the state page; /house/pa-8/ -> /house/pa-08/
const redirects = [];
for (const [st, name] of Object.entries(STATE_NAMES)) {
  const slug = slugify(name);
  if (!L.races.some((r) => r.st === st)) redirects.push([`/senate/${slug}`, `/state/${slug}/`], [`/senate/${slug}/`, `/state/${slug}/`]);
  redirects.push([`/${slug}`, `/state/${slug}/`], [`/${slug}/`, `/state/${slug}/`]);
}
for (const d of L.districts) {
  const id = d.id.toLowerCase();
  if (d.n > 0 && d.n < 10) redirects.push([`/house/${d.st.toLowerCase()}-${d.n}`, `/house/${id}/`], [`/house/${d.st.toLowerCase()}-${d.n}/`, `/house/${id}/`]);
}
write("_redirects", redirects.map(([from, to]) => `${from} ${to} 301`).join("\n") + "\n");
write("404.html", TEMPLATE.replace("<head>", `<head>\n<meta name="robots" content="noindex">`).replace(/<title>[^<]*<\/title>/, "<title>Page not found | Polls vs. Odds</title>"));

// ---------- 5) sitemap ----------
const day = L.updated.slice(0, 10);
write("sitemap.xml", `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n  <url><loc>${SITE}/</loc><lastmod>${day}</lastmod><changefreq>hourly</changefreq><priority>1.0</priority></url>\n${pages.map((p) => `  <url><loc>${SITE}${p}</loc><lastmod>${day}</lastmod><changefreq>daily</changefreq></url>`).join("\n")}\n</urlset>\n`);
console.log(`built ${OUT}: ${pages.length} race/state pages, ${jobs.length} preview images in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
