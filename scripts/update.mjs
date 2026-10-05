// Pulls polls (VoteHub) and prediction markets (Polymarket, Kalshi), runs the polling model,
// blends everything into a combined forecast, and writes data/latest.json + data/history.json.
// Usage: node scripts/update.mjs
import fs from "node:fs";

const root = new URL("../", import.meta.url);
const read = (p) => JSON.parse(fs.readFileSync(new URL(p, root), "utf8"));
const write = (p, obj) => fs.writeFileSync(new URL(p, root), JSON.stringify(obj));

const CFG = read("config/senate.json");
const LEG = read("scripts/legislators-current.json");
const PHOTOS = fs.existsSync(new URL("data/photos.json", root)) ? read("data/photos.json") : {};
const ALIASES = read("config/pollster-aliases.json");

// ---------- 538 pollster ratings (final 2024 edition, CC BY 4.0) ----------
const RATINGS = (() => {
  const lines = fs.readFileSync(new URL("config/pollster-ratings-538.csv", root), "utf8").trim().split(/\r?\n/);
  const split = (l) => { const o = []; let c = "", q = false; for (const ch of l) { if (ch === '"') q = !q; else if (ch === "," && !q) { o.push(c); c = ""; } else c += ch; } o.push(c); return o; };
  const head = split(lines[0]);
  return lines.slice(1).map((l) => Object.fromEntries(split(l).map((v, i) => [head[i], v]))).filter((r) => r.numeric_grade && r.numeric_grade !== "NA");
})();
const pkey = (s) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/&/g, " and ")
  .replace(/\b(the|inc|llc|polling|poll|polls|research|group|associates|insights|strategies|university|college|institute|center|survey|surveys|company|co|and|for|of|public|opinion|analytics|partners)\b/g, " ").replace(/[^a-z0-9]+/g, " ").trim();
const RIDX = RATINGS.map((r) => ({ r, k: pkey(r.pollster) }));
const ratingCache = new Map();
function pollsterRating(name) {
  if (ratingCache.has(name)) return ratingCache.get(name);
  let best = null;
  if (name in ALIASES) best = ALIASES[name] ? RIDX.find((x) => x.r.pollster === ALIASES[name]) || null : null;
  else {
    const parts = name.split(/\s*\/\s*|\s+-\s+/);
    for (const part of [name, ...parts]) { const k = pkey(part); if (!k) continue; const m = RIDX.find((x) => x.k === k); if (m && (!best || +m.r.numeric_grade > +best.r.numeric_grade)) best = m; }
    if (!best) for (const part of parts) { const k = pkey(part); if (k.length < 5) continue; const m = RIDX.find((x) => x.k.length >= 5 && (x.k.startsWith(k + " ") || k.startsWith(x.k + " ") || x.k === k)); if (m) { best = m; break; } }
  }
  const out = best ? { grade: +best.r.numeric_grade, as: best.r.pollster, id: best.r.pollster_rating_id, partisanWork: +best.r.percent_partisan_work } : null;
  ratingCache.set(name, out);
  return out;
}
const ratingWeight = (name) => { const r = pollsterRating(name); return r ? 0.45 + 0.55 * (r.grade / 3) : 0.6; };
const pollMeta = (p) => { const r = pollsterRating(p.pollster); return { grade: r?.grade, ratedAs: r && r.as !== p.pollster ? r.as : undefined, partisan: p.partisan || undefined, internal: p.internal || undefined, sponsors: p.sponsors?.length ? p.sponsors.map((x) => x.name || x).join(", ") : undefined }; };

const ELECTION = Date.parse("2026-11-03T12:00:00Z");
const NOW = Date.now();
const DAY = 86400e3;
const PM = "https://gamma-api.polymarket.com";
const CLOB = "https://clob.polymarket.com";
const KAL = "https://api.elections.kalshi.com/trade-api/v2";
const VH = "https://api.votehub.com";

// Model weights: 50% polling model, 50% prediction markets (split evenly between venues).
const W = { polls: 0.5, polymarket: 0.25, kalshi: 0.25 };

const STATE_NAMES = {
  AL: "Alabama", AK: "Alaska", AZ: "Arizona", AR: "Arkansas", CA: "California", CO: "Colorado", CT: "Connecticut", DE: "Delaware",
  FL: "Florida", GA: "Georgia", HI: "Hawaii", ID: "Idaho", IL: "Illinois", IN: "Indiana", IA: "Iowa", KS: "Kansas", KY: "Kentucky",
  LA: "Louisiana", ME: "Maine", MD: "Maryland", MA: "Massachusetts", MI: "Michigan", MN: "Minnesota", MS: "Mississippi", MO: "Missouri",
  MT: "Montana", NE: "Nebraska", NV: "Nevada", NH: "New Hampshire", NJ: "New Jersey", NM: "New Mexico", NY: "New York",
  NC: "North Carolina", ND: "North Dakota", OH: "Ohio", OK: "Oklahoma", OR: "Oregon", PA: "Pennsylvania", RI: "Rhode Island",
  SC: "South Carolina", SD: "South Dakota", TN: "Tennessee", TX: "Texas", UT: "Utah", VT: "Vermont", VA: "Virginia", WA: "Washington",
  WV: "West Virginia", WI: "Wisconsin", WY: "Wyoming",
};

// ---------- helpers ----------
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function getJSON(url, tries = 4) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url, { headers: { "User-Agent": "midterm-tracker/1.0", Accept: "application/json" } });
      if (r.status === 429 || r.status >= 500) throw new Error(`HTTP ${r.status}`);
      if (!r.ok) return null;
      return await r.json();
    } catch (e) {
      if (i === tries - 1) { console.warn(`  ! ${url.slice(0, 110)} — ${e.message}`); return null; }
      await sleep(600 * 2 ** i);
    }
  }
}
async function pool(items, n, fn) {
  const out = new Array(items.length);
  let i = 0;
  await Promise.all(Array.from({ length: n }, async () => {
    while (i < items.length) { const k = i++; out[k] = await fn(items[k], k); }
  }));
  return out;
}
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const round = (x, d = 3) => (x == null || Number.isNaN(x) ? null : +x.toFixed(d));
const norm = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase()
  .replace(/\((d|r|i)\)/g, "").replace(/[“”"’']/g, "").replace(/\b(sen|rep|jr|sr|ii|iii)\b\.?/g, "").replace(/\s+/g, " ").trim();
const lastName = (name) => { const t = norm(name).split(" ").filter(Boolean); return t[t.length - 1] || ""; };
const slug = (s) => norm(s).replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

function erf(x) { // Abramowitz-Stegun 7.1.26
  const s = Math.sign(x); x = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * x);
  const y = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
  return s * y;
}
const Phi = (z) => 0.5 * (1 + erf(z / Math.SQRT2));
function PhiInv(p) { // Acklam
  p = clamp(p, 1e-6, 1 - 1e-6);
  const a = [-39.69683028665376, 220.9460984245205, -275.9285104469687, 138.357751867269, -30.66479806614716, 2.506628277459239];
  const b = [-54.47609879822406, 161.5858368580409, -155.6989798598866, 66.80131188771972, -13.28068155288572];
  const c = [-0.007784894002430293, -0.3223964580411365, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
  const d = [0.007784695709041462, 0.3224671290700398, 2.445134137142996, 3.754408661907416];
  const pl = 0.02425;
  if (p < pl) { const q = Math.sqrt(-2 * Math.log(p)); return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1); }
  if (p > 1 - pl) { const q = Math.sqrt(-2 * Math.log(1 - p)); return -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1); }
  const q = p - 0.5, r = q * q;
  return (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
}
// Seeded RNG so the simulation is stable between refreshes with identical inputs.
function rng(seed = 2026) {
  let s = seed >>> 0;
  const u = () => { s += 0x6d2b79f5; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  return { u, n: () => Math.sqrt(-2 * Math.log(u() || 1e-12)) * Math.cos(2 * Math.PI * u()) };
}

// ---------- legislators (incumbency + photo ids) ----------
const current = LEG.map((l) => {
  const t = l.terms[l.terms.length - 1];
  return { first: norm(l.name.first), nick: norm(l.name.nickname || ""), last: norm(l.name.last), full: l.name.official_full || `${l.name.first} ${l.name.last}`,
    type: t.type, state: t.state, district: t.district, party: t.party?.[0], bioguide: l.id.bioguide, wiki: l.id.wikipedia };
});
function findMember(name, state, type) {
  const n = norm(name).split(" ");
  const ln = n[n.length - 1], fn = n[0];
  return current.find((m) => m.state === state && (!type || m.type === type) &&
    (norm(m.full) === norm(name) || ((m.last.endsWith(ln) || ln.endsWith(m.last.split(" ").pop())) && (m.first.startsWith(fn) || fn.startsWith(m.first) || (m.nick && fn.startsWith(m.nick)) || fn[0] === m.first[0]))));
}
function photoFor(name, state) {
  const p = PHOTOS[`${state}|${slug(name)}`];
  return p ? p.src : null;
}

// ---------- polls ----------
const POP_W = { lv: 1, rv: 0.9, v: 0.9, a: 0.7 };
const POP_RANK = { lv: 3, rv: 2, v: 2, a: 1 };
function dedupePopulations(polls) {
  // VoteHub lists LV/RV/adult versions of one survey as separate rows; keep the best population per survey + matchup.
  const best = new Map();
  for (const p of polls) {
    const k = `${p.pollster}|${p.end_date}|${p.answers.map((a) => lastName(a.choice)).sort().join(",")}`;
    const cur = best.get(k);
    if (!cur || (POP_RANK[p.population] || 0) > (POP_RANK[cur.population] || 0)) best.set(k, p);
  }
  return [...best.values()];
}
function weightPolls(polls, asOf, halfLife, windowDays) {
  const inWin = polls.filter((p) => { const t = Date.parse(p.end_date); return t <= asOf && t > asOf - windowDays * DAY; })
    .sort((a, b) => b.end_date.localeCompare(a.end_date));
  const seen = {};
  return inWin.map((p) => {
    const age = (asOf - Date.parse(p.end_date)) / DAY;
    const k = (seen[p.pollster] = (seen[p.pollster] || 0) + 1);
    const n = p.sample_size || 600;
    const w = Math.pow(0.5, age / halfLife) * Math.sqrt(clamp(n, 300, 3000) / 600) * (POP_W[p.population] ?? 0.8) * (p.partisan ? 0.5 : 1) * ratingWeight(p.pollster) * Math.pow(0.6, k - 1);
    return { p, w };
  });
}
const partisanShift = (p) => (p.partisan === "DEM" ? -2 : p.partisan === "REP" ? 2 : 0); // nudge sponsored polls against their sponsor

function gbAverage(polls, asOf) {
  const wp = weightPolls(polls, asOf, 14, 90);
  let sw = 0, sm = 0, sd = 0, sr = 0;
  for (const { p, w } of wp) {
    const d = p.answers.find((a) => a.choice === "Dem")?.pct, r = p.answers.find((a) => a.choice === "Rep")?.pct;
    if (d == null || r == null) continue;
    sw += w; sm += w * (d - r + partisanShift(p)); sd += w * d; sr += w * r;
  }
  if (!sw) return null;
  return { margin: sm / sw, dem: sd / sw, rep: sr / sw, neff: sw, n: wp.length };
}

console.log("Fetching polls…");
const [vhGeneric, vhSenate, vhHouse] = await Promise.all([
  getJSON(`${VH}/polls?poll_type=generic-ballot`),
  getJSON(`${VH}/polls?poll_type=us-senator`),
  getJSON(`${VH}/polls?poll_type=us-representative`),
]);
if (!vhGeneric || !vhSenate) throw new Error("VoteHub unavailable — keeping previous data");
const genericPolls = dedupePopulations(vhGeneric.filter((p) => p.subject === "2026" || /^202[56]/.test(p.end_date)));
const GB = gbAverage(genericPolls, NOW);
console.log(`  generic ballot D${GB.margin >= 0 ? "+" : ""}${GB.margin.toFixed(1)} (${GB.n} polls in window)`);

// ---------- markets: Polymarket ----------
console.log("Fetching Polymarket…");
const pmEvents = [];
for (let off = 0; off < 6000; off += 100) {
  const page = await getJSON(`${PM}/events?limit=100&offset=${off}&closed=false&tag_slug=midterms`);
  if (!page) break;
  pmEvents.push(...page);
  if (page.length < 100) break;
}
const pmBySlug = Object.fromEntries(pmEvents.map((e) => [e.slug, e]));
async function pmEvent(slugName) {
  if (pmBySlug[slugName]) return pmBySlug[slugName];
  const r = await getJSON(`${PM}/events?slug=${slugName}`);
  return r?.[0] || null;
}
function pmPrice(m) {
  const bid = +m.bestBid, ask = +m.bestAsk;
  if (bid > 0 && ask > 0 && ask - bid <= 0.1) return (bid + ask) / 2;
  if (m.outcomePrices) return +JSON.parse(m.outcomePrices)[0];
  return +m.lastTradePrice || null;
}
function pmMarkets(e) {
  if (!e) return [];
  return e.markets.filter((m) => m.active && !m.closed && m.outcomePrices && !/^(Person|Party) [A-Z]$|^Other$/.test(m.groupItemTitle || ""))
    .map((m) => ({ label: (m.groupItemTitle || m.question || "").trim(), p: pmPrice(m), d1: +m.oneDayPriceChange || 0, vol: +m.volumeNum || 0, token: JSON.parse(m.clobTokenIds || "[]")[0] }));
}

// ---------- markets: Kalshi ----------
console.log("Fetching Kalshi…");
function kPrice(m) {
  const bid = +m.yes_bid_dollars, ask = +m.yes_ask_dollars;
  if (bid > 0 && ask > 0 && ask - bid <= 0.1) return (bid + ask) / 2;
  return +m.last_price_dollars || null;
}
async function kalshiEvent(ticker) {
  if (!ticker) return null;
  const r = await getJSON(`${KAL}/events/${ticker}?with_nested_markets=true`);
  const ms = r?.event?.markets || r?.markets;
  if (!ms) return null;
  return { title: r.event.title, markets: ms.filter((m) => m.status === "active" || m.status === "open")
    .map((m) => ({ label: m.yes_sub_title, p: kPrice(m), d1: kPrice(m) - (+m.previous_price_dollars || kPrice(m)), vol: +m.volume_fp || 0, ticker: m.ticker })) };
}

function matchLabel(label, cand) {
  const L = norm(label);
  if (cand.pm?.some((a) => norm(a) === L) || cand.kalshi?.some((a) => norm(a) === L)) return 3;
  if (cand.generic) {
    if (cand.party === "D" && /^democrat/.test(L)) return 2;
    if (cand.party === "R" && /^republican/.test(L)) return 2;
  }
  if (L === norm(cand.name)) return 2;
  const ln = lastName(cand.name);
  if (ln && L.split(" ").includes(ln)) return 1;
  return 0;
}
function assignMarket(markets, cands) {
  // Returns {candIndex: probability} normalised to sum 1 across matched candidates.
  if (!markets?.length) return null;
  const out = {};
  cands.forEach((c, i) => {
    let best = null, bs = 0;
    for (const m of markets) { const s = matchLabel(m.label, c); if (s > bs) { bs = s; best = m; } }
    if (best && best.p != null) out[i] = { p: best.p, d1: best.d1, vol: best.vol, token: best.token, label: best.label };
  });
  const tot = Object.values(out).reduce((a, x) => a + x.p, 0);
  if (!tot) return null;
  for (const k in out) out[k].p /= tot;
  return out;
}

// ---------- national chamber markets ----------
const [pmHouse, pmSenate, pmBalance, pmRHouseSeats, pmRSenSeats, pmPopVote] = await Promise.all([
  pmEvent("which-party-will-win-the-house-in-2026"),
  pmEvent("which-party-will-win-the-senate-in-2026"),
  pmEvent("balance-of-power-2026-midterms"),
  pmEvent("republican-house-seats-after-the-2026-midterm-elections"),
  pmEvent("republican-senate-seats-after-the-2026-midterm-elections-927"),
  pmEvent("2026-midterms-house-popular-vote-margin-of-victory-224"),
]);
const [kHouse, kSenate, kRHouseSeats] = await Promise.all([
  kalshiEvent("CONTROLH-2026"), kalshiEvent("CONTROLS-2026"), kalshiEvent("KXRHOUSESEATS-27"),
]);
const pick = (ms, re) => ms?.find((m) => re.test(m.label));
const twoWay = (ms) => { // normalised D probability from a D/R pair
  const d = pick(ms, /democrat/i), r = pick(ms, /republican/i);
  if (!d || !r) return null;
  return { p: d.p / (d.p + r.p), d1: d.d1, vol: d.vol + r.vol, token: d.token };
};
const pmHouseD = twoWay(pmMarkets(pmHouse));
const pmSenD = twoWay(pmMarkets(pmSenate));
const kHouseD = twoWay(kHouse?.markets);
const kSenD = twoWay(kSenate?.markets);

// Seat-count buckets -> discrete distribution over Republican seats.
function bucketDist(ms, lo, hi) {
  if (!ms?.length) return null;
  const dist = new Map();
  let tot = 0;
  for (const m of ms) {
    const L = m.label.replace(/\s/g, "");
    let a, b, x;
    if ((x = L.match(/^(\d+)-(\d+)$/))) { a = +x[1]; b = +x[2]; }
    else if ((x = L.match(/^(?:Below|<)(\d+)$/i))) { a = lo; b = +x[1] - 1; }
    else if ((x = L.match(/^≤(\d+)$/))) { a = lo; b = +x[1]; }
    else if ((x = L.match(/^(?:Above|>)(\d+)$/i))) { a = +x[1] + 1; b = hi; }
    else if ((x = L.match(/^(\d+)\+$/))) { a = +x[1]; b = hi; }
    else if ((x = L.match(/^(\d+)$/))) { a = b = +x[1]; }
    else continue;
    tot += m.p;
    // open-ended buckets ("Below 190", "57+") taper away from their boundary instead of spreading evenly
    const open = /below|<|≤|above|>|\+$/i.test(L);
    const near = /below|<|≤/i.test(L) ? b : a;
    const wts = []; for (let s = a; s <= b; s++) wts.push(open ? Math.pow(0.88, Math.abs(s - near)) : 1);
    const ws = wts.reduce((x, y) => x + y, 0);
    for (let s = a; s <= b; s++) dist.set(s, (dist.get(s) || 0) + (m.p * wts[s - a]) / ws);
  }
  if (!tot) return null;
  const arr = [];
  for (let s = lo; s <= hi; s++) arr.push((dist.get(s) || 0) / tot);
  return arr;
}
const H_LO = 150, H_HI = 285; // Republican House seat range we track
const pmHouseDist = bucketDist(pmMarkets(pmRHouseSeats), H_LO, H_HI);
const kHouseDist = bucketDist(kRHouseSeats?.markets, H_LO, H_HI);
const S_LO = 40, S_HI = 60;
const pmSenDist = bucketDist(pmMarkets(pmRSenSeats), S_LO, S_HI);

// Popular vote margin market -> implied D margin (bucket midpoints).
function popVoteImplied(ms) {
  if (!ms?.length) return null;
  let s = 0, t = 0;
  for (const m of ms) {
    const x = m.label.match(/(Democrats|Republicans)\s*(\d+)(?:-(\d+))?%(\+)?/);
    if (!x) continue;
    const sign = x[1] === "Democrats" ? 1 : -1;
    const lo = +x[2], hi = x[3] ? +x[3] : lo + 3;
    s += m.p * sign * (lo + hi) / 2; t += m.p;
  }
  return t ? s / t : null;
}
const pmPopMargin = popVoteImplied(pmMarkets(pmPopVote));

// ---------- HOUSE polling model ----------
// Expected Democratic seats from the generic-ballot margin. Slope ~4.5 seats per point; Democrats need roughly
// a D+0.5 popular-vote margin for 218 on the 2026 maps (after mid-decade redistricting).
const H_SLOPE = 4.5, H_BIAS = 0.5, GB_ERR = 3.2, SEAT_NOISE = 8;
function houseFromGB(margin, daysOut) {
  const timeErr = Math.sqrt(GB_ERR ** 2 + (daysOut / 30) * 1.5 ** 2);
  const mean = 217.5 + 0.5 + H_SLOPE * (margin - H_BIAS);
  const sd = Math.sqrt((H_SLOPE * timeErr) ** 2 + SEAT_NOISE ** 2);
  return { mean, sd, pD: 1 - Phi((217.5 - mean) / sd) };
}
const daysOut = Math.max(0, (ELECTION - NOW) / DAY);
const housePoll = houseFromGB(GB.margin, daysOut);

const mixMarket = (pm, k) => (pm != null && k != null ? (pm + k) / 2 : pm ?? k);
function blend(poll, pm, k) {
  const parts = [[poll, W.polls], [pm, W.polymarket], [k, W.kalshi]].filter(([v]) => v != null);
  const tw = parts.reduce((a, [, w]) => a + w, 0);
  return parts.reduce((a, [v, w]) => a + v * w, 0) / tw;
}
const houseCombinedD = blend(housePoll.pD, pmHouseD?.p, kHouseD?.p);

// Seat distributions (Democratic seats 150..285)
const D_LO = 435 - H_HI, D_HI = 435 - H_LO;
const pollSeatDist = [];
for (let s = D_LO; s <= D_HI; s++) pollSeatDist.push(Phi((s + 0.5 - housePoll.mean) / housePoll.sd) - Phi((s - 0.5 - housePoll.mean) / housePoll.sd));
const flipToD = (arr) => arr && arr.slice().reverse(); // R seats lo..hi -> D seats (435-hi)..(435-lo)
const pmSeatDistD = flipToD(pmHouseDist), kSeatDistD = flipToD(kHouseDist);
const mean = (arr, lo) => arr && arr.reduce((a, p, i) => a + p * (lo + i), 0);
const marketSeatDist = pmSeatDistD && kSeatDistD ? pmSeatDistD.map((p, i) => (p + kSeatDistD[i]) / 2) : pmSeatDistD || kSeatDistD;
const combinedSeatDist = marketSeatDist ? pollSeatDist.map((p, i) => W.polls * p + (1 - W.polls) * marketSeatDist[i]) : pollSeatDist;
const houseExpected = { polls: housePoll.mean, polymarket: mean(pmSeatDistD, D_LO), kalshi: mean(kSeatDistD, D_LO) };
houseExpected.combined = mean(combinedSeatDist, D_LO);

// ---------- HOUSE districts ----------
// 2024 presidential margin (D minus R) for every district as drawn for 2026, calculated by The Downballot.
const PRES24 = {};
for (const line of fs.readFileSync(new URL("config/pres2024-by-district-2026-lines.csv", root), "utf8").split(/\r?\n/)) {
  const c = line.split(","); if (/^[A-Z]{2}-(\d\d|AL)$/.test(c[0]) && c[5] !== "" && !isNaN(+c[5])) PRES24[c[0]] = +c[5];
}
const NAT24 = -1.5; // 2024 national popular vote margin
console.log("Building House districts…");
const distEvents = {};
for (const e of pmEvents) {
  let x = e.slug.match(/^([a-z]{2})-(\d{2}|al)-house-election-winner(-by)?(-individual)?/);
  let key, individual = false;
  if (x) { key = `${x[1].toUpperCase()}-${x[2] === "al" ? "AL" : x[2]}`; individual = !!x[4]; }
  else if ((x = e.slug.match(/^which-party-will-win-the-house-race-for-the-([a-z]{2})-(\d+)-seat/))) key = `${x[1].toUpperCase()}-${x[2].padStart(2, "0")}`;
  else continue;
  (distEvents[key] ||= {})[individual ? "ind" : "main"] = e;
}
// Kalshi district markets (only a handful exist)
const kDistrict = {};
await pool(["HOUSECA22", "HOUSEMI10", "HOUSEPA8", "KXHOUSETX9", "KXHOUSEWA8", "HOUSEAZ1", "HOUSEAZ6", "HOUSENY17", "HOUSEIA1", "HOUSECO8", "HOUSENE2", "HOUSEPA7", "HOUSEPA10", "HOUSEMI8", "HOUSENY22", "HOUSECA45", "HOUSECA13", "HOUSEVA2", "HOUSEWI3", "HOUSEOH13", "HOUSEOH9", "HOUSETX34", "HOUSETX28", "HOUSENC1", "HOUSENV1", "HOUSENV4", "HOUSEMT1", "HOUSEME2", "HOUSENM2", "HOUSEAK1"], 4, async (ser) => {
  const ev = await kalshiEvent(`${ser}-26`);
  const x = ser.match(/HOUSE([A-Z]{2})(\d+)/);
  if (ev?.markets?.length && x) kDistrict[`${x[1]}-${x[2].padStart(2, "0")}`] = ev.markets;
});
// District polls
const districtPolls = {};
for (const p of dedupePopulations(vhHouse || [])) {
  if (!p.seat_name || !/^202[56]/.test(p.end_date)) continue;
  const [st, d] = p.seat_name.split("-");
  const key = `${st}-${d === "01" && ["AK", "DE", "ND", "SD", "VT", "WY"].includes(st) ? "AL" : d}`;
  (districtPolls[key] ||= []).push(p);
}

function partyOf(label) { const x = label.match(/\(([DRI])\)/); return x ? x[1] : /^democrat/i.test(label) ? "D" : /^republican/i.test(label) ? "R" : null; }
function cleanName(label) { return label.replace(/\s*\([DRI]\)\s*/g, "").replace(/[“”]/g, '"').trim(); }

const districts = [];
for (const [key, ev] of Object.entries(distEvents)) {
  const [st, dn] = key.split("-");
  const main = pmMarkets(ev.main || ev.ind);
  if (!main.length) continue;
  let cands = main.map((m) => {
    let party = partyOf(m.label);
    const generic = /^(democratic|republican) party$/i.test(m.label);
    let name = generic ? (party === "D" ? "Democratic nominee" : "Republican nominee") : cleanName(m.label);
    const mem = !generic ? findMember(name, st, "rep") : null;
    if (!party && mem) party = mem.party;
    return { name, party, generic, pm: m.p, d1: m.d1, vol: m.vol, inc: !!mem && mem.district != null };
  }).filter((c) => c.pm > 0.004 || c.party);
  // Top-two / jungle races where both finalists share a party: use the individual market for names
  if (ev.ind && ev.main) {
    const ind = pmMarkets(ev.ind);
    const dom = cands.reduce((a, c) => (c.pm > a.pm ? c : a), cands[0]);
    if (dom.pm > 0.9 && ind.length >= 2) {
      cands = ind.map((m) => { const nm = cleanName(m.label); const mem = findMember(nm, st, "rep"); return { name: nm, party: mem?.party || dom.party, pm: m.p, d1: m.d1, vol: m.vol, inc: !!mem }; });
    }
  }
  const tot = cands.reduce((a, c) => a + c.pm, 0) || 1;
  cands.forEach((c) => (c.pm /= tot));
  // Infer missing parties for named-only markets (e.g. two incumbents drawn together)
  cands.forEach((c) => { if (!c.party) c.party = findMember(c.name, st, null)?.party || "O"; });
  let pmD = cands.filter((c) => c.party === "D").reduce((a, c) => a + c.pm, 0);
  const sameParty = cands.length >= 2 && new Set(cands.map((c) => c.party)).size === 1;
  // Kalshi
  let kD = null;
  if (kDistrict[key]) {
    const km = kDistrict[key];
    const ks = km.map((m) => { const c = cands.find((c) => matchLabel(m.label, { name: c.name }) > 0); return c ? { party: c.party, p: m.p } : null; }).filter(Boolean);
    const kt = ks.reduce((a, x) => a + x.p, 0);
    if (kt) { kD = ks.filter((x) => x.party === "D").reduce((a, x) => a + x.p, 0) / kt; ks.forEach((x) => { const c = cands.find((c) => c.party === x.party); if (c) c.k = x.p / kt; }); }
  }
  // District polls -> win probability (only if the poll names both main candidates)
  let pollD = null, pollMargin = null, pollList = [];
  const dc = cands.find((c) => c.party === "D"), rc = cands.find((c) => c.party === "R");
  if (districtPolls[key] && dc && rc && !dc.generic && !rc.generic) {
    const usable = districtPolls[key].filter((p) => p.answers.some((a) => lastName(a.choice) === lastName(dc.name)) && p.answers.some((a) => lastName(a.choice) === lastName(rc.name)));
    const wp = weightPolls(usable, NOW, 21, 150);
    let sw = 0, sm = 0;
    for (const { p, w } of wp) {
      const d = p.answers.find((a) => lastName(a.choice) === lastName(dc.name)).pct, r = p.answers.find((a) => lastName(a.choice) === lastName(rc.name)).pct;
      sw += w; sm += w * (d - r + partisanShift(p));
    }
    if (sw) { pollMargin = sm / sw; pollD = Phi(pollMargin / Math.sqrt(6 ** 2 + 3.5 ** 2 / sw)); }
    pollList = usable.sort((a, b) => b.end_date.localeCompare(a.end_date)).slice(0, 12).map((p) => ({ date: p.end_date, pollster: p.pollster, pop: p.population, n: p.sample_size, url: p.url, ...pollMeta(p), d: p.answers.find((a) => lastName(a.choice) === lastName(dc.name)).pct, r: p.answers.find((a) => lastName(a.choice) === lastName(rc.name)).pct }));
  }
  // Polling model: district's 2024 lean + national swing since 2024 + incumbency, combined with any local polls
  let modelD = null, modelMargin = null, baseMargin = null;
  if (PRES24[key] != null) {
    const incD = cands.some((c) => c.party === "D" && c.inc), incR = cands.some((c) => c.party === "R" && c.inc);
    baseMargin = PRES24[key] + 0.9 * (GB.margin - NAT24) + (incD ? 2.5 : 0) - (incR ? 2.5 : 0);
    let m = baseMargin, sd = 7;
    if (pollMargin != null) { const wB = 1 / 7 ** 2, wP = 1 / (5 ** 2); m = (baseMargin * wB + pollMargin * wP) / (wB + wP); sd = Math.sqrt(1 / (wB + wP)); }
    modelMargin = m;
    modelD = Phi(m / Math.sqrt(sd ** 2 + 3 ** 2));
  } else if (pollD != null) modelD = pollD;
  const rawD = blend(modelD, pmD, kD);
  const inc = current.find((m) => m.type === "rep" && m.state === st && (m.district === +dn || (dn === "AL" && m.district === 0)));
  districts.push({
    id: key, st, n: dn === "AL" ? 0 : +dn,
    c: cands.sort((a, b) => b.pm - a.pm).slice(0, 3).map((c) => ({ name: c.name, party: c.party, pm: round(c.pm), k: c.k != null ? round(c.k) : undefined, d1: round(c.d1), inc: c.inc || undefined, generic: c.generic || undefined, img: c.generic ? null : photoFor(c.name, st) })),
    pmD: round(pmD), kD: round(kD), pollD: round(pollD), modelD: round(modelD), modelMargin: round(modelMargin, 1), pres24: PRES24[key], pollMargin: round(pollMargin, 1), polls: pollList.length ? pollList : undefined,
    rawD, sameParty, vol: Math.round(ev.main?.volume || ev.ind?.volume || 0), slug: (ev.main || ev.ind).slug,
    held: inc?.party || null, holder: inc?.full || null,
  });
}
// Calibrate district odds so they sum to the combined national seat estimate (uniform shift in log-odds).
const logit = (p) => Math.log(clamp(p, 0.003, 0.997) / (1 - clamp(p, 0.003, 0.997)));
const sigm = (x) => 1 / (1 + Math.exp(-x));
const dMissing = 435 - districts.length;
const target = houseExpected.combined - dMissing * 0.5;
let lo = -4, hi = 4;
const sumAt = (delta) => districts.reduce((a, d) => a + (d.sameParty ? (d.rawD > 0.5 ? 1 : 0) : sigm(logit(d.rawD) + delta)), 0);
for (let i = 0; i < 60; i++) { const mid = (lo + hi) / 2; if (sumAt(mid) < target) lo = mid; else hi = mid; }
const shift = (lo + hi) / 2;
for (const d of districts) {
  d.p = round(d.sameParty ? (d.rawD > 0.5 ? 1 : 0) : sigm(logit(d.rawD) + shift));
  d.rawD = round(d.rawD);
}
districts.sort((a, b) => a.st.localeCompare(b.st) || a.n - b.n);
console.log(`  ${districts.length} districts, calibration shift ${shift.toFixed(2)} logits, sum ${districts.reduce((a, d) => a + d.p, 0).toFixed(1)}`);

// ---------- SENATE ----------
console.log("Building Senate races…");
const senPollsByState = {};
for (const p of dedupePopulations(vhSenate)) {
  const x = (p.subject || "").match(/^2026 (.+)$/);
  if (!x) continue;
  (senPollsByState[x[1]] ||= []).push(p);
}
function racePollAvg(race, asOf) {
  const polls = senPollsByState[STATE_NAMES[race.st]] || [];
  const R = race.c.find((c) => c.party === "R"), A = race.c.find((c) => c.party !== "R");
  const keyR = [lastName(R.name), ...(R.poll || []).map(lastName)], keyA = [lastName(A.name), ...(A.poll || []).map(lastName)];
  const usable = polls.filter((p) => p.answers.some((a) => keyR.includes(lastName(a.choice))) && p.answers.some((a) => keyA.includes(lastName(a.choice))));
  const wp = weightPolls(usable, asOf, 21, 120);
  let sw = 0, sm = 0, sa = 0, sr = 0;
  for (const { p, w } of wp) {
    const r = p.answers.find((a) => keyR.includes(lastName(a.choice))).pct, a = p.answers.find((x) => keyA.includes(lastName(x.choice))).pct;
    sw += w; sm += w * (a - r + partisanShift(p)); sa += w * a; sr += w * r;
  }
  return { usable, margin: sw ? sm / sw : null, a: sw ? sa / sw : null, r: sw ? sr / sw : null, neff: sw, R, A };
}
function raceModel(race, asOf, gbMargin, dOut) {
  const pa = racePollAvg(race, asOf);
  const incR = race.c.find((c) => c.party === "R" && c.inc), incA = race.c.find((c) => c.party !== "R" && c.inc);
  // Prior from state lean + national environment + incumbency. Independents get the same environment shift.
  const prior = race.pres24 + 0.8 * (gbMargin + 1.5) + (incA ? 2.5 : 0) - (incR ? 2.5 : 0);
  const sPrior = 8;
  let m = prior, sPost = sPrior;
  if (pa.margin != null) {
    const sPoll = Math.sqrt(4 ** 2 / pa.neff + 1.5 ** 2);
    const wPr = 1 / sPrior ** 2, wPo = 1 / sPoll ** 2;
    m = (prior * wPr + pa.margin * wPo) / (wPr + wPo);
    sPost = Math.sqrt(1 / (wPr + wPo));
  }
  const sFc = Math.sqrt(sPost ** 2 + 3.5 ** 2 + (dOut / 30) * 1.2 ** 2);
  return { prior, margin: m, sd: sFc, pAlt: Phi(m / sFc), pa };
}

// Incumbency flags + photos for Senate candidates
for (const race of CFG.races) for (const c of race.c) {
  const mem = !c.generic ? findMember(c.name, race.st, "sen") : null;
  c.inc = !!mem;
  const hMem = !mem && !c.generic ? findMember(c.name, race.st, "rep") : null;
  c.office = mem ? "U.S. Senator" : hMem ? `U.S. Rep. (${race.st}-${hMem.district || "AL"})` : null;
}

const senMarkets = await pool(CFG.races, 4, async (race) => {
  const [pe, ke] = await Promise.all([pmEvent(race.pm), kalshiEvent(race.kalshi)]);
  return { pm: assignMarket(pmMarkets(pe), race.c), k: assignMarket(ke?.markets, race.c), pmVol: pe?.volume || 0, kVol: ke?.markets?.reduce((a, m) => a + m.vol, 0) || 0 };
});

function partyProbs(race, byCand) { // {D,R,I} from per-candidate probabilities
  const o = { D: 0, R: 0, I: 0 };
  if (!byCand) return null;
  race.c.forEach((c, i) => { if (byCand[i]) o[c.party] += byCand[i].p; });
  return o;
}
const races = CFG.races.map((race, i) => {
  const model = raceModel(race, NOW, GB.margin, daysOut);
  const altParty = model.pa.A.party;
  const poll = { D: 0, R: 1 - model.pAlt, I: 0 }; poll[altParty] = model.pAlt;
  const pm = partyProbs(race, senMarkets[i].pm), k = partyProbs(race, senMarkets[i].k);
  const comb = {};
  for (const P of ["D", "R", "I"]) comb[P] = blend(poll[P], pm?.[P], k?.[P]);
  const polls = model.pa.usable.sort((a, b) => b.end_date.localeCompare(a.end_date)).map((p) => {
    const ans = {};
    race.c.forEach((c) => { const keys = [lastName(c.name), ...(c.poll || []).map(lastName)]; const a = p.answers.find((x) => keys.includes(lastName(x.choice))); if (a) ans[c.party] = a.pct; });
    return { date: p.end_date, pollster: p.pollster, pop: p.population, n: p.sample_size, url: p.url, ...pollMeta(p), ...ans };
  });
  return {
    st: race.st, name: STATE_NAMES[race.st], special: !!race.special, held: race.held, pres24: race.pres24,
    c: race.c.map((c, j) => ({ name: c.name, party: c.party, inc: c.inc || undefined, office: c.office || undefined, generic: c.generic || undefined,
      img: c.generic ? null : photoFor(c.name, race.st), pm: round(senMarkets[i].pm?.[j]?.p), k: round(senMarkets[i].k?.[j]?.p), d1: round(senMarkets[i].pm?.[j]?.d1), pmLabel: senMarkets[i].pm?.[j]?.label, token: senMarkets[i].pm?.[j]?.token })),
    poll: { D: round(poll.D), R: round(poll.R), I: round(poll.I) }, pm: pm && { D: round(pm.D), R: round(pm.R), I: round(pm.I) }, k: k && { D: round(k.D), R: round(k.R), I: round(k.I) },
    p: { D: round(comb.D), R: round(comb.R), I: round(comb.I) },
    avg: model.pa.margin != null ? { alt: round(model.pa.a, 1), r: round(model.pa.r, 1), margin: round(model.pa.margin, 1), neff: round(model.pa.neff, 2) } : null,
    model: { prior: round(model.prior, 1), margin: round(model.margin, 1), sd: round(model.sd, 1) }, altParty,
    nPolls: model.pa.usable.length, polls, pmSlug: race.pm, kalshi: race.kalshi, vol: Math.round(senMarkets[i].pmVol + senMarkets[i].kVol),
  };
});

// Correlated Monte Carlo: a shared national error plus state noise, preserving each race's marginal odds.
function simulateSenate(probs, N = 20000, seed = 7) {
  const r = rng(seed);
  const SD = 6, NAT = 3.5, LOC = Math.sqrt(SD ** 2 - NAT ** 2);
  const z = probs.map((p) => SD * PhiInv(clamp(1 - p.R, 0.0005, 0.9995)));
  const dShare = probs.map((p) => (p.D + p.I > 0 ? p.D / (p.D + p.I) : 1));
  const rSeats = new Array(101).fill(0);
  let dCtl = 0, rCtl = 0;
  for (let s = 0; s < N; s++) {
    const e = r.n() * NAT;
    let R = CFG.notUp.R, D = CFG.notUp.D, I = 0;
    for (let i = 0; i < z.length; i++) {
      if (z[i] + e + r.n() * LOC > 0) { if (r.u() < dShare[i]) D++; else I++; } else R++;
    }
    rSeats[R]++;
    if (R >= 50) rCtl++; else if (D >= 51) dCtl++; else { dCtl += 0.5; rCtl += 0.5; }
  }
  return { pD: dCtl / N, pR: rCtl / N, rSeats: rSeats.slice(S_LO, S_HI + 1).map((x) => x / N) };
}
const senPollSim = simulateSenate(races.map((r) => r.poll));
const senCombSim = simulateSenate(races.map((r) => r.p));
const senateCombinedD = blend(senPollSim.pD, pmSenD?.p, kSenD?.p);
const senExpectedR = { polls: mean(simulateSenate(races.map((r) => r.poll), 8000, 3).rSeats, S_LO), combined: mean(senCombSim.rSeats, S_LO), polymarket: mean(pmSenDist, S_LO) };
console.log(`  Senate: polls ${senPollSim.pD.toFixed(3)}  PM ${pmSenD?.p.toFixed(3)}  Kalshi ${kSenD?.p.toFixed(3)}  -> ${senateCombinedD.toFixed(3)}`);
console.log(`  House:  polls ${housePoll.pD.toFixed(3)}  PM ${pmHouseD?.p.toFixed(3)}  Kalshi ${kHouseD?.p.toFixed(3)}  -> ${houseCombinedD.toFixed(3)}`);

// ---------- pollster scorecard: 538 rating, this cycle's house effect, historical miss ----------
const HIST = fs.existsSync(new URL("config/pollster-history.json", root)) ? read("config/pollster-history.json") : {};
const pstats = {};
const pst = (name) => (pstats[name] ||= { name, n: 0, gen: 0, sen: 0, house: 0, rB: 0, dB: 0, internal: 0, res: [], last: "" });
for (const p of genericPolls) {
  if (Date.parse(p.end_date) < Date.parse("2025-06-01")) continue;
  const d = p.answers.find((a) => a.choice === "Dem")?.pct, r = p.answers.find((a) => a.choice === "Rep")?.pct;
  if (d == null || r == null) continue;
  const s = pst(p.pollster); s.n++; s.gen++;
  if (p.partisan === "REP") s.rB++; else if (p.partisan === "DEM") s.dB++;
  if (p.internal) s.internal++;
  if (p.end_date > s.last) s.last = p.end_date;
  const avg = gbAverage(genericPolls.filter((q) => q !== p), Date.parse(p.end_date) + DAY - 1);
  if (avg) s.res.push(d - r - avg.margin);
}
for (const race of CFG.races) {
  const all = racePollAvg(race, NOW).usable;
  for (const p of all) {
    const s = pst(p.pollster); s.n++; s.sen++;
    if (p.partisan === "REP") s.rB++; else if (p.partisan === "DEM") s.dB++;
    if (p.internal) s.internal++;
    if (p.end_date > s.last) s.last = p.end_date;
    const A = race.c.find((c) => c.party !== "R");
    if (A.party !== "D") continue; // house effects only measured on D-vs-R races
    const keysA = [lastName(A.name), ...(A.poll || []).map(lastName)], R = race.c.find((c) => c.party === "R"), keysR = [lastName(R.name), ...(R.poll || []).map(lastName)];
    // average of every *other* poll of this race as of this poll's date
    const saved = senPollsByState[STATE_NAMES[race.st]];
    senPollsByState[STATE_NAMES[race.st]] = saved.filter((q) => q !== p);
    const avg = racePollAvg(race, Date.parse(p.end_date) + DAY - 1);
    senPollsByState[STATE_NAMES[race.st]] = saved;
    const a = p.answers.find((x) => keysA.includes(lastName(x.choice)))?.pct, r = p.answers.find((x) => keysR.includes(lastName(x.choice)))?.pct;
    if (avg.margin != null && a != null && r != null) s.res.push(a - r - avg.margin);
  }
}
for (const d of districts) for (const p of d.polls || []) { const s = pst(p.pollster); s.n++; s.house++; if (p.partisan === "REP") s.rB++; else if (p.partisan === "DEM") s.dB++; if (p.date > s.last) s.last = p.date; }
const pollsters = Object.values(pstats).map((s) => {
  const rt = pollsterRating(s.name);
  const h = rt?.id ? HIST[rt.id] : null;
  const he = s.res.length ? s.res.reduce((a, b) => a + b, 0) / (s.res.length + 2) : null; // shrunk toward zero
  return {
    name: s.name, n: s.n, gen: s.gen, sen: s.sen, house: s.house, rB: s.rB, dB: s.dB, internal: s.internal || undefined, last: s.last,
    grade: rt?.grade, ratedAs: rt && rt.as !== s.name ? rt.as : undefined, partisanWork: rt?.partisanWork != null ? Math.round(rt.partisanWork * 100) : undefined,
    he: round(he, 1), heN: s.res.length, hist: h ? { bias: h.bias, n: h.n, err: h.absErr } : undefined, weight: round(ratingWeight(s.name), 2),
  };
}).sort((a, b) => b.n - a.n);
console.log(`  ${pollsters.length} pollsters, ${pollsters.filter((p) => p.grade).length} rated by 538`);

// ---------- recent polls feed + ticker ----------
const feed = [];
for (const p of genericPolls) if (Date.parse(p.end_date) > NOW - 45 * DAY) {
  const d = p.answers.find((a) => a.choice === "Dem")?.pct, r = p.answers.find((a) => a.choice === "Rep")?.pct;
  feed.push({ type: "generic", date: p.end_date, pollster: p.pollster, pop: p.population, n: p.sample_size, url: p.url, ...pollMeta(p), D: d, R: r });
}
for (const race of races) for (const p of race.polls) if (Date.parse(p.date) > NOW - 45 * DAY) feed.push({ type: "senate", st: race.st, ...p });
for (const d of districts) for (const p of d.polls || []) if (Date.parse(p.date) > NOW - 45 * DAY) feed.push({ type: "house", id: d.id, ...p, D: p.d, R: p.r, d: undefined, r: undefined });
feed.sort((a, b) => b.date.localeCompare(a.date));

// ---------- history ----------
console.log("Building history…");
async function pmHistory(token, days = 420) {
  if (!token) return [];
  const h = await getJSON(`${CLOB}/prices-history?market=${token}&interval=max&fidelity=1440`);
  return (h?.history || []).filter((x) => x.t * 1000 > NOW - days * DAY).map((x) => [Math.round(x.t / 86400) * 86400, round(x.p)]);
}
async function kHistory(series, ticker) {
  const end = Math.floor(NOW / 1000), start = end - 420 * 86400;
  const h = await getJSON(`${KAL}/series/${series}/markets/${ticker}/candlesticks?start_ts=${start}&end_ts=${end}&period_interval=1440`);
  return (h?.candlesticks || []).filter((c) => c.price?.close_dollars != null || c.yes_bid?.close_dollars != null)
    .map((c) => { const bid = +c.yes_bid?.close_dollars, ask = +c.yes_ask?.close_dollars; const p = bid > 0 && ask > 0 && ask - bid <= 0.1 ? (bid + ask) / 2 : +c.price.close_dollars; return [Math.round(c.end_period_ts / 86400) * 86400, round(p)]; })
    .filter((x) => x[1] > 0);
}
const [hPmHouse, hPmSen, hKHouse, hKSen] = await Promise.all([
  pmHistory(pmHouseD?.token), pmHistory(pmSenD?.token), kHistory("CONTROLH", "CONTROLH-2026-D"), kHistory("CONTROLS", "CONTROLS-2026-D"),
]);
// Normalise two-sided markets: we only fetched the D side, so prices already approximate P(D).
const gbSeries = [], housePollSeries = [];
const firstDay = Math.floor(Date.parse("2025-06-01") / DAY);
for (let day = firstDay; day <= Math.floor(NOW / DAY); day++) {
  const t = day * DAY + DAY - 1;
  const g = gbAverage(genericPolls, t);
  if (!g) continue;
  gbSeries.push([day * 86400, round(g.margin, 2), round(g.dem, 1), round(g.rep, 1)]);
  housePollSeries.push([day * 86400, round(houseFromGB(g.margin, Math.max(0, (ELECTION - t) / DAY)).pD)]);
}
// Senate polling model, weekly
const senPollSeries = [];
for (let t = Date.parse("2026-02-01"); t <= NOW + DAY; t += 7 * DAY) {
  const tt = Math.min(t, NOW);
  const g = gbAverage(genericPolls, tt);
  if (!g) continue;
  const probs = CFG.races.map((race) => { const m = raceModel(race, tt, g.margin, Math.max(0, (ELECTION - tt) / DAY)); const o = { D: 0, R: 1 - m.pAlt, I: 0 }; o[m.pa.A.party] = m.pAlt; return o; });
  senPollSeries.push([Math.floor(tt / DAY) * 86400, round(simulateSenate(probs, 4000, 11).pD)]);
}
const at = (series, ts) => { // value at or before ts (within 10 days)
  let v = null;
  for (const [t, p] of series) { if (t <= ts) v = [t, p]; else break; }
  return v && ts - v[0] <= 10 * 86400 ? v[1] : null;
};
function combineSeries(pollS, pmS, kS) {
  return pollS.map(([t, p]) => { const a = at(pmS, t), b = at(kS, t); return [t, round(blend(p, a, b))]; });
}
const today = Math.floor(NOW / DAY) * 86400;
const houseCombSeries = combineSeries(housePollSeries, hPmHouse, hKHouse);
const senCombSeries = combineSeries(senPollSeries.slice(0, -1).concat([[today, round(senPollSim.pD)]]), hPmSen, hKSen);
houseCombSeries[houseCombSeries.length - 1] = [today, round(houseCombinedD)];
senCombSeries[senCombSeries.length - 1] = [today, round(senateCombinedD)];

// Per-race Polymarket history (challenger/alt side) for sparklines
const raceHist = {};
await pool(races, 4, async (r) => {
  const alt = r.c.find((c) => c.party === r.altParty);
  const rep = r.c.find((c) => c.party === "R");
  const h = await pmHistory(alt?.token || rep?.token, 120);
  if (h.length) raceHist[r.st] = { party: alt?.token ? r.altParty : "R", h: h.map(([t, p]) => [t, p]) };
});
for (const r of races) for (const c of r.c) delete c.token;

// ---------- write ----------
const latest = {
  updated: new Date(NOW).toISOString(), election: "2026-11-03", daysOut: Math.ceil(daysOut), weights: W,
  house: {
    p: { D: round(houseCombinedD), R: round(1 - houseCombinedD) },
    sources: { polls: round(housePoll.pD), polymarket: round(pmHouseD?.p), kalshi: round(kHouseD?.p) },
    d1: { polymarket: round(pmHouseD?.d1), kalshi: round(kHouseD?.d1) },
    vol: { polymarket: Math.round(pmHouseD?.vol || 0), kalshi: Math.round(kHouseD?.vol || 0) },
    seats: { lo: D_LO, combined: combinedSeatDist.map((x) => round(x, 4)), polls: pollSeatDist.map((x) => round(x, 4)), market: marketSeatDist?.map((x) => round(x, 4)) },
    expected: Object.fromEntries(Object.entries(houseExpected).map(([k, v]) => [k, round(v, 1)])),
    model: { slope: H_SLOPE, bias: H_BIAS, mean: round(housePoll.mean, 1), sd: round(housePoll.sd, 1) },
    popVote: { polls: round(GB.margin, 1), polymarket: round(pmPopMargin, 1) },
    pmSlug: "which-party-will-win-the-house-in-2026", balance: pmMarkets(pmBalance).map((m) => ({ label: m.label, p: round(m.p) })),
  },
  senate: {
    p: { D: round(senateCombinedD), R: round(1 - senateCombinedD) },
    sources: { polls: round(senPollSim.pD), polymarket: round(pmSenD?.p), kalshi: round(kSenD?.p) },
    d1: { polymarket: round(pmSenD?.d1), kalshi: round(kSenD?.d1) },
    vol: { polymarket: Math.round(pmSenD?.vol || 0), kalshi: Math.round(kSenD?.vol || 0) },
    notUp: CFG.notUp, seats: { lo: S_LO, combined: senCombSim.rSeats.map((x) => round(x, 4)), polls: senPollSim.rSeats.map((x) => round(x, 4)), polymarket: pmSenDist?.map((x) => round(x, 4)) },
    expectedR: Object.fromEntries(Object.entries(senExpectedR).map(([k, v]) => [k, round(v, 1)])),
    simCombinedD: round(senCombSim.pD), pmSlug: "which-party-will-win-the-senate-in-2026",
  },
  generic: { margin: round(GB.margin, 1), dem: round(GB.dem, 1), rep: round(GB.rep, 1), n: GB.n },
  races, districts, feed: feed.slice(0, 80), pollsters,
  live: { // Polymarket identifiers the page polls directly for live prices
    house: "which-party-will-win-the-house-in-2026", senate: "which-party-will-win-the-senate-in-2026",
  },
};
const history = {
  house: { combined: houseCombSeries, polls: housePollSeries, polymarket: hPmHouse, kalshi: hKHouse },
  senate: { combined: senCombSeries, polls: senPollSeries, polymarket: hPmSen, kalshi: hKSen },
  generic: gbSeries,
  genericPolls: genericPolls.filter((p) => Date.parse(p.end_date) > Date.parse("2025-06-01")).map((p) => {
    const d = p.answers.find((a) => a.choice === "Dem")?.pct, r = p.answers.find((a) => a.choice === "Rep")?.pct;
    return [Math.floor(Date.parse(p.end_date) / 1000), round(d - r, 1), p.pollster, pollsterRating(p.pollster)?.grade ?? null, p.partisan || null];
  }).filter((x) => x[1] != null),
  races: raceHist,
};
write("data/latest.json", latest);
write("data/history.json", history);
console.log(`Done. ${races.length} Senate races, ${districts.length} House districts, ${feed.length} recent polls.`);
