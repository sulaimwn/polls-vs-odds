"use strict";
(() => {
  // ---------- utilities ----------
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
  const STATE_NAMES = { AL: "Alabama", AK: "Alaska", AZ: "Arizona", AR: "Arkansas", CA: "California", CO: "Colorado", CT: "Connecticut", DE: "Delaware", FL: "Florida", GA: "Georgia", HI: "Hawaii", ID: "Idaho", IL: "Illinois", IN: "Indiana", IA: "Iowa", KS: "Kansas", KY: "Kentucky", LA: "Louisiana", ME: "Maine", MD: "Maryland", MA: "Massachusetts", MI: "Michigan", MN: "Minnesota", MS: "Mississippi", MO: "Missouri", MT: "Montana", NE: "Nebraska", NV: "Nevada", NH: "New Hampshire", NJ: "New Jersey", NM: "New Mexico", NY: "New York", NC: "North Carolina", ND: "North Dakota", OH: "Ohio", OK: "Oklahoma", OR: "Oregon", PA: "Pennsylvania", RI: "Rhode Island", SC: "South Carolina", SD: "South Dakota", TN: "Tennessee", TX: "Texas", UT: "Utah", VT: "Vermont", VA: "Virginia", WA: "Washington", WV: "West Virginia", WI: "Wisconsin", WY: "Wyoming" };
  const PARTY = { D: "Democrat", R: "Republican", I: "Independent", O: "Other" };
  const SRC_COLORS = { combined: "#ffffff", polls: "#ffb224", polymarket: "#7dd3fc", kalshi: "#34d399" };
  const HEX = { safeD: "#2d5cf0", likelyD: "#5b86ff", leanD: "#a3bbff", toss: "#a69fb8", leanR: "#ffa7af", likelyR: "#ff6876", safeR: "#e5304a", safeI: "#8457f5", likelyI: "#a888ff", leanI: "#d2bfff", dem: "#4a7bff", rep: "#ff4d5e", ind: "#b58cff" };
  const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const DAY = 86400;
  const STATIC = !!window.CR_STATIC; // snapshot copy (e.g. a Claude Artifact) where live market calls are blocked

  const pct = (p, d = 0) => {
    if (p == null || Number.isNaN(p)) return "—";
    if (d === 0 && p > 0.995) return ">99%";
    if (d === 0 && p < 0.005) return "<1%";
    return (p * 100).toFixed(d) + "%";
  };
  const marginStr = (m, pos = "D") => (m == null ? "—" : Math.abs(m) < 0.05 ? "Even" : (m > 0 ? pos + "+" : "R+") + Math.abs(m).toFixed(1));
  const ago = (iso) => {
    const s = Math.max(0, (Date.now() - Date.parse(iso)) / 1000);
    if (s < 60) return `${Math.round(s)}s ago`;
    if (s < 3600) return `${Math.round(s / 60)} min ago`;
    if (s < 86400) return `${Math.round(s / 3600)} hr ago`;
    return `${Math.round(s / 86400)} days ago`;
  };
  const fmtDate = (t) => { const d = new Date(t * 1000); return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}`; };
  const shortDate = (s) => { const d = new Date(s + "T12:00:00Z"); return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`; };
  const cleanWords = (n) => n.replace(/["“”][^"“”]*["“”]/g, " ").split(/\s+/).filter((w) => w && !/^(jr|sr|ii|iii)\.?,?$/i.test(w));
  const initials = (n) => { const w = cleanWords(n); return ((w[0]?.[0] || "") + (w.length > 1 ? w[w.length - 1][0] : "")).toUpperCase(); };
  const lastName = (n) => { const w = cleanWords(n); return w[w.length - 1] || n; };
  const partyColor = (p) => (p === "D" ? HEX.dem : p === "R" ? HEX.rep : HEX.ind);

  function rating(pD, pR, pI = 0) {
    const lead = pD >= pR && pD >= pI ? "D" : pR >= pI ? "R" : "I";
    const p = Math.max(pD, pR, pI);
    const tier = p >= 0.95 ? "safe" : p >= 0.8 ? "likely" : p >= 0.6 ? "lean" : "toss";
    const key = tier === "toss" ? "toss" : tier + lead;
    const label = tier === "toss" ? "Toss-up" : `${tier[0].toUpperCase() + tier.slice(1)} ${lead === "D" ? "Dem" : lead === "R" ? "Rep" : "Ind"}`;
    return { lead, p, tier, key, color: HEX[key], label, darkText: tier === "lean" || tier === "toss" };
  }
  const isLight = (hex) => { const v = parseInt(hex.slice(1), 16); return 0.299 * (v >> 16) + 0.587 * ((v >> 8) & 255) + 0.114 * (v & 255) > 150; };
  const rateTag = (rt, text) => `<span class="rate" style="background:${rt.color};color:${rt.darkText ? "#0b0f1a" : "#fff"}">${text || rt.label}</span>`;

  function avatar(c, size = "") {
    const cls = `av ${size} ${c.party || "O"}`;
    const alt = `${c.name} (${c.party || "?"})`;
    if (c.img) return `<span class="${cls}"><img src="${esc(c.img)}" alt="${esc(alt)}" loading="lazy" decoding="async" onerror="this.parentNode.textContent='${esc(initials(c.name))}'"></span>`;
    if (c.generic) return `<span class="${cls}" role="img" aria-label="${esc(alt)}">${c.party}</span>`;
    return `<span class="${cls}" role="img" aria-label="${esc(alt)}">${esc(initials(c.name))}</span>`;
  }
  const pbar = (parts) => `<div class="pbar">${parts.filter(([v]) => v > 0).map(([v, col]) => `<i style="width:${(v * 100).toFixed(2)}%;background:${col}"></i>`).join("")}</div>`;

  // poll badges: sponsor + 538 pollster rating
  function trust(g) {
    if (g == null) return { label: "Unrated", cls: "t-un" };
    if (g >= 2.5) return { label: "Top-rated", cls: "t-hi" };
    if (g >= 1.8) return { label: "Solid", cls: "t-ok" };
    if (g >= 1.0) return { label: "Mixed", cls: "t-mid" };
    return { label: "Low-rated", cls: "t-lo" };
  }
  const stars = (g) => { const h = Math.round(g * 2) / 2; return "★".repeat(Math.floor(h)) + (h % 1 ? "½" : ""); };
  function pollBadges(p) {
    const t = trust(p.grade);
    const sp = p.internal ? `<span class="bdg sI" title="Campaign internal poll${p.sponsors ? ": " + esc(p.sponsors) : ""}">Internal</span>` : "";
    const party = p.partisan === "REP" ? `<span class="bdg sR" title="Sponsored by a Republican-aligned group${p.sponsors ? ": " + esc(p.sponsors) : ""}">R-backed</span>`
      : p.partisan === "DEM" ? `<span class="bdg sD" title="Sponsored by a Democratic-aligned group${p.sponsors ? ": " + esc(p.sponsors) : ""}">D-backed</span>`
      : `<span class="bdg" title="${p.sponsors ? "Sponsor: " + esc(p.sponsors) : "No party sponsor"}">Nonpartisan</span>`;
    const rt = `<span class="bdg ${t.cls}" title="${p.grade != null ? `538 pollster rating ${p.grade} of 3${p.ratedAs ? ` (rated as ${esc(p.ratedAs)})` : ""}` : "Not in 538's pollster ratings"}">${p.grade != null ? `<span class="stars">${stars(p.grade)}</span> ` : ""}${t.label}</span>`;
    const ps = S.PI?.[p.pollster];
    const lean = ps && ps.heN >= 3 && Math.abs(ps.he) >= 1 ? `<span class="bdg ${ps.he > 0 ? "sD" : "sR"}" style="background:transparent" title="This pollster's results run ${Math.abs(ps.he)} pts more ${ps.he > 0 ? "Democratic" : "Republican"} than other polls of the same races this cycle">Leans ${ps.he > 0 ? "D" : "R"}+${Math.abs(ps.he).toFixed(1)}</span>` : "";
    return `<span class="badges">${party}${sp}${rt}${lean}</span>`;
  }

  // ---------- state ----------
  const S = { L: null, H: null, G: null, X: null, mapMode: "senate", build: false, trend: "house", feed: "all", pick: { senate: {}, house: {} }, live: { at: null, house: null, senate: null, race: {} }, open: null, lastFocus: null, showAllPolls: false };

  function blend(poll, pm, k) {
    const W = S.L.weights;
    const parts = [[poll, W.polls], [pm, W.polymarket], [k, W.kalshi]].filter(([v]) => v != null);
    const tw = parts.reduce((a, [, w]) => a + w, 0);
    return tw ? parts.reduce((a, [v, w]) => a + v * w, 0) / tw : null;
  }
  function raceP(r) {
    const live = S.live.race[r.st];
    if (!live) return r.p;
    const o = {};
    for (const P of ["D", "R", "I"]) o[P] = blend(r.poll[P], live[P], r.k?.[P]);
    return o;
  }
  const racePM = (r) => S.live.race[r.st] || r.pm;
  function chamber(name) {
    const c = S.L[name];
    const pm = S.live[name] ?? c.sources.polymarket;
    return { pD: blend(c.sources.polls, pm, c.sources.kalshi), pm, polls: c.sources.polls, kalshi: c.sources.kalshi, live: S.live[name] != null };
  }
  const raceBy = (st) => S.L.races.find((r) => r.st === st);
  const distBy = (id) => S.L.districts.find((d) => d.id === id);

  // ---------- simulations (mirror scripts/update.mjs) ----------
  function phiInv(p) {
    p = clamp(p, 1e-6, 1 - 1e-6);
    const a = [-39.69683028665376, 220.9460984245205, -275.9285104469687, 138.357751867269, -30.66479806614716, 2.506628277459239];
    const b = [-54.47609879822406, 161.5858368580409, -155.6989798598866, 66.80131188771972, -13.28068155288572];
    const c = [-0.007784894002430293, -0.3223964580411365, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
    const d = [0.007784695709041462, 0.3224671290700398, 2.445134137142996, 3.754408661907416];
    if (p < 0.02425) { const q = Math.sqrt(-2 * Math.log(p)); return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1); }
    if (p > 1 - 0.02425) { const q = Math.sqrt(-2 * Math.log(1 - p)); return -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1); }
    const q = p - 0.5, r = q * q;
    return (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
  }
  function rng(seed) {
    let s = seed >>> 0;
    const u = () => { s += 0x6d2b79f5; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
    let spare = null;
    const n = () => { if (spare != null) { const v = spare; spare = null; return v; } const r = Math.sqrt(-2 * Math.log(u() || 1e-12)), a = 2 * Math.PI * u(); spare = r * Math.sin(a); return r * Math.cos(a); };
    return { u, n };
  }
  function simulateSenate(picks = {}, N = 20000) {
    const races = S.L.races, nu = S.L.senate.notUp;
    const { u, n } = rng(2026);
    const SD = 6, NAT = 3.5, LOC = Math.sqrt(SD * SD - NAT * NAT);
    const probs = races.map(raceP);
    const z = probs.map((p) => SD * phiInv(clamp(1 - p.R, 0.0005, 0.9995)));
    const share = probs.map((p) => (p.D + p.I > 0 ? p.D / (p.D + p.I) : 1));
    let dc = 0, seats = 0;
    for (let k = 0; k < N; k++) {
      const e = n() * NAT;
      let R = nu.R, D = nu.D;
      for (let i = 0; i < z.length; i++) {
        const f = picks[races[i].st];
        if (f) { if (f === "R") R++; else if (f === "D") D++; continue; }
        if (z[i] + e + n() * LOC > 0) { if (u() < share[i]) D++; } else R++;
      }
      seats += 100 - R;
      dc += R >= 50 ? 0 : D >= 51 ? 1 : 0.5;
    }
    return { pD: dc / N, nonR: seats / N };
  }
  function simulateHouse(picks = {}, N = 4000) {
    const ds = S.L.districts;
    const { n } = rng(435);
    const SD = 7, NAT = 2, LOC = Math.sqrt(SD * SD - NAT * NAT);
    const z = ds.map((d) => SD * phiInv(d.p));
    const fixed = ds.map((d) => (picks[d.id] ? (picks[d.id] === "D" ? 1 : 0) : d.sameParty ? (d.p > 0.5 ? 1 : 0) : -1));
    let ctl = 0, seats = 0;
    for (let k = 0; k < N; k++) {
      const e = n() * NAT;
      let D = 0;
      for (let i = 0; i < z.length; i++) { const f = fixed[i]; if (f >= 0) D += f; else if (z[i] + e + n() * LOC > 0) D++; }
      seats += D;
      if (D >= 218) ctl++;
    }
    return { pD: ctl / N, d: seats / N };
  }

  // ---------- hero ----------
  function animateNumber(el, to, fmt, dur = 900) {
    const from = +el.dataset.v || 0;
    el.dataset.v = to;
    if (reduceMotion || Math.abs(from - to) < 1e-6) { el.innerHTML = fmt(to); return; }
    const t0 = performance.now();
    const step = (t) => { const k = Math.min(1, (t - t0) / dur), e = 1 - Math.pow(1 - k, 3); el.innerHTML = fmt(from + (to - from) * e); if (k < 1) requestAnimationFrame(step); };
    requestAnimationFrame(step);
  }
  function renderBoard(name) {
    const c = S.L[name], ch = chamber(name);
    const pD = ch.pD, lead = pD >= 0.5 ? "D" : "R", pl = lead === "D" ? pD : 1 - pD;
    const board = $(`#board-${name}`);
    board.style.setProperty("--glow", lead === "D" ? "rgba(74,123,255,.26)" : "rgba(255,77,94,.24)");
    board.style.setProperty("--glow-x", lead === "D" ? "15%" : "85%");
    $(`#${name}-lead-label`).innerHTML = `<span class="${lead === "D" ? "dem" : "rep"}">${lead === "D" ? "Democrats" : "Republicans"}</span> win control`;
    const big = $(`#${name}-big`);
    big.style.color = lead === "D" ? "var(--dem-hi)" : "var(--rep-hi)";
    animateNumber(big, pl, (v) => `${(v * 100).toFixed(1)}<small>%</small>`);
    $(`#${name}-opp-label`).innerHTML = `<span class="${lead === "D" ? "rep" : "dem"}">${lead === "D" ? "Republicans" : "Democrats"}</span>`;
    const opp = $(`#${name}-opp`);
    opp.style.color = lead === "D" ? "var(--rep-hi)" : "var(--dem-hi)";
    animateNumber(opp, 1 - pl, (v) => (v * 100).toFixed(1) + "%");
    $(`#${name}-tug`).style.width = (pD * 100).toFixed(2) + "%";
    const r = rating(pD, 1 - pD), tag = $(`#${name}-rating`);
    tag.textContent = r.label; tag.style.background = r.color; tag.style.color = r.darkText ? "#0b0f1a" : "#fff";
    if (name === "house") {
      const e = c.expected.combined;
      $("#house-seats").innerHTML = `<span>Projected seats</span><span><b class="dem">${Math.round(e)} D</b> · <b class="rep">${435 - Math.round(e)} R</b></span>`;
    } else {
      const nonR = 100 - c.expectedR.combined;
      $("#senate-seats").innerHTML = `<span>Projected seats</span><span><b class="dem">${nonR.toFixed(1)} D+I</b> · <b class="rep">${c.expectedR.combined.toFixed(1)} R</b></span>`;
    }
    const chg = (d) => (d == null || Math.abs(d) < 0.0005 ? "" : `<span class="${d > 0 ? "chg-up" : "chg-down"}">${d > 0 ? "▲" : "▼"}${Math.abs(d * 100).toFixed(1)}</span>`);
    const vol = (v) => (v >= 1e6 ? `$${(v / 1e6).toFixed(1)}M traded` : v >= 1e3 ? `$${Math.round(v / 1e3)}K traded` : "");
    $(`#${name}-sources`).innerHTML = [
      ["Polls", ch.polls, name === "house" ? `Generic ballot ${marginStr(S.L.generic.margin)}` : "20k simulations", ""],
      ["Polymarket", ch.pm, vol(c.vol.polymarket), chg(c.d1.polymarket), ch.live],
      ["Kalshi", ch.kalshi, vol(c.vol.kalshi), chg(c.d1.kalshi)],
    ].map(([n, v, sub, ch2, live]) => `<div class="src"><div class="src-name">${n}${live ? '<em title="Live price fetched by your browser">●live</em>' : ""}</div><div class="src-val" style="color:${v >= 0.5 ? "var(--dem-hi)" : "var(--rep-hi)"}">${v == null ? "—" : `${v >= 0.5 ? "D" : "R"} ${pct(v >= 0.5 ? v : 1 - v, 1)}`}</div><div class="src-sub">${sub} ${ch2 || ""}</div></div>`).join("");
    if (S.H) spark($(`#${name}-spark`), S.H[name].combined);
    renderFormula(name, ch);
  }
  // the arithmetic behind the headline number, shown on each board
  function terms(ch) {
    const W = S.L.weights;
    const parts = [["Polls", ch.polls, W.polls], ["Polymarket", ch.pm, W.polymarket], ["Kalshi", ch.kalshi, W.kalshi]].filter(([, v]) => v != null);
    const tw = parts.reduce((a, [, , w]) => a + w, 0);
    return parts.map(([n, v, w]) => ({ n, v, w: w / tw, c: (v * w) / tw }));
  }
  function renderFormula(name, ch) {
    const t = terms(ch);
    $(`#${name}-formula`).innerHTML = t.map((x, i) => `${i ? '<span class="op">+</span>' : ""}<span class="t">${x.n} <b>${(x.v * 100).toFixed(1)}%</b> × ${Math.round(x.w * 100)}%</span>`).join("") + `<span class="op">=</span><span class="eq">D ${(ch.pD * 100).toFixed(1)}%</span><a href="#method">How this works →</a>`;
  }
  function renderExplainer() {
    const html = ["house", "senate"].map((name) => {
      const ch = chamber(name), t = terms(ch), lead = ch.pD >= 0.5 ? "D" : "R";
      const col = { Polls: SRC_COLORS.polls, Polymarket: SRC_COLORS.polymarket, Kalshi: SRC_COLORS.kalshi };
      const sub = { Polls: name === "house" ? `generic ballot ${marginStr(S.L.generic.margin)}` : "20k simulations", Polymarket: ch.live ? "live price" : "snapshot", Kalshi: "server snapshot" };
      return `<div class="panel eq"><div class="eq-head"><h3>${name === "house" ? "House" : "Senate"}</h3><span class="muted mono" style="font-size:12px">chance Democrats win control</span></div>
        <div class="eq-rows">${t.map((x) => `<div class="eq-row"><span class="nm">${x.n}<small>${sub[x.n]}</small></span><div class="eq-bar"><i style="width:${x.v * 100}%;background:${col[x.n]}"></i></div><span class="v">${(x.v * 100).toFixed(1)}%</span><span class="x">×${Math.round(x.w * 100)}</span><span class="c" style="color:${col[x.n]}">${(x.c * 100).toFixed(1)}</span></div>`).join("")}</div>
        <div class="eq-stack" aria-hidden="true">${t.map((x) => `<div style="flex:${x.c};background:${col[x.n]}"></div>`).join("")}<div style="flex:${1 - ch.pD};background:var(--ink-4)"></div></div>
        <div class="eq-total"><span class="lab">${t.map((x) => (x.c * 100).toFixed(1)).join(" + ")} =</span><span class="big2" style="color:${lead === "D" ? "var(--dem-hi)" : "var(--rep-hi)"}">${(ch.pD * 100).toFixed(1)}%</span></div>
        <div class="eq-note">${name === "house"
          ? `The polls say ${pct(ch.polls, 0)} because the generic-ballot average of ${marginStr(S.L.generic.margin)} works out to about ${Math.round(S.L.house.model.mean)} Democratic seats, ${Math.round(S.L.house.model.mean - 217.5)} past the 218 line, with a ±${Math.round(S.L.house.model.sd)}-seat margin of error. Traders are a little more cautious, so the blend lands at ${pct(ch.pD, 1)}.`
          : `Democrats need 17 of the 35 races. The polling model wins it for them in ${pct(ch.polls, 0)} of 20,000 simulated elections; the markets price it at ${pct(ch.pm, 0)} and ${pct(ch.kalshi, 0)}. The tipping-point race is ${tippingRace()}.`}</div>
      </div>`;
    }).join("");
    $("#eqGrid").innerHTML = html;
    const tx = S.L.races.filter((r) => r.avg && r.altParty === "D").sort((a, b) => b.nPolls - a.nPolls)[0];
    if (tx) $("#exampleAvg").textContent = `${lastName(tx.c.find((c) => c.party === "D").name)} ${marginStr(tx.avg.margin)} in ${tx.name} across ${tx.nPolls} polls`;
    const gaps = S.L.races.filter((r) => r.pm && r.poll).map((r) => ({ r, g: r.poll.R - (r.pm.R + (r.k?.R ?? r.pm.R)) / 2 })).filter((x) => Math.abs(x.g) > 0.08).sort((a, b) => Math.abs(b.g) - Math.abs(a.g)).slice(0, 3);
    if (gaps.length) $("#disagree").textContent = `Right now the biggest gaps are ${gaps.map(({ r, g }) => `${r.name} (polls ${g < 0 ? "more Democratic" : "more Republican"} than traders by ${Math.abs(Math.round(g * 100))} points)`).join(", ")}.`;
  }
  function tippingRace() {
    const ord = S.L.races.map((r) => ({ r, p: raceP(r) })).sort((a, b) => a.p.R - b.p.R);
    const t = ord[51 - S.L.senate.notUp.D - 1];
    return `${t.r.name}, where Democrats have a ${pct(1 - t.p.R)} chance`;
  }

  // ---------- pollster scorecard ----------
  const PS = { sort: "n", dir: -1, q: "", all: false };
  function heAxis(v) {
    const W = 92, H = 16, x = (d) => W / 2 + clamp(d, -6, 6) * (W / 2 - 4) / 6;
    return `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" aria-hidden="true"><line x1="4" x2="${W - 4}" y1="8" y2="8" stroke="rgba(150,170,230,.25)"/><line x1="${W / 2}" x2="${W / 2}" y1="2" y2="14" stroke="rgba(255,255,255,.45)"/>${[-4, 4].map((t) => `<line x1="${x(t)}" x2="${x(t)}" y1="5" y2="11" stroke="rgba(150,170,230,.3)"/>`).join("")}${v == null ? "" : `<line x1="${W / 2}" x2="${x(v)}" y1="8" y2="8" stroke="${v >= 0 ? HEX.dem : HEX.rep}" stroke-width="3" stroke-linecap="round"/><circle cx="${x(v)}" cy="8" r="4.5" fill="${v >= 0 ? HEX.dem : HEX.rep}"/>`}</svg>`;
  }
  const leanStr = (v) => (v == null ? "—" : Math.abs(v) < 0.5 ? "≈ avg" : `${v > 0 ? "D" : "R"}+${Math.abs(v).toFixed(1)}`);
  function verdict(p) {
    const out = [];
    const t = trust(p.grade);
    if (p.grade == null) out.push("No track record with 538 yet");
    else out.push(`${t.label} by 538`);
    if (p.he != null && p.heN >= 3) out.push(Math.abs(p.he) < 1 ? "close to other polls this cycle" : `runs ${Math.abs(p.he).toFixed(1)} pts more ${p.he > 0 ? "Democratic" : "Republican"} than other polls this cycle`);
    if (p.hist && p.hist.n >= 10 && Math.abs(p.hist.bias) >= 2) out.push(`historically overstated ${p.hist.bias > 0 ? "Democrats" : "Republicans"}`);
    const sp = p.rB + p.dB;
    if (sp && sp / p.n >= 0.5) out.push(`mostly ${p.rB >= p.dB ? "Republican" : "Democratic"}-sponsored`);
    return out.join("; ") + ".";
  }
  function renderPollsters() {
    const ps = (S.L.pollsters || []).filter((p) => !PS.q || p.name.toLowerCase().includes(PS.q));
    const key = { n: (p) => p.n, grade: (p) => p.grade ?? -1, he: (p) => p.he ?? -99, hist: (p) => p.hist?.bias ?? -99, weight: (p) => p.weight, name: (p) => p.name.toLowerCase() }[PS.sort];
    ps.sort((a, b) => { const x = key(a), y = key(b); return (x > y ? 1 : x < y ? -1 : 0) * PS.dir; });
    const th = (k, label, r) => `<th class="${r ? "r" : ""}"><button type="button" data-sort="${k}" aria-sort="${PS.sort === k ? (PS.dir < 0 ? "descending" : "ascending") : "none"}">${label}</button></th>`;
    $("#pollsterTable").innerHTML = `<thead><tr>${th("name", "Pollster")}${th("grade", "538 rating")}${th("n", "Polls", true)}<th>Sponsors</th>${th("he", "House effect 2026")}${th("hist", "Track record 2016–24")}${th("weight", "Weight", true)}<th>Our read</th></tr></thead><tbody>` +
      ps.slice(0, PS.q || PS.all ? 300 : 25).map((p) => {
        const t = trust(p.grade);
        const sp = [p.rB ? `<span class="bdg sR">${p.rB} R-backed</span>` : "", p.dB ? `<span class="bdg sD">${p.dB} D-backed</span>` : "", p.internal ? `<span class="bdg sI">${p.internal} internal</span>` : ""].filter(Boolean).join(" ") || '<span class="bdg">Nonpartisan</span>';
        const mix = [p.sen ? `${p.sen} Senate` : "", p.gen ? `${p.gen} generic` : "", p.house ? `${p.house} House` : ""].filter(Boolean).join(" · ");
        return `<tr><td class="pn">${esc(p.name)}<small>${mix}${p.last ? ` · latest ${shortDate(p.last)}` : ""}${p.ratedAs ? ` · rated as ${esc(p.ratedAs)}` : ""}</small></td>
          <td><span class="bdg ${t.cls}">${p.grade != null ? `<span class="stars">${stars(p.grade)}</span> ${p.grade.toFixed(1)}` : "Unrated"}</span></td>
          <td class="r mono">${p.n}</td><td><span class="badges" style="margin:0">${sp}</span></td>
          <td><div class="he" title="${p.heN} polls compared">${heAxis(p.heN ? p.he : null)}<span style="color:${p.he == null || Math.abs(p.he) < 0.5 ? "var(--muted)" : p.he > 0 ? "var(--dem-hi)" : "var(--rep-hi)"}">${p.heN ? leanStr(p.he) : "—"}</span></div></td>
          <td><div class="he" title="${p.hist ? `${p.hist.n} final polls, average miss ${p.hist.err} pts` : "No 538 history"}">${heAxis(p.hist ? p.hist.bias : null)}<span style="color:${!p.hist || Math.abs(p.hist.bias) < 0.5 ? "var(--muted)" : p.hist.bias > 0 ? "var(--dem-hi)" : "var(--rep-hi)"}">${p.hist ? leanStr(p.hist.bias) : "—"}</span></div></td>
          <td class="r mono">×${p.weight.toFixed(2)}</td><td class="verdict">${esc(verdict(p))}</td></tr>`;
      }).join("") + "</tbody>";
    const more = $("#pollsterMore");
    more.hidden = !!PS.q || ps.length <= 25;
    more.textContent = PS.all ? "Show top 25" : `Show all ${ps.length} pollsters`;
  }
  function bindPollsters() {
    $("#pollsterTable").addEventListener("click", (e) => { const b = e.target.closest("[data-sort]"); if (!b) return; const k = b.dataset.sort; if (PS.sort === k) PS.dir *= -1; else { PS.sort = k; PS.dir = k === "name" ? 1 : -1; } renderPollsters(); });
    $("#pollsterSearch").addEventListener("input", (e) => { PS.q = e.target.value.trim().toLowerCase(); renderPollsters(); });
    $("#pollsterMore").addEventListener("click", () => { PS.all = !PS.all; renderPollsters(); });
  }
  function spark(svg, series) {
    if (!series?.length) return;
    const pts = series.slice(-150);
    const t0 = pts[0][0], t1 = pts[pts.length - 1][0];
    const x = (t) => ((t - t0) / (t1 - t0 || 1)) * 600, y = (p) => 50 - p * 46;
    const line = pts.map(([t, p], i) => `${i ? "L" : "M"}${x(t).toFixed(1)},${y(p).toFixed(1)}`).join("");
    const last = pts[pts.length - 1];
    svg.innerHTML = `<defs><linearGradient id="sg-${svg.id}" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="#9db6ff" stop-opacity=".35"/><stop offset="1" stop-color="#9db6ff" stop-opacity="0"/></linearGradient></defs>
      <line x1="0" x2="600" y1="${y(0.5)}" y2="${y(0.5)}" stroke="rgba(255,255,255,.18)" stroke-dasharray="3 5" vector-effect="non-scaling-stroke"/>
      <path d="${line}L600,54L0,54Z" fill="url(#sg-${svg.id})"/>
      <path d="${line}" fill="none" stroke="#c9d6ff" stroke-width="1.6" vector-effect="non-scaling-stroke"/>
      <circle cx="${x(last[0])}" cy="${y(last[1])}" r="3" fill="#fff"/>`;
  }
  function renderOutcomes() {
    const b = S.L.house.balance;
    if (!b?.length) return;
    const map = [[/Democrats Sweep/i, HEX.dem, "Democrats win both"], [/R Senate, D House/i, "#8a74c9", "Dem House, GOP Senate"], [/D Senate, R House/i, "#b07ab8", "GOP House, Dem Senate"], [/Republicans Sweep/i, HEX.rep, "Republicans win both"]];
    const items = map.map(([re, col, lab]) => { const m = b.find((x) => re.test(x.label)); return m ? { p: m.p, col, lab } : null; }).filter(Boolean);
    const tot = items.reduce((a, x) => a + x.p, 0);
    $("#outcomeBar").innerHTML = items.map((x) => `<div style="flex:${x.p / tot};background:${x.col}" title="${esc(x.lab)}: ${pct(x.p / tot)}">${x.p / tot > 0.07 ? pct(x.p / tot) : ""}</div>`).join("");
    $("#outcomeLegend").innerHTML = items.map((x) => `<span><i style="background:${x.col}"></i>${esc(x.lab)} <b style="color:var(--text)">${pct(x.p / tot)}</b></span>`).join("");
    $("#outcomes").hidden = false;
  }
  function renderHeader() {
    const days = Math.max(0, Math.ceil((Date.parse("2026-11-03T05:00:00Z") - Date.now()) / 86400e3));
    $("#countdown").textContent = days > 0 ? `${days} days to Election Day · Nov 3` : "Election Day · Nov 3";
    updateLivePill();
    const when = new Date(S.L.updated).toLocaleString([], { dateStyle: "medium", timeStyle: "short" });
    $("#updatedFoot").textContent = STATIC ? `Data snapshot from ${when}: polls, Polymarket and Kalshi as of that moment.` : `Polls & Kalshi last refreshed ${when}. Polymarket prices update live in your browser.`;
  }
  function updateLivePill() {
    const pill = $("#livePill"), txt = $("#liveText");
    if (STATIC) { pill.classList.add("stale"); txt.textContent = S.L ? `Snapshot · ${ago(S.L.updated)}` : "Loading"; pill.title = "A saved snapshot of polls and market prices. The full site updates live."; return; }
    if (S.live.at && Date.now() - S.live.at < 180e3) { pill.classList.remove("stale"); txt.textContent = `Live · ${ago(new Date(S.live.at).toISOString())}`; }
    else { pill.classList.add("stale"); txt.textContent = S.L ? `Updated ${ago(S.L.updated)}` : "Connecting"; }
  }

  // ---------- ticker ----------
  function feedTitle(f) { return f.type === "generic" ? "Generic ballot" : f.type === "senate" ? `${esc(STATE_NAMES[f.st])} Senate` : esc(f.id); }
  function feedNames(f) {
    if (f.type === "senate") {
      const r = raceBy(f.st), alt = r.c.find((c) => c.party === r.altParty), rep = r.c.find((c) => c.party === "R");
      return { a: lastName(alt.name), aP: r.altParty, aV: f[r.altParty], r: lastName(rep.name), rV: f.R };
    }
    if (f.type === "house") {
      const d = distBy(f.id), dc = d?.c.find((c) => c.party === "D"), rc = d?.c.find((c) => c.party === "R");
      return { a: dc ? lastName(dc.name) : "D", aP: "D", aV: f.D, r: rc ? lastName(rc.name) : "R", rV: f.R };
    }
    return { a: "Dem", aP: "D", aV: f.D, r: "Rep", rV: f.R };
  }
  function renderTicker() {
    const L = S.L, items = [];
    for (const k of ["house", "senate"]) { const c = chamber(k); items.push(`<span class="ticker-item"><span class="tag">${k === "house" ? "House" : "Senate"}</span> Combined <b class="${c.pD >= 0.5 ? "dem" : "rep"}">${c.pD >= 0.5 ? "D" : "R"} ${pct(Math.max(c.pD, 1 - c.pD), 1)}</b></span>`); }
    items.push(`<span class="ticker-item"><span class="tag">Generic ballot</span> <b>${marginStr(L.generic.margin)}</b> · D ${L.generic.dem} – R ${L.generic.rep}</span>`);
    const movers = [];
    for (const r of L.races) for (const c of r.c) if (c.d1 != null && Math.abs(c.d1) >= 0.02 && c.pm > 0.03) movers.push({ r, c });
    movers.sort((a, b) => Math.abs(b.c.d1) - Math.abs(a.c.d1));
    for (const { r, c } of movers.slice(0, 6)) { const good = (c.d1 > 0) === (c.party !== "R"); items.push(`<span class="ticker-item"><span class="tag ${good ? "up" : "down"}">Mover</span> ${esc(r.name)} Senate · <b>${esc(lastName(c.name))}</b> ${pct(c.pm)} ${c.d1 > 0 ? "▲" : "▼"}${Math.abs(c.d1 * 100).toFixed(1)} on Polymarket</span>`); }
    for (const f of L.feed.slice(0, 16)) { const n = feedNames(f); items.push(`<span class="ticker-item"><span class="tag poll">New poll</span> ${feedTitle(f)} · ${esc(f.pollster)}${f.partisan ? ` (${f.partisan === "REP" ? "R" : "D"}-backed)` : ""}: <b>${esc(n.a)} ${n.aV ?? "—"}, ${esc(n.r)} ${n.rV ?? "—"}</b></span>`); }
    const html = items.join("");
    $("#ticker").innerHTML = html + html;
  }

  // ---------- map ----------
  const LABEL_NUDGE = { FL: [14, 6], LA: [-10, 0], MI: [12, 22], KY: [4, 2], CA: [-8, 0], ID: [0, 14], WV: [-3, 3], VA: [8, 2], TX: [8, 0], MN: [-6, 8], NY: [6, 0], OK: [10, 0], NC: [6, 0], SC: [4, 0] };
  const SMALL = ["VT", "NH", "MA", "RI", "CT", "NJ", "DE", "MD"];
  function hexPoints(x, y, R) { let p = ""; for (let i = 0; i < 6; i++) { const a = (Math.PI / 180) * (60 * i - 30); p += `${(x + R * Math.cos(a)).toFixed(1)},${(y + R * Math.sin(a)).toFixed(1)} `; } return p.trim(); }
  function senateFill(st) {
    const race = raceBy(st);
    if (!race) return { fill: null };
    const pk = S.build ? S.pick.senate[st] : null;
    if (pk) return { fill: partyColor(pk), picked: true };
    const p = raceP(race);
    return { fill: rating(p.D, p.R, p.I).color };
  }
  function districtFill(d) {
    const pk = S.build ? S.pick.house[d.id] : null;
    if (pk) return { fill: partyColor(pk), picked: true };
    if (d.sameParty) return { fill: d.p > 0.5 ? HEX.safeD : HEX.safeR };
    return { fill: rating(d.p, 1 - d.p).color };
  }
  function renderMap() {
    const svg = $("#mapSvg");
    svg.classList.toggle("building", S.build);
    svg.parentElement.classList.toggle("hexmode", S.mapMode === "house");
    if (S.mapMode === "senate") {
      const G = S.G;
      svg.setAttribute("viewBox", "0 0 975 610");
      svg.setAttribute("aria-label", "Map of 2026 Senate races by state");
      svg.innerHTML = `<path d="${G.nation}" fill="none" stroke="rgba(150,170,230,.18)" stroke-width="1.2"/>` + G.states.map((s) => {
        const { fill, picked } = senateFill(s.abbr);
        const race = raceBy(s.abbr);
        const label = race ? `${s.name} Senate race` : `${s.name}: no Senate race this year`;
        return `<path class="st${fill ? "" : " none"}${picked ? " picked" : ""}${S.open === s.abbr ? " sel" : ""}" data-st="${s.abbr}" d="${s.d}" style="fill:${fill || "#151b2c"}" ${fill ? 'tabindex="0" role="button"' : ""} aria-label="${esc(label)}"></path>`;
      }).join("") + G.states.filter((s) => s.w > 26 && s.h > 18 && !SMALL.includes(s.abbr)).map((s) => {
        const [dx, dy] = LABEL_NUDGE[s.abbr] || [0, 0];
        const { fill } = senateFill(s.abbr);
        const light = !fill || !isLight(fill) || S.build;
        return `<text class="lbl${light ? " light" : ""}" x="${s.cx + dx}" y="${s.cy + dy}"${!fill ? ' style="fill:rgba(255,255,255,.22)"' : ""}>${s.abbr}</text>`;
      }).join("");
      $("#smallStates").hidden = false;
      $("#smallStates").innerHTML = "<span>Small states</span>" + SMALL.map((st) => { const { fill } = senateFill(st); return `<button class="chip" type="button" data-st="${st}" ${!fill ? 'disabled style="opacity:.4"' : ""}><i style="background:${fill || "#151b2c"}"></i>${st}</button>`; }).join("");
    } else {
      const X = S.X;
      svg.setAttribute("viewBox", X.viewBox.join(" "));
      svg.setAttribute("aria-label", "Hex map with one hexagon per House district");
      svg.innerHTML = X.hexes.map((h) => {
        const d = distBy(h.id);
        if (!d) return "";
        const { fill, picked } = districtFill(d);
        return `<polygon class="hx${picked ? " picked" : ""}${S.focusD === h.id ? " sel" : ""}" data-d="${h.id}" data-st="${h.st}" points="${h.pts}" style="fill:${fill}" tabindex="0" role="button" aria-label="${esc(h.id)}"></polygon>`;
      }).join("") + `<path class="hborder" d="${X.borders}"/>` + X.labels.map((l) => `<text class="hlbl" x="${l.x}" y="${l.y}">${l.st}</text>`).join("");
      $("#smallStates").hidden = true;
    }
    renderLegend();
    renderMapSide();
  }
  function renderLegend() {
    if (S.build) {
      $("#legend").innerHTML = `<span class="sw"><i style="background:${HEX.dem}"></i>Your pick: D</span><span class="sw"><i style="background:${HEX.rep}"></i>Your pick: R</span>${S.mapMode === "senate" ? `<span class="sw"><i style="background:${HEX.ind}"></i>Your pick: Ind</span>` : ""}<span class="sw" style="opacity:.6">Faded = forecast</span>`;
      return;
    }
    const L = [["safeD", "Safe D"], ["likelyD", "Likely D"], ["leanD", "Lean D"], ["toss", "Toss-up"], ["leanR", "Lean R"], ["likelyR", "Likely R"], ["safeR", "Safe R"]];
    $("#legend").innerHTML = L.map(([k, l]) => `<span class="sw"><i style="background:${HEX[k]}"></i>${l}</span>`).join("") + (S.mapMode === "senate" ? `<span class="sw"><i style="background:${HEX.likelyI}"></i>Ind</span><span class="sw"><i style="background:#151b2c;box-shadow:inset 0 0 0 1px rgba(255,255,255,.15)"></i>Not up</span>` : "");
  }
  function renderMapSide() {
    $("#buildPanel").hidden = !S.build;
    $("#kpiPanel").hidden = S.build;
    $("#closestPanel").hidden = S.build;
    $("#mapHint").hidden = !S.build;
    $("#mapHintText").textContent = S.mapMode === "senate" ? "Tap a state to color it blue, tap again for red, a third time to go back to the forecast." : "Tap a district to color it blue, tap again for red, a third time to go back to the forecast.";
    if (S.build) { renderBuildPanel(); return; }
    const L = S.L;
    if (S.mapMode === "senate") {
      const ps = L.races.map((r) => ({ r, p: raceP(r) }));
      const comp = ps.filter(({ p }) => Math.max(p.D, p.R, p.I) < 0.8).length;
      const flips = ps.reduce((a, { r, p }) => a + (1 - p[r.held]), 0);
      const gain = ps.reduce((a, { r, p }) => a + (r.held === "R" ? p.D + p.I : 0) - (r.held === "D" ? p.R : 0), 0);
      $("#mapKpiTitle").textContent = "Senate at a glance";
      $("#mapKpi").innerHTML = `<div><div class="k">Races up</div><div class="v">35</div></div><div><div class="k">Competitive</div><div class="v">${comp}</div></div><div><div class="k">Expected flips</div><div class="v">${flips.toFixed(1)}</div></div><div><div class="k">Net non-GOP gain</div><div class="v ${gain >= 0 ? "dem" : "rep"}">${gain >= 0 ? "+" : "−"}${Math.abs(gain).toFixed(1)}</div></div>`;
      $("#closestTitle").textContent = "Closest Senate races";
      $("#closest").innerHTML = ps.sort((a, b) => Math.abs(a.p.R - 0.5) - Math.abs(b.p.R - 0.5)).slice(0, 7).map(({ r, p }) => {
        const rt = rating(p.D, p.R, p.I), alt = r.c.find((c) => c.party === r.altParty), rep = r.c.find((c) => c.party === "R");
        return `<button type="button" data-st="${r.st}"><span class="did" style="color:${rt.color}">${r.st}</span><span class="who">${esc(lastName(alt.name))} <span class="muted">vs</span> ${esc(lastName(rep.name))}</span><span class="pct" style="color:${rt.color}">${rt.lead} ${pct(rt.p)}</span></button>`;
      }).join("");
    } else {
      const ds = L.districts;
      const toss = ds.filter((d) => d.p > 0.4 && d.p < 0.6).length, comp = ds.filter((d) => d.p > 0.2 && d.p < 0.8).length;
      const over = L.house.expected.combined - 217.5;
      $("#mapKpiTitle").textContent = "House at a glance";
      $("#mapKpi").innerHTML = `<div><div class="k">Expected D seats</div><div class="v dem">${L.house.expected.combined.toFixed(0)}</div></div><div><div class="k">Toss-ups</div><div class="v">${toss}</div></div><div><div class="k">Competitive</div><div class="v">${comp}</div></div><div><div class="k">Cushion vs 218</div><div class="v ${over >= 0 ? "dem" : "rep"}">${over >= 0 ? "D +" : "R +"}${Math.abs(Math.round(over))}</div></div>`;
      $("#closestTitle").textContent = "Closest districts";
      $("#closest").innerHTML = ds.filter((d) => !d.sameParty).sort((a, b) => Math.abs(a.p - 0.5) - Math.abs(b.p - 0.5)).slice(0, 7).map((d) => {
        const rt = rating(d.p, 1 - d.p), dc = d.c.find((c) => c.party === "D"), rc = d.c.find((c) => c.party === "R");
        return `<button type="button" data-st="${d.st}" data-d="${d.id}"><span class="did" style="color:${rt.color}">${d.id}</span><span class="who">${esc(dc ? lastName(dc.name) : "Dem")} <span class="muted">vs</span> ${esc(rc ? lastName(rc.name) : "Rep")}</span><span class="pct" style="color:${rt.color}">${rt.lead} ${pct(rt.p)}</span></button>`;
      }).join("");
    }
  }

  // build-your-own-map panel
  let buildTimer = null, baseCache = {};
  function renderBuildPanel() {
    const panel = $("#buildPanel");
    const senate = S.mapMode === "senate";
    const picks = senate ? S.pick.senate : S.pick.house;
    const keys = Object.keys(picks);
    let dLock, rLock, total, need, und;
    if (senate) {
      dLock = S.L.senate.notUp.D + keys.filter((k) => picks[k] !== "R").length;
      rLock = S.L.senate.notUp.R + keys.filter((k) => picks[k] === "R").length;
      total = 100; need = 51; und = total - dLock - rLock;
    } else {
      const ds = S.L.districts;
      dLock = ds.filter((d) => (picks[d.id] ? picks[d.id] === "D" : d.sameParty && d.p > 0.5)).length;
      rLock = ds.filter((d) => (picks[d.id] ? picks[d.id] === "R" : d.sameParty && d.p < 0.5)).length;
      total = 435; need = 218; und = total - dLock - rLock;
    }
    const chamberName = senate ? "Senate" : "House";
    const markPos = ((need - (senate ? 0.5 : 0.5)) / total) * 100;
    panel.innerHTML = `<div class="panel-title">Your ${chamberName} map <b>${keys.length} pick${keys.length === 1 ? "" : "s"}</b></div>
      <div class="build">
        <div><div class="build-res" id="buildRes">Simulating…</div><div class="build-sub" id="buildSub">&nbsp;</div></div>
        <div><div class="seatbar"><div style="flex:${dLock};background:${HEX.dem}">${dLock}</div><div class="open" style="flex:${und};background:var(--ink-4)">${und ? `${und} open` : ""}</div><div style="flex:${rLock};background:${HEX.rep}">${rLock}</div><span class="mark" style="left:${markPos}%"></span></div>
        <div class="seatbar-l"><span>${senate ? "D + Ind (incl. 34 not up)" : "Democratic locked"}</span><span>${need} to win</span><span>${senate ? "R (incl. 31 not up)" : "Republican locked"}</span></div></div>
        ${keys.length ? `<div class="picks">${keys.sort().map((k) => `<button type="button" data-unpick="${k}" style="background:${partyColor(picks[k])}" aria-label="Remove pick ${k}">${k}</button>`).join("")}</div>` : `<div class="note">Nothing picked yet. Tap ${senate ? "states" : "districts"} on the map, or start from the forecast below.</div>`}
        <div class="build-actions"><button type="button" class="btn primary" id="fillFav">Fill the rest with favorites</button><button type="button" class="btn" id="clearPicks" ${keys.length ? "" : "disabled"}>Clear</button><button type="button" class="btn" id="exitBuild">Done</button></div>
      </div>`;
    clearTimeout(buildTimer);
    buildTimer = setTimeout(() => {
      const res = senate ? simulateSenate(picks, 12000) : simulateHouse(picks, 3000);
      const key = senate ? "s" : "h";
      if (baseCache[key] == null) baseCache[key] = senate ? simulateSenate({}, 12000).pD : simulateHouse({}, 3000).pD;
      const lead = res.pD >= 0.5 ? "D" : "R", pl = lead === "D" ? res.pD : 1 - res.pD;
      const certain = und === 0 || pl > 0.9995;
      const el = $("#buildRes"); if (!el) return;
      el.innerHTML = `<span class="${lead === "D" ? "dem" : "rep"}">${lead === "D" ? "Democrats" : "Republicans"} ${certain ? "win" : pct(pl, 0)}</span>`;
      const seatTxt = senate ? `${res.nonR.toFixed(1)} D+I seats on average` : `${res.d.toFixed(0)} D seats on average`;
      $("#buildSub").innerHTML = certain ? `${seatTxt}. Every race is decided.` : `Chance of a ${chamberName} majority in your map · ${seatTxt}. Forecast with no picks: D ${pct(baseCache[key], 0)}.`;
    }, 30);
  }
  function cyclePick(chamberKey, id) {
    const picks = S.pick[chamberKey];
    let order;
    if (chamberKey === "senate") { const r = raceBy(id); if (!r) return; order = [r.altParty, "R"]; }
    else { const d = distBy(id); if (!d || d.sameParty) return; order = ["D", "R"]; }
    const cur = picks[id], i = order.indexOf(cur);
    if (i === -1) picks[id] = order[0]; else if (i === order.length - 1) delete picks[id]; else picks[id] = order[i + 1];
    renderMap();
    if (chamberKey === "senate") syncWhatIf();
  }
  function fillFavorites() {
    if (S.mapMode === "senate") for (const r of S.L.races) { if (S.pick.senate[r.st]) continue; const p = raceP(r); S.pick.senate[r.st] = p.R >= Math.max(p.D, p.I) ? "R" : p.D >= p.I ? "D" : "I"; }
    else for (const d of S.L.districts) { if (S.pick.house[d.id] || d.sameParty) continue; S.pick.house[d.id] = d.p >= 0.5 ? "D" : "R"; }
    renderMap();
    if (S.mapMode === "senate") syncWhatIf();
  }

  function tooltipFor(st, did) {
    if (did) {
      const d = distBy(did);
      if (!d) return "";
      const rt = rating(d.p, 1 - d.p);
      return `<div class="tt-h">${esc(d.id)} · ${esc(STATE_NAMES[d.st])}</div>` + d.c.slice(0, 2).map((c) => `<div class="tt-c">${avatar(c)}<span>${esc(c.name)}${c.inc ? ' <span class="muted">(inc.)</span>' : ""}</span><b style="color:${partyColor(c.party)}">${d.sameParty ? pct(c.pm) : pct(c.party === "D" ? d.p : c.party === "R" ? 1 - d.p : c.pm)}</b></div>`).join("") +
        `<div class="tt-r"><span>${d.sameParty ? `${d.c[0].party} vs ${d.c[0].party}` : rt.label}</span><span>${d.held ? `Now ${d.held}` : ""}</span></div><div class="tt-hint">${S.build ? "Tap to set D / R / forecast" : "Tap for polls and odds"}</div>`;
    }
    const race = raceBy(st);
    let html = `<div class="tt-h">${esc(STATE_NAMES[st])}${race?.special ? " (special)" : ""}</div>`;
    if (!race) return html + '<div class="tt-r">No Senate race this year</div>';
    const p = raceP(race);
    html += race.c.filter((c) => p[c.party] > 0.005).map((c) => `<div class="tt-c">${avatar(c)}<span>${esc(c.name)}${c.inc ? ' <span class="muted">(inc.)</span>' : ""}</span><b style="color:${partyColor(c.party)}">${pct(p[c.party])}</b></div>`).join("");
    return html + `<div class="tt-r"><span>${rating(p.D, p.R, p.I).label}</span><span>${race.nPolls} poll${race.nPolls === 1 ? "" : "s"}</span></div><div class="tt-hint">${S.build ? "Tap to set D / R / forecast" : "Tap for polls and odds"}</div>`;
  }
  function onMapActivate(el) {
    const st = el.dataset.st, did = el.dataset.d;
    if (S.build) { cyclePick(S.mapMode, S.mapMode === "senate" ? st : did); return; }
    openState(st, did);
  }
  function bindMap() {
    const svg = $("#mapSvg"), tip = $("#tooltip");
    svg.addEventListener("pointermove", (e) => {
      const p = e.target.closest(".st:not(.none), .hx");
      if (!p || e.pointerType === "touch") { tip.hidden = true; return; }
      tip.innerHTML = tooltipFor(p.dataset.st, p.dataset.d);
      tip.style.left = clamp(e.clientX, 150, innerWidth - 150) + "px"; tip.style.top = e.clientY + "px"; tip.hidden = false;
    });
    svg.addEventListener("pointerleave", () => (tip.hidden = true));
    svg.addEventListener("click", (e) => { const p = e.target.closest(".st:not(.none), .hx"); if (p) { tip.hidden = true; onMapActivate(p); } });
    svg.addEventListener("keydown", (e) => { const p = e.target.closest(".st:not(.none), .hx"); if (p && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); onMapActivate(p); } });
    $("#smallStates").addEventListener("click", (e) => { const b = e.target.closest("[data-st]"); if (b && !b.disabled) onMapActivate(b); });
    $("#closest").addEventListener("click", (e) => { const b = e.target.closest("[data-st]"); if (b) openState(b.dataset.st, b.dataset.d); });
    $("#buildPanel").addEventListener("click", (e) => {
      const un = e.target.closest("[data-unpick]");
      if (un) { delete S.pick[S.mapMode][un.dataset.unpick]; renderMap(); if (S.mapMode === "senate") syncWhatIf(); return; }
      if (e.target.closest("#fillFav")) fillFavorites();
      if (e.target.closest("#clearPicks")) { S.pick[S.mapMode] = {}; renderMap(); if (S.mapMode === "senate") syncWhatIf(); }
      if (e.target.closest("#exitBuild")) setBuild(false);
    });
    const setMode = (m) => { S.mapMode = m; $("#mapSenate").setAttribute("aria-pressed", m === "senate"); $("#mapHouse").setAttribute("aria-pressed", m === "house"); renderMap(); };
    $("#mapSenate").onclick = () => setMode("senate");
    $("#mapHouse").onclick = () => setMode("house");
    $("#buildBtn").onclick = () => setBuild(!S.build);
  }
  function setBuild(on) {
    S.build = on;
    $("#buildBtn").setAttribute("aria-pressed", on);
    $("#buildBtn span").textContent = on ? "Building · tap to exit" : "Build your map";
    renderMap();
  }

  // ---------- drawer ----------
  function openState(st, focusId) {
    if (!STATE_NAMES[st]) return;
    if (!S.open) S.lastFocus = document.activeElement;
    S.open = st; S.focusD = focusId || null; S.showAllPolls = false;
    renderDrawer(st, focusId);
    $("#drawer").classList.add("open"); $("#scrim").classList.add("open");
    $("#drawer").setAttribute("aria-hidden", "false");
    document.body.style.overflow = "hidden";
    if (!focusId) setTimeout(() => $("#drawerClose").focus({ preventScroll: true }), 50);
    try { history.replaceState(null, "", "#" + st); } catch {}
    $$("#mapSvg .st, #mapSvg .hx").forEach((p) => p.classList.toggle("sel", p.dataset.st === st && (!p.dataset.d || p.dataset.d === focusId)));
    const race = raceBy(st);
    if (race && !STATIC) livePollRace(race);
  }
  function closeDrawer() {
    S.open = null; S.focusD = null;
    $("#drawer").classList.remove("open"); $("#scrim").classList.remove("open");
    $("#drawer").setAttribute("aria-hidden", "true");
    document.body.style.overflow = "";
    $$("#mapSvg .sel").forEach((p) => p.classList.remove("sel"));
    try { history.replaceState(null, "", location.pathname + location.search); } catch {}
    if (S.lastFocus?.focus) S.lastFocus.focus({ preventScroll: true });
  }
  function breakdownRow(label, probs, order, total) {
    if (!probs) return `<div class="brow"><span>${label}</span><span class="muted">No market</span><span class="val">—</span></div>`;
    const lead = order.reduce((a, P) => ((probs[P] || 0) > (probs[a] || 0) ? P : a), order[0]);
    return `<div class="brow${total ? " total" : ""}"><span>${label}</span>${pbar(order.map((P) => [probs[P] || 0, partyColor(P)]))}<span class="val" style="color:${partyColor(lead)}">${lead} ${pct(probs[lead])}</span></div>`;
  }
  // rolling poll average for the race chart (same weighting idea as the server model)
  function pollTrend(polls, keys) {
    if (!polls.length) return { series: keys.map(() => []), first: null };
    const POP = { lv: 1, rv: 0.9, v: 0.9, a: 0.7 };
    const ts = polls.map((p) => ({ t: Date.parse(p.date + "T12:00:00Z") / 1000, p }));
    const t0 = Math.min(...ts.map((x) => x.t)), t1 = Math.max(Date.now() / 1000, ...ts.map((x) => x.t));
    const series = keys.map(() => []);
    for (let t = t0; t <= t1 + 1; t += DAY) {
      const sum = keys.map(() => 0); let sw = 0;
      for (const { t: pt, p } of ts) {
        if (pt > t || pt < t - 120 * DAY) continue;
        const w = Math.pow(0.5, (t - pt) / (21 * DAY)) * Math.sqrt(clamp(p.n || 600, 300, 3000) / 600) * (POP[p.pop] ?? 0.8) * (p.partisan ? 0.5 : 1) * (p.grade != null ? 0.45 + 0.55 * (p.grade / 3) : 0.6);
        if (keys.some((k) => p[k] == null)) continue;
        keys.forEach((k, i) => (sum[i] += w * p[k])); sw += w;
      }
      if (sw) keys.forEach((k, i) => series[i].push([t, +(sum[i] / sw).toFixed(2)]));
    }
    return { series, first: t0 };
  }
  function pollTable(polls, aKey, aLabel, rLabel, limit) {
    const rows = polls.slice(0, limit);
    return `<table class="mini-table poll-table"><thead><tr><th>Date</th><th>Pollster · sponsor · rating</th><th class="r">${esc(aLabel)}</th><th class="r">${esc(rLabel)}</th><th class="r">Net</th></tr></thead><tbody>${rows.map((q) => {
      const a = q[aKey], r = q.R, m = a != null && r != null ? a - r : null;
      return `<tr><td>${shortDate(q.date)}<div style="font-size:10px;color:var(--dim)">${esc((q.pop || "").toUpperCase())}${q.n ? " · " + q.n : ""}</div></td><td class="pt">${q.url ? `<a href="${esc(q.url)}" target="_blank" rel="noopener">${esc(q.pollster)}</a>` : esc(q.pollster)}<br>${pollBadges(q)}</td><td class="r" style="color:${partyColor(aKey)}">${a ?? "—"}</td><td class="r" style="color:${HEX.rep}">${r ?? "—"}</td><td class="r mg" style="color:${m == null ? "inherit" : m >= 0 ? partyColor(aKey) : HEX.rep}">${m == null ? "—" : marginStr(m, aKey)}</td></tr>`;
    }).join("")}</tbody></table>`;
  }
  function pollSummary(polls) {
    const n = polls.length; if (!n) return "";
    const rb = polls.filter((p) => p.partisan === "REP").length, db = polls.filter((p) => p.partisan === "DEM").length;
    const top = polls.filter((p) => p.grade >= 2.5).length, un = polls.filter((p) => p.grade == null).length;
    return `<div class="legend-polls"><span><b style="color:var(--text)">${n}</b> poll${n === 1 ? "" : "s"}</span><span><b style="color:var(--rep-hi)">${rb}</b> R-backed</span><span><b style="color:var(--dem-hi)">${db}</b> D-backed</span><span><b style="color:#6ee7b7">${top}</b> top-rated</span><span><b style="color:var(--text)">${un}</b> unrated</span></div>`;
  }
  function raceCard(r) {
    const p = raceP(r), pm = racePM(r), rt = rating(p.D, p.R, p.I);
    const rep = r.c.find((c) => c.party === "R"), alt = r.c.find((c) => c.party === r.altParty);
    const others = r.c.filter((c) => c !== rep && c !== alt);
    const order = [r.altParty, ...others.map((c) => c.party), "R"].filter((v, i, a) => a.indexOf(v) === i);
    const A = r.altParty;
    const candHTML = (c) => `<div class="cand">${avatar(c, "xl")}<div><div class="cand-name">${esc(c.name)}</div><div class="cand-meta">${PARTY[c.party]}${c.inc ? " · Incumbent" : c.office ? ` · ${esc(c.office)}` : ""}</div></div><div class="cand-pct" style="color:${partyColor(c.party)}">${pct(p[c.party])}</div></div>`;
    const avg = r.avg ? `Weighted poll average: <b>${esc(lastName(alt.name))} ${r.avg.alt}</b> – <b>${esc(lastName(rep.name))} ${r.avg.r}</b> (${marginStr(r.avg.margin, A)}). ` : "No public polls yet, so the polling model leans on the state's partisanship and the national environment. ";
    const hist = S.H?.races?.[r.st];
    const lim = S.showAllPolls ? 999 : 8;
    return `<div class="race-card">
      <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap"><span class="dodds">${rateTag(rt)}</span><span class="cand-meta">${r.special ? "Special election · " : ""}Seat held by ${PARTY[r.held]}s · 2024 pres ${marginStr(r.pres24)}</span></div>
      <div class="matchup">${candHTML(alt)}<div class="vs">VS</div>${candHTML(rep)}</div>
      ${others.length ? `<div class="third">${others.map((c) => `${avatar(c, "sm")} <span>${esc(c.name)} (${c.party}) · ${pct(p[c.party] || 0)}</span>`).join(" ")}</div>` : ""}
      <div class="breakdown">
        ${breakdownRow("Polls model", r.poll, order)}
        ${breakdownRow(S.live.race[r.st] ? "Polymarket ●" : "Polymarket", pm, order)}
        ${breakdownRow("Kalshi", r.k, order)}
        ${breakdownRow("Combined", p, order, true)}
      </div>
      <div class="note">${avg}The polling model puts it at ${marginStr(r.model.margin, A)} ± ${r.model.sd} points.</div>
      ${r.polls.length ? `<div><div class="d-sec-title">Polling history</div><div class="rel" id="racePollChart"></div><div class="chart-legend"><span><i style="background:${partyColor(A)}"></i>${esc(lastName(alt.name))} average</span><span><i style="background:${HEX.rep}"></i>${esc(lastName(rep.name))} average</span><span>Dots are individual polls; hollow = party-backed</span></div></div>` : ""}
      ${hist ? `<div><div class="d-sec-title">Polymarket odds · last ${Math.round((hist.h[hist.h.length - 1][0] - hist.h[0][0]) / DAY)} days</div><div class="rel" id="raceSpark"></div></div>` : ""}
      ${r.polls.length ? `<div><div class="d-sec-title">Every poll</div>${pollSummary(r.polls)}<div class="tbl-wrap" style="margin-top:8px">${pollTable(r.polls, A, lastName(alt.name), lastName(rep.name), lim)}</div>${r.polls.length > 8 ? `<button type="button" class="btn more" id="morePolls">${S.showAllPolls ? "Show fewer" : `Show all ${r.polls.length} polls`}</button>` : ""}</div>` : ""}
      <div class="links"><a href="https://polymarket.com/event/${esc(r.pmSlug)}" target="_blank" rel="noopener">Polymarket market ↗</a>${r.kalshi ? `<a href="https://kalshi.com/markets/${esc(r.kalshi.split("-")[0].toLowerCase())}" target="_blank" rel="noopener">Kalshi market ↗</a>` : ""}</div>
    </div>`;
  }
  function drawRaceCharts(r) {
    const A = r.altParty;
    const el = $("#racePollChart");
    if (el && r.polls.length) {
      const { series } = pollTrend(r.polls, [A, "R"]);
      const pts = r.polls.flatMap((q) => { const t = Date.parse(q.date + "T12:00:00Z") / 1000; return [[t, q[A], `${q.pollster}: ${q[A]}`, partyColor(A), !!q.partisan], [t, q.R, `${q.pollster}: ${q.R}`, HEX.rep, !!q.partisan]].filter((x) => x[1] != null); });
      const vals = pts.map((x) => x[1]);
      const lo = Math.floor((Math.min(...vals) - 2) / 5) * 5, hi = Math.ceil((Math.max(...vals) + 2) / 5) * 5;
      const ticks = []; for (let v = lo; v <= hi; v += 5) ticks.push(v);
      lineChart(el, { series: [{ name: lastName(r.c.find((c) => c.party === A).name), color: partyColor(A), data: series[0], width: 2.4 }, { name: lastName(r.c.find((c) => c.party === "R").name), color: HEX.rep, data: series[1], width: 2.4 }], points: pts, height: 200, yMin: lo, yMax: hi, yTicks: ticks, yFmt: (v) => v.toFixed(v % 1 ? 1 : 0), compact: true, label: "Polling average over time" });
    }
    const h = S.H?.races?.[r.st], sp = $("#raceSpark");
    if (h && sp) lineChart(sp, { series: [{ name: `Polymarket (${h.party})`, color: partyColor(h.party), data: h.h, width: 2 }], height: 120, area: true, yMin: 0, yMax: 1, yTicks: [0, 0.5, 1], compact: true, label: "Polymarket odds over time" });
  }
  function districtCard(d, expanded) {
    const rt = rating(d.p, 1 - d.p), cs = d.c.slice(0, 2);
    return `<div class="dcard${expanded && d.id === S.focusD ? " hl" : ""}" data-id="${d.id}">
      <button type="button" aria-expanded="${expanded}"><span class="did">${d.id.replace("-AL", " AL")}<small>${d.held ? `Now ${d.held}` : "&nbsp;"}${d.polls ? ` · ${d.polls.length} poll${d.polls.length > 1 ? "s" : ""}` : ""}</small></span>
      <span class="dpair"><span class="avs">${cs.map((c) => avatar(c, "sm")).join("")}</span><span class="names">${cs.map((c) => `<div><span style="color:${partyColor(c.party)}">${c.party}</span> ${esc(c.name)}${c.inc ? ' <span class="muted">(inc.)</span>' : ""}</div>`).join("")}</span></span>
      <span class="dodds">${rateTag(rt, d.sameParty ? `${d.c[0].party} vs ${d.c[0].party}` : rt.label)}<div class="pp" style="color:${partyColor(rt.lead)}">${d.sameParty ? "Locked" : `${rt.lead} ${pct(rt.p)}`}</div></span></button>
      ${expanded ? districtDetail(d) : ""}
    </div>`;
  }
  function districtDetail(d) {
    const two = (pD) => (pD == null ? null : { D: pD, R: 1 - pD });
    const label = d.n === 0 ? "At-large district" : `District ${d.n}`;
    const cands = d.c.map((c) => `<div style="display:flex;gap:12px;align-items:center">${avatar(c, "lg")}<div style="min-width:0"><div class="cand-name">${esc(c.name)}</div><div class="cand-meta">${PARTY[c.party] || "Other"}${c.inc ? " · Incumbent" : ""}${c.pm != null ? ` · Polymarket ${pct(c.pm)}` : ""}${c.d1 ? ` <span class="${(c.d1 > 0) === (c.party !== "R") ? "chg-up" : "chg-down"}">${c.d1 > 0 ? "▲" : "▼"}${Math.abs(c.d1 * 100).toFixed(1)} today</span>` : ""}</div></div></div>`).join("");
    const dc = d.c.find((c) => c.party === "D"), rc = d.c.find((c) => c.party === "R");
    const polls = d.polls ? d.polls.map((q) => ({ ...q, D: q.d, R: q.r })) : null;
    return `<div class="ddetail">
      <div style="display:grid;gap:12px;padding-top:12px">${cands}</div>
      ${d.sameParty ? `<div class="note">Both finalists are ${PARTY[d.c[0].party]}s, so this seat stays ${d.c[0].party} either way.</div>` : `<div class="breakdown">
        ${breakdownRow("Polymarket", two(d.pmD), ["D", "R"])}
        ${d.kD != null ? breakdownRow("Kalshi", two(d.kD), ["D", "R"]) : ""}
        ${d.pollD != null ? breakdownRow("Local polls", two(d.pollD), ["D", "R"]) : ""}
        ${breakdownRow("Combined", two(d.p), ["D", "R"], true)}
      </div>
      <div class="note">${label} of ${esc(STATE_NAMES[d.st])}. Market odds${d.pollD != null ? " and local polls" : ""} are blended, then shifted slightly so all 435 districts add up to the national seat estimate.${d.holder ? ` Current member for this district number: ${esc(d.holder)} (${d.held}).` : ""}${d.vol ? ` $${d.vol.toLocaleString()} traded on Polymarket.` : ""}</div>`}
      ${polls ? `<div><div class="d-sec-title">District polls</div>${pollSummary(polls)}<div class="tbl-wrap" style="margin-top:8px">${pollTable(polls, "D", dc ? lastName(dc.name) : "Dem", rc ? lastName(rc.name) : "Rep", 99)}</div></div>` : `<div class="note">No public district polls yet.</div>`}
      <div class="links"><a href="https://polymarket.com/event/${esc(d.slug)}" target="_blank" rel="noopener">Polymarket market ↗</a></div>
    </div>`;
  }
  function renderDrawer(st, focusId) {
    const race = raceBy(st), ds = S.L.districts.filter((d) => d.st === st), eD = ds.reduce((a, d) => a + d.p, 0);
    const rp = race && raceP(race);
    $("#drawerAbbr").textContent = st;
    $("#drawerAbbr").style.color = race ? rating(rp.D, rp.R, rp.I).color : "var(--text)";
    $("#drawerName").textContent = STATE_NAMES[st];
    $("#drawerMeta").textContent = `${race ? (race.special ? "Special Senate election" : "Senate race") : "No Senate race"} · ${ds.length} House seat${ds.length === 1 ? "" : "s"} · ~${eD.toFixed(1)} D / ${(ds.length - eD).toFixed(1)} R`;
    const isComp = (d) => d.p > 0.15 && d.p < 0.85 && !d.sameParty;
    const comp = ds.filter(isComp).length;
    const showAll = ds.length <= 10 || !comp;
    const houseFirst = !!focusId;
    const senateHTML = race ? `<div><div class="d-sec-title">Senate</div>${raceCard(race)}</div>` : '<div class="note">No Senate seat is on the ballot here this year.</div>';
    const houseHTML = `<div><div class="d-sec-title">House · ${ds.length} seat${ds.length === 1 ? "" : "s"}</div>
        ${ds.length > 10 ? `<div class="dfilter"><div class="seg" role="group" aria-label="District filter"><button type="button" data-f="comp" aria-pressed="${!showAll}">Competitive (${comp})</button><button type="button" data-f="all" aria-pressed="${showAll}">All ${ds.length}</button></div></div>` : ""}
        <div class="districts" id="drawerDistricts"></div></div>`;
    $("#drawerBody").innerHTML = houseFirst ? houseHTML + senateHTML : senateHTML + houseHTML;
    const list = $("#drawerDistricts");
    const draw = (all) => { list.innerHTML = ds.filter((d) => all || isComp(d) || d.id === focusId).map((d) => districtCard(d, d.id === focusId)).join("") || '<div class="empty">No competitive districts here.</div>'; };
    draw(showAll);
    $$(".dfilter button", $("#drawerBody")).forEach((b) => (b.onclick = () => { $$(".dfilter button").forEach((x) => x.setAttribute("aria-pressed", x === b)); draw(b.dataset.f === "all"); }));
    list.onclick = (e) => {
      const btn = e.target.closest(".dcard > button");
      if (!btn) return;
      const card = btn.parentElement, d = distBy(card.dataset.id);
      card.outerHTML = districtCard(d, btn.getAttribute("aria-expanded") !== "true");
    };
    $("#drawerBody").onclick = (e) => {
      if (e.target.closest("#morePolls")) { S.showAllPolls = !S.showAllPolls; const card = $(".race-card", $("#drawerBody")); const tmp = document.createElement("div"); tmp.innerHTML = raceCard(race); card.replaceWith(tmp.firstElementChild); drawRaceCharts(race); }
    };
    $("#drawerBody").scrollTop = 0;
    if (race) requestAnimationFrame(() => drawRaceCharts(race));
    if (focusId) requestAnimationFrame(() => { const c = $(`.dcard[data-id="${focusId}"]`); if (c) { c.scrollIntoView({ block: "start", behavior: "auto" }); c.querySelector("button").focus({ preventScroll: true }); } });
  }

  // ---------- hemicycles ----------
  function hemiLayout(total, rows, r0, r1) {
    const radii = Array.from({ length: rows }, (_, i) => r0 + ((r1 - r0) * i) / (rows - 1));
    const sum = radii.reduce((a, b) => a + b, 0);
    const counts = radii.map((r) => Math.round((total * r) / sum));
    counts[rows - 1] += total - counts.reduce((a, b) => a + b, 0);
    const pts = [];
    radii.forEach((r, i) => { for (let j = 0; j < counts[i]; j++) pts.push({ a: Math.PI * (1 - j / (counts[i] - 1)), r }); });
    pts.sort((p, q) => q.a - p.a || p.r - q.r);
    return { pts, dot: Math.min((Math.PI * r1) / counts[rows - 1] / 2, (r1 - r0) / (rows - 1) / 2) * 0.86 };
  }
  function renderHemi(svg, items, rows, r0, r1, center) {
    const { pts, dot } = hemiLayout(items.length, rows, r0, r1);
    const cx = 300, cy = 305;
    svg.innerHTML = items.map((it, i) => { const p = pts[i]; return `<circle cx="${(cx + p.r * Math.cos(p.a)).toFixed(1)}" cy="${(cy - p.r * Math.sin(p.a)).toFixed(1)}" r="${dot.toFixed(2)}" style="fill:${it.color}" ${it.op ? `opacity="${it.op}"` : ""} class="${it.cls || ""}" ${it.st ? `data-st="${it.st}"` : ""} ${it.id ? `data-d="${it.id}"` : ""}><title>${esc(it.title)}</title></circle>`; }).join("") +
      `<line x1="300" x2="300" y1="${cy - r1 - dot - 6}" y2="${cy - r0 + 30}" stroke="rgba(255,255,255,.25)" stroke-dasharray="2 4"/>` + center;
  }
  function renderSenateHemi() {
    const L = S.L, items = [];
    const races = L.races.map((r) => ({ r, p: raceP(r) })).sort((a, b) => a.p.R - b.p.R);
    for (let i = 0; i < L.senate.notUp.D; i++) items.push({ color: HEX.dem, op: 0.38, cls: "notup", title: "Democratic-caucus seat not up in 2026" });
    for (const { r, p } of races) { const rt = rating(p.D, p.R, p.I); items.push({ color: rt.color, st: r.st, title: `${r.name}: ${rt.label} (${rt.lead} ${pct(rt.p)})` }); }
    for (let i = 0; i < L.senate.notUp.R; i++) items.push({ color: HEX.rep, op: 0.38, cls: "notup", title: "Republican seat not up in 2026" });
    const nonR = Math.round(100 - L.senate.expectedR.combined);
    renderHemi($("#senHemi"), items, 5, 155, 285, `<text class="hemi-center hemi-big" x="300" y="268"><tspan fill="${HEX.dem}">${nonR}</tspan><tspan fill="rgba(255,255,255,.3)" dx="8">–</tspan><tspan fill="${HEX.rep}" dx="8">${100 - nonR}</tspan></text><text class="hemi-center hemi-small" x="300" y="296">Projected D+I – R</text>`);
  }
  function renderHouseHemi() {
    const ds = S.L.districts.slice().sort((a, b) => b.p - a.p);
    const items = ds.map((d) => { const rt = rating(d.p, 1 - d.p); return { color: rt.color, st: d.st, id: d.id, title: `${d.id}: ${d.sameParty ? `${d.c[0].party} vs ${d.c[0].party}` : `${rt.label} (${rt.lead} ${pct(rt.p)})`}` }; });
    const e = Math.round(S.L.house.expected.combined);
    renderHemi($("#houseHemi"), items, 12, 150, 290, `<text class="hemi-center hemi-big" x="300" y="268"><tspan fill="${HEX.dem}">${e}</tspan><tspan fill="rgba(255,255,255,.3)" dx="8">–</tspan><tspan fill="${HEX.rep}" dx="8">${435 - e}</tspan></text><text class="hemi-center hemi-small" x="300" y="296">Projected D – R · 218 to win</text>`);
  }

  // ---------- charts ----------
  function lineChart(el, o) {
    if (!el) return;
    const W = Math.max(260, el.clientWidth || 600), H = o.height || 300;
    const m = o.compact ? { l: 34, r: 10, t: 8, b: 20 } : { l: 48, r: 14, t: 14, b: 28 };
    const all = o.series.flatMap((s) => s.data).concat(o.points || []);
    if (!all.length) { el.innerHTML = '<div class="empty">No data yet.</div>'; return; }
    const t0 = o.xMin ?? Math.min(...all.map((d) => d[0])), t1 = o.xMax ?? Math.max(...all.map((d) => d[0]));
    const y0 = o.yMin, y1 = o.yMax;
    const x = (t) => m.l + ((t - t0) / (t1 - t0 || 1)) * (W - m.l - m.r), y = (v) => m.t + (1 - (v - y0) / (y1 - y0)) * (H - m.t - m.b);
    const fmt = o.yFmt || ((v) => pct(v));
    let g = `<g class="grid">${o.yTicks.map((v) => `<line x1="${m.l}" x2="${W - m.r}" y1="${y(v)}" y2="${y(v)}"/>`).join("")}</g><g class="axis">${o.yTicks.map((v) => `<text x="${m.l - 8}" y="${y(v) + 3.5}" text-anchor="end">${fmt(v)}</text>`).join("")}`;
    const d0 = new Date(t0 * 1000), months = [];
    for (let d = new Date(Date.UTC(d0.getUTCFullYear(), d0.getUTCMonth() + 1, 1)); d.getTime() / 1000 <= t1; d.setUTCMonth(d.getUTCMonth() + 1)) months.push(new Date(d));
    const every = Math.max(1, Math.ceil(months.length / Math.max(2, Math.floor((W - m.l - m.r) / 64))));
    g += months.filter((_, i) => i % every === 0).map((d) => `<text x="${x(d.getTime() / 1000)}" y="${H - 6}" text-anchor="middle">${MONTHS[d.getUTCMonth()]}${d.getUTCMonth() === 0 ? " ’" + String(d.getUTCFullYear()).slice(2) : ""}</text>`).join("") + "</g>";
    if (o.bands) g += o.bands.map((b) => `<rect x="${m.l}" width="${W - m.l - m.r}" y="${y(b.to)}" height="${Math.max(0, y(b.from) - y(b.to))}" fill="${b.color}"/>`).join("");
    if (o.threshold != null) g += `<line class="thr" x1="${m.l}" x2="${W - m.r}" y1="${y(o.threshold)}" y2="${y(o.threshold)}"/>`;
    if (o.vline) g += `<line x1="${x(o.vline.t)}" x2="${x(o.vline.t)}" y1="${m.t}" y2="${H - m.b}" stroke="rgba(255,178,36,.6)" stroke-dasharray="2 3"/><text x="${x(o.vline.t) - 4}" y="${m.t + 10}" text-anchor="end" style="font:600 10.5px var(--f-mono);fill:#ffb224">${o.vline.label}</text>`;
    if (o.points) g += o.points.map((p) => { const col = p[3] || (p[1] >= 0 ? HEX.dem : HEX.rep); const hollow = p[4]; return `<circle cx="${x(p[0]).toFixed(1)}" cy="${y(clamp(p[1], y0, y1)).toFixed(1)}" r="${hollow ? 2.8 : 2.6}" ${hollow ? `fill="none" stroke="${col}" stroke-width="1.2"` : `fill="${col}"`} opacity=".5"><title>${esc(p[2] || "")}</title></circle>`; }).join("");
    for (const s of o.series) {
      if (!s.data.length) continue;
      const d = s.data.map(([t, v], i) => `${i ? "L" : "M"}${x(t).toFixed(1)},${y(clamp(v, y0, y1)).toFixed(1)}`).join("");
      if (o.area) g += `<path d="${d}L${x(s.data[s.data.length - 1][0])},${H - m.b}L${x(s.data[0][0])},${H - m.b}Z" fill="${s.color}" opacity=".12"/>`;
      g += `<path d="${d}" fill="none" stroke="${s.color}" stroke-width="${s.width || 1.6}" ${s.dash ? `stroke-dasharray="${s.dash}"` : ""} stroke-linejoin="round" stroke-linecap="round" opacity="${s.opacity || 1}"/>`;
      const last = s.data[s.data.length - 1];
      g += `<circle cx="${x(last[0])}" cy="${y(clamp(last[1], y0, y1))}" r="${(s.width || 1.6) + 1.4}" fill="${s.color}"/>`;
    }
    el.innerHTML = `<svg class="chart" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="${esc(o.label || "Chart")}">${g}<line class="hov" x1="0" x2="0" y1="${m.t}" y2="${H - m.b}" stroke="rgba(255,255,255,.4)" visibility="hidden"/><rect x="${m.l}" y="${m.t}" width="${W - m.l - m.r}" height="${H - m.t - m.b}" fill="transparent"/></svg><div class="chart-tip" hidden></div>`;
    const svg = el.querySelector("svg"), hov = svg.querySelector(".hov"), tip = el.querySelector(".chart-tip");
    const base = o.series.find((s) => s.data.length)?.data || [];
    if (!base.length) return;
    svg.addEventListener("pointermove", (e) => {
      const r = svg.getBoundingClientRect();
      const px = ((e.clientX - r.left) / r.width) * W;
      const t = t0 + ((px - m.l) / (W - m.l - m.r)) * (t1 - t0);
      if (t < t0 || t > t1 + DAY) { hov.setAttribute("visibility", "hidden"); tip.hidden = true; return; }
      let best = base[0];
      for (const d of base) if (Math.abs(d[0] - t) < Math.abs(best[0] - t)) best = d;
      const xx = x(best[0]);
      hov.setAttribute("x1", xx); hov.setAttribute("x2", xx); hov.setAttribute("visibility", "visible");
      const rows = o.series.map((s) => { let v = null; for (const d of s.data) { if (d[0] <= best[0] + DAY / 2) v = d[1]; else break; } return v == null ? "" : `<div><span style="color:${s.color}">●</span> ${esc(s.name)} <b>${fmt(v)}</b></div>`; }).join("");
      tip.innerHTML = `<div style="margin-bottom:3px">${fmtDate(best[0])}</div>${rows}`;
      tip.style.left = clamp((xx / W) * r.width, 80, r.width - 80) + "px"; tip.style.top = m.t + 6 + "px"; tip.hidden = false;
    });
    svg.addEventListener("pointerleave", () => { hov.setAttribute("visibility", "hidden"); tip.hidden = true; });
  }
  function histogram(el, o) {
    const W = Math.max(260, el.clientWidth || 500), H = o.height || 230;
    const m = { l: 10, r: 10, t: 22, b: 28 };
    const { lo, values } = o;
    let a = 0, b = values.length - 1, cum = 0;
    while (a < b && (cum += values[a]) < 0.002) a++;
    cum = 0;
    while (b > a && (cum += values[b]) < 0.002) b--;
    a = Math.max(0, a - 2); b = Math.min(values.length - 1, b + 2);
    const vs = values.slice(a, b + 1), x0 = lo + a, n = vs.length, bw = (W - m.l - m.r) / n;
    const vmax = Math.max(...vs, ...(o.overlays || []).flatMap((ov) => ov.values.slice(a, b + 1))) || 1;
    const y = (v) => H - m.b - (v / vmax) * (H - m.t - m.b);
    let g = vs.map((v, i) => { const seat = x0 + i; return `<rect x="${(m.l + i * bw + 0.5).toFixed(1)}" y="${y(v).toFixed(1)}" width="${Math.max(1, bw - 1).toFixed(1)}" height="${(H - m.b - y(v)).toFixed(1)}" fill="${o.color(seat)}" rx="${bw > 6 ? 1.5 : 0}"><title>${seat} ${o.unit}: ${pct(v, 1)}</title></rect>`; }).join("");
    for (const ov of o.overlays || []) g += `<path d="${ov.values.slice(a, b + 1).map((v, i) => `${i ? "L" : "M"}${(m.l + (i + 0.5) * bw).toFixed(1)},${y(v).toFixed(1)}`).join("")}" fill="none" stroke="${ov.color}" stroke-width="1.6" ${ov.dash ? `stroke-dasharray="${ov.dash}"` : ""}/>`;
    const tx = m.l + (o.threshold - x0) * bw;
    g += `<line class="thr" x1="${tx}" x2="${tx}" y1="${m.t - 10}" y2="${H - m.b}"/><text class="thr-l" x="${tx + 5}" y="${m.t - 2}">${o.thresholdLabel}</text>`;
    const step = Math.max(1, Math.ceil(n / Math.floor((W - m.l - m.r) / 40)));
    g += `<g class="axis">${vs.map((_, i) => ((x0 + i) % step === 0 ? `<text x="${(m.l + (i + 0.5) * bw).toFixed(1)}" y="${H - 9}" text-anchor="middle">${x0 + i}</text>` : "")).join("")}</g>`;
    el.innerHTML = `<svg class="chart" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="${esc(o.label)}">${g}</svg>` + (o.legend ? `<div class="chart-legend">${o.legend}</div>` : "");
  }

  // ---------- Senate section ----------
  function renderSenate() {
    const L = S.L;
    renderSenateHemi();
    const comb = L.senate.seats.combined, lo = L.senate.seats.lo;
    const rev = (arr) => arr && arr.slice().reverse();
    histogram($("#senHist"), {
      lo: 100 - (lo + comb.length - 1), values: rev(comb), unit: "D+I seats", threshold: 50.5, thresholdLabel: "51 = D majority", label: "Distribution of Democratic plus independent Senate seats",
      color: (s) => (s >= 51 ? HEX.dem : HEX.rep),
      overlays: L.senate.seats.polymarket ? [{ values: rev(L.senate.seats.polymarket), color: SRC_COLORS.polymarket, dash: "4 3" }] : [],
      legend: `<span><i style="background:${HEX.dem}"></i>Combined simulation</span>${L.senate.seats.polymarket ? `<span><i style="background:${SRC_COLORS.polymarket}"></i>Polymarket seat-count market</span>` : ""}`,
    });
    $("#senSeatNote").textContent = "Democrats + independents";
    const ord = L.races.map((r) => ({ r, p: raceP(r) })).sort((a, b) => a.p.R - b.p.R);
    const need = 51 - L.senate.notUp.D;
    $("#path51").innerHTML = ord.map(({ r, p }) => { const rt = rating(p.D, p.R, p.I); return `<button type="button" data-st="${r.st}" class="${rt.darkText ? "" : "light"}" style="background:${rt.color}" title="${esc(r.name)}: ${rt.label} (${rt.lead} ${pct(rt.p)})">${r.st}</button>`; }).join("") + `<div class="tip-mark" style="left:${((need - 0.5) / 35) * 100}%">51st seat · ${ord[need - 1].r.st}</div>`;
    renderRaceTable();
  }
  function renderRaceTable() {
    const rows = S.L.races.map((r) => ({ r, p: raceP(r) })).sort((a, b) => Math.abs(a.p.R - 0.5) - Math.abs(b.p.R - 0.5));
    const col = (v, P) => (v == null ? '<span class="muted">—</span>' : `<span style="color:${partyColor(P)}">${pct(v)}</span>`);
    $("#raceTable").innerHTML = `<thead><tr><th>State</th><th>Matchup</th><th class="r">Poll avg</th><th class="r">Polls model</th><th class="r">Polymarket</th><th class="r">Kalshi</th><th>Combined</th><th>What if</th></tr></thead><tbody>` + rows.map(({ r, p }) => {
      const alt = r.c.find((c) => c.party === r.altParty), rep = r.c.find((c) => c.party === "R");
      const rt = rating(p.D, p.R, p.I), A = r.altParty, pm = racePM(r), f = S.pick.senate[r.st] || "";
      return `<tr class="row" data-st="${r.st}"><td><div class="stc" style="color:${rt.color}">${r.st}<small>${esc(r.name)}${r.special ? " (S)" : ""}</small></div></td>
        <td><div class="pair"><span class="dpair"><span class="avs">${avatar(alt, "sm")}${avatar(rep, "sm")}</span></span><span class="names"><div><span style="color:${partyColor(A)}">${A}</span> ${esc(alt.name)}${alt.inc ? ' <span class="muted">(inc.)</span>' : ""}</div><div><span style="color:${HEX.rep}">R</span> ${esc(rep.name)}${rep.inc ? ' <span class="muted">(inc.)</span>' : ""}</div></span></div></td>
        <td class="r mono">${r.avg ? marginStr(r.avg.margin, A) : "—"}<div style="font-size:10.5px;color:var(--dim)">${r.nPolls} poll${r.nPolls === 1 ? "" : "s"}</div></td>
        <td class="r mono">${col(r.poll[A], A)}</td><td class="r mono">${col(pm?.[A], A)}</td><td class="r mono">${col(r.k?.[A], A)}</td>
        <td class="combo"><div class="lab"><span style="color:${partyColor(A)}">${pct(p[A])}</span><span style="color:${HEX.rep}">${pct(p.R)}</span></div>${pbar([[p[A], partyColor(A)], [Math.max(0, 1 - p[A] - p.R), HEX.toss], [p.R, HEX.rep]])}</td>
        <td><span class="whatif" role="group" aria-label="Scenario for ${esc(r.name)}"><button type="button" class="w${A}" data-w="${A}" aria-pressed="${f === A}">${A}</button><button type="button" class="w0" data-w="" aria-pressed="${!f}">–</button><button type="button" class="wR" data-w="R" aria-pressed="${f === "R"}">R</button></span></td></tr>`;
    }).join("") + "</tbody>";
    updateScenario();
  }
  function syncWhatIf() {
    $$("#raceTable tr.row").forEach((tr) => { const f = S.pick.senate[tr.dataset.st] || ""; $$("[data-w]", tr).forEach((b) => b.setAttribute("aria-pressed", b.dataset.w === f)); });
    updateScenario();
  }
  function updateScenario() {
    const keys = Object.keys(S.pick.senate), box = $("#scenario");
    if (!keys.length) { box.hidden = true; return; }
    const res = simulateSenate(S.pick.senate, 12000);
    const lead = res.pD >= 0.5 ? "D" : "R";
    $("#scenarioVal").innerHTML = `<span class="${lead === "D" ? "dem" : "rep"}">${lead === "D" ? "Democrats" : "Republicans"} ${pct(lead === "D" ? res.pD : 1 - res.pD, 1)}</span> <span class="muted" style="font-size:14px;font-family:var(--f-mono)">· ${res.nonR.toFixed(1)} D+I seats · ${keys.length} race${keys.length > 1 ? "s" : ""} set</span>`;
    box.hidden = false;
  }
  function bindSenate() {
    $("#senHemi").addEventListener("click", (e) => { const c = e.target.closest("circle[data-st]"); if (c) openState(c.dataset.st); });
    $("#houseHemi").addEventListener("click", (e) => { const c = e.target.closest("circle[data-st]"); if (c) openState(c.dataset.st, c.dataset.d); });
    $("#path51").addEventListener("click", (e) => { const b = e.target.closest("[data-st]"); if (b) openState(b.dataset.st); });
    $("#raceTable").addEventListener("click", (e) => {
      const w = e.target.closest("[data-w]");
      if (w) {
        const st = w.closest("tr").dataset.st;
        if (w.dataset.w) S.pick.senate[st] = w.dataset.w; else delete S.pick.senate[st];
        syncWhatIf();
        if (S.build && S.mapMode === "senate") renderMap();
        return;
      }
      const tr = e.target.closest("tr.row");
      if (tr) openState(tr.dataset.st);
    });
    $("#scenarioReset").onclick = () => { S.pick.senate = {}; syncWhatIf(); if (S.build) renderMap(); };
  }

  // ---------- House section ----------
  function renderHouse() {
    const L = S.L, s = L.house.seats;
    renderHouseHemi();
    histogram($("#houseHist"), {
      lo: s.lo, values: s.combined, unit: "D seats", threshold: 217.5, thresholdLabel: "218 = majority", label: "Distribution of Democratic House seats",
      color: (seat) => (seat >= 218 ? HEX.dem : HEX.rep),
      overlays: [{ values: s.polls, color: SRC_COLORS.polls, dash: "4 3" }, ...(s.market ? [{ values: s.market, color: SRC_COLORS.polymarket }] : [])],
      legend: `<span><i style="background:${HEX.dem}"></i>Combined</span><span><i style="background:${SRC_COLORS.polls}"></i>Polls model</span>${s.market ? `<span><i style="background:${SRC_COLORS.polymarket}"></i>Seat-count markets</span>` : ""}`,
    });
    const g = S.H.generic, pts = S.H.genericPolls;
    const vals = pts.map((p) => p[1]).concat(g.map((x) => x[1]));
    const yMin = Math.min(-4, Math.floor(Math.min(...vals) / 2) * 2), yMax = Math.max(12, Math.ceil(Math.max(...vals) / 2) * 2);
    const ticks = []; for (let v = Math.ceil(yMin / 4) * 4; v <= yMax; v += 4) ticks.push(v);
    $("#gbNow").innerHTML = `<b class="${L.generic.margin >= 0 ? "dem" : "rep"}">${marginStr(L.generic.margin)}</b> <span class="muted" style="letter-spacing:0;text-transform:none">D ${L.generic.dem} · R ${L.generic.rep}</span>`;
    lineChart($("#gbChart"), {
      series: [{ name: "Average", color: "#ffffff", data: g.map((x) => [x[0], x[1]]), width: 2.2 }],
      points: pts.map((p) => [p[0], p[1], `${p[2]}${p[4] ? ` (${p[4] === "REP" ? "R" : "D"}-backed)` : ""}${p[3] != null ? ` · 538 ${p[3]}/3` : ""}: ${marginStr(p[1])}`, null, !!p[4]]),
      height: 280, yMin, yMax, yTicks: ticks, yFmt: (v) => (v === 0 ? "Tie" : (v > 0 ? "D+" : "R+") + Math.abs(v).toFixed(v % 1 ? 1 : 0)), threshold: 0,
      bands: [{ from: 0, to: yMax, color: "rgba(74,123,255,.05)" }, { from: yMin, to: 0, color: "rgba(255,77,94,.05)" }], label: "Generic congressional ballot average",
    });
    const bg = L.districts.filter((d) => !d.sameParty).sort((a, b) => Math.abs(a.p - 0.5) - Math.abs(b.p - 0.5)).slice(0, 12);
    $("#battle").innerHTML = bg.map((d) => districtCard(d, false)).join("");
  }
  function bindHouse() {
    $("#battle").addEventListener("click", (e) => { const c = e.target.closest(".dcard"); if (c) { const d = distBy(c.dataset.id); openState(d.st, d.id); } });
  }

  // ---------- trend ----------
  function renderTrend() {
    const k = S.trend, h = S.H[k];
    const t1 = Math.floor(Date.parse("2026-11-03T12:00:00Z") / 1000);
    const series = [
      { name: "Combined", color: SRC_COLORS.combined, data: h.combined, width: 3 },
      { name: "Polls model", color: SRC_COLORS.polls, data: h.polls, width: 1.6, dash: "5 4" },
      { name: "Polymarket", color: SRC_COLORS.polymarket, data: h.polymarket, width: 1.3, opacity: 0.85 },
      { name: "Kalshi", color: SRC_COLORS.kalshi, data: h.kalshi, width: 1.3, opacity: 0.85 },
    ];
    const first = Math.min(...series.filter((s) => s.data.length).map((s) => s.data[0][0]));
    const start = Math.max(first, (k === "senate" ? Date.parse("2026-01-15") : Date.parse("2025-09-01")) / 1000);
    series.forEach((s) => (s.data = s.data.filter((x) => x[0] >= start)));
    lineChart($("#trendChart"), { series, height: 340, yMin: 0, yMax: 1, yTicks: [0, 0.25, 0.5, 0.75, 1], yFmt: (v) => `D ${Math.round(v * 100)}%`, threshold: 0.5, xMin: start, xMax: t1, vline: { t: t1, label: "Election Day" }, label: `${k} control probability over time` });
    $("#trendLegend").innerHTML = series.map((s) => `<span><i style="background:${s.color}"></i>${s.name}</span>`).join("") + `<span class="muted">Chance Democrats win the ${k === "house" ? "House" : "Senate"}</span>`;
  }
  function bindTrend() {
    const set = (k) => { S.trend = k; $("#trendHouse").setAttribute("aria-pressed", k === "house"); $("#trendSenate").setAttribute("aria-pressed", k === "senate"); renderTrend(); };
    $("#trendHouse").onclick = () => set("house");
    $("#trendSenate").onclick = () => set("senate");
  }

  // ---------- poll feed ----------
  function renderFeed() {
    const L = S.L, counts = { all: L.feed.length, generic: 0, senate: 0, house: 0 };
    L.feed.forEach((f) => counts[f.type]++);
    $("#feedFilters").innerHTML = [["all", "All"], ["senate", "Senate"], ["generic", "Generic ballot"], ["house", "House"]].map(([k, l]) => `<button type="button" class="chip" data-f="${k}" aria-pressed="${S.feed === k}">${l} · ${counts[k]}</button>`).join("");
    const items = L.feed.filter((f) => S.feed === "all" || f.type === S.feed).slice(0, 36);
    $("#feed").innerHTML = items.map((f) => {
      const n = feedNames(f), tot = (n.aV || 0) + (n.rV || 0) || 1, lead = (n.aV || 0) >= (n.rV || 0) ? n.aP : "R";
      const target = f.type === "senate" ? `data-st="${f.st}"` : f.type === "house" ? `data-st="${f.id.split("-")[0]}" data-d="${f.id}"` : "";
      return `<div class="fitem" ${target} ${target ? 'role="button" tabindex="0" style="cursor:pointer"' : ""}>
        <div class="top"><span class="tag ${f.type === "generic" ? "" : "poll"}">${f.type === "generic" ? "Generic" : f.type === "senate" ? "Senate" : "House"}</span><span>${shortDate(f.date)}</span></div>
        <div class="race">${feedTitle(f)}</div>
        <div class="res"><span style="color:${partyColor(n.aP)}">${esc(n.a)} ${n.aV ?? "—"}</span>${pbar([[(n.aV || 0) / tot, partyColor(n.aP)], [(n.rV || 0) / tot, HEX.rep]])}<span style="color:${HEX.rep}">${n.rV ?? "—"} ${esc(n.r)}</span></div>
        <div class="by">${f.url ? `<a href="${esc(f.url)}" target="_blank" rel="noopener">${esc(f.pollster)}</a>` : esc(f.pollster)} · ${esc((f.pop || "").toUpperCase())}${f.n ? ` · n=${f.n}` : ""} · <span style="color:${partyColor(lead)}">${lead}+${Math.abs((n.aV || 0) - (n.rV || 0)).toFixed(0)}</span></div>
        ${pollBadges(f)}
      </div>`;
    }).join("") || '<div class="empty">No polls in this window.</div>';
  }
  function bindFeed() {
    $("#feedFilters").addEventListener("click", (e) => { const b = e.target.closest("[data-f]"); if (b) { S.feed = b.dataset.f; renderFeed(); } });
    const go = (e) => { if (e.target.closest("a")) return; const it = e.target.closest(".fitem[data-st]"); if (it && (e.type === "click" || e.key === "Enter")) openState(it.dataset.st, it.dataset.d); };
    $("#feed").addEventListener("click", go);
    $("#feed").addEventListener("keydown", go);
  }
  function renderMethod() {
    const W = S.L.weights;
    const rn = $("#refreshNote");
    if (rn) rn.textContent = STATIC ? `This copy is a snapshot taken ${new Date(S.L.updated).toLocaleString([], { dateStyle: "medium", timeStyle: "short" })}. It's republished with fresh polls and prices on each refresh.` : "Polls and Kalshi refresh on the server every 30 minutes; Polymarket prices refresh in your browser every minute.";
    $("#weights").innerHTML = `<div style="flex:${W.polls};background:${SRC_COLORS.polls}">Polls ${Math.round(W.polls * 100)}%</div><div style="flex:${W.polymarket};background:${SRC_COLORS.polymarket}">Polymarket ${Math.round(W.polymarket * 100)}%</div><div style="flex:${W.kalshi};background:${SRC_COLORS.kalshi}">Kalshi ${Math.round(W.kalshi * 100)}%</div>`;
  }
  async function renderCredits() {
    const el = $("#credits");
    if (el.dataset.done) return;
    el.dataset.done = 1;
    try {
      const ph = await (await fetch("data/photos.json")).json();
      el.innerHTML = Object.values(ph).sort((a, b) => a.title.localeCompare(b.title)).map((p) => `<a href="${esc(p.file && !/^[A-Z]\d{6}\.jpg$/.test(p.file) ? "https://commons.wikimedia.org/wiki/File:" + encodeURIComponent(p.file) : p.wiki)}" target="_blank" rel="noopener">${esc(p.title)}</a>`).join("");
    } catch { el.textContent = "Credits could not be loaded."; }
  }

  function renderAll() {
    renderHeader();
    renderBoard("house"); renderBoard("senate");
    renderOutcomes(); renderTicker(); renderMap(); renderSenate(); renderHouse(); renderTrend(); renderFeed(); renderPollsters(); renderExplainer(); renderMethod();
    const h = chamber("house").pD, s = chamber("senate").pD;
    $("#heroSub").innerHTML = `Right now the combined forecast gives <b>${h >= 0.5 ? "Democrats" : "Republicans"} a ${pct(Math.max(h, 1 - h))} chance</b> of winning the House and <b>${s >= 0.5 ? "Democrats" : "Republicans"} a ${pct(Math.max(s, 1 - s))} chance</b> in the Senate, built from every public poll and every dollar traded on Polymarket and Kalshi. Click anything to see where it comes from.`;
  }

  // ---------- live Polymarket ----------
  function pmPrice(m) {
    const bid = +m.bestBid, ask = +m.bestAsk;
    if (bid > 0 && ask > 0 && ask - bid <= 0.1) return (bid + ask) / 2;
    try { return +JSON.parse(m.outcomePrices)[0]; } catch { return +m.lastTradePrice || null; }
  }
  async function pmEvent(slug) {
    const r = await fetch(`https://gamma-api.polymarket.com/events?slug=${encodeURIComponent(slug)}`, { cache: "no-store" });
    if (!r.ok) throw new Error(r.status);
    return (await r.json())[0];
  }
  function pmTwoWay(e) {
    const ms = (e?.markets || []).filter((m) => m.active && !m.closed);
    const d = ms.find((m) => /democrat/i.test(m.groupItemTitle)), r = ms.find((m) => /republican/i.test(m.groupItemTitle));
    if (!d || !r) return null;
    const pd = pmPrice(d), pr = pmPrice(r);
    return pd != null && pr != null ? pd / (pd + pr) : null;
  }
  async function livePollChambers() {
    try {
      const [h, s] = await Promise.all([pmEvent(S.L.live.house), pmEvent(S.L.live.senate)]);
      const ph = pmTwoWay(h), ps = pmTwoWay(s);
      const changed = (ph != null && Math.abs(ph - (S.live.house ?? S.L.house.sources.polymarket)) > 0.0004) || (ps != null && Math.abs(ps - (S.live.senate ?? S.L.senate.sources.polymarket)) > 0.0004);
      if (ph != null) S.live.house = ph;
      if (ps != null) S.live.senate = ps;
      S.live.at = Date.now();
      renderBoard("house"); renderBoard("senate"); renderExplainer();
      if (changed) $$(".big").forEach((b) => { b.classList.remove("flash"); void b.offsetWidth; b.classList.add("flash"); });
    } catch { /* keep the snapshot */ }
    updateLivePill();
  }
  async function livePollRace(race) {
    try {
      const e = await pmEvent(race.pmSlug);
      const ms = (e?.markets || []).filter((m) => m.active && !m.closed);
      const o = { D: 0, R: 0, I: 0 };
      let tot = 0;
      for (const c of race.c) { const m = ms.find((x) => (x.groupItemTitle || "").trim() === c.pmLabel); const p = m ? pmPrice(m) : null; if (p != null) { o[c.party] += p; tot += p; } }
      if (!tot) return;
      for (const k in o) o[k] /= tot;
      S.live.race[race.st] = o;
      S.live.at = Date.now();
      updateLivePill();
      if (S.open === race.st) {
        const card = $(".race-card", $("#drawerBody"));
        if (card) { const tmp = document.createElement("div"); tmp.innerHTML = raceCard(race); card.replaceWith(tmp.firstElementChild); drawRaceCharts(race); }
      }
    } catch {}
  }
  async function refreshSnapshot() {
    try {
      const L = await (await fetch(`data/latest.json?t=${Date.now()}`, { cache: "no-store" })).json();
      if (L.updated === S.L.updated) return;
      const H = await (await fetch(`data/history.json?t=${Date.now()}`, { cache: "no-store" })).json();
      S.L = L; S.H = H; S.live.race = {}; baseCache = {}; S.PI = Object.fromEntries((L.pollsters || []).map((p) => [p.name, p]));
      arrangeHexes();
      renderAll();
      if (S.open) renderDrawer(S.open, S.focusD);
    } catch {}
  }

  // Hex positions inside a state are not geographic, so put the most Democratic seats at the centre of each state's
  // cluster and the most Republican at the edge. The state's split reads at a glance instead of as noise.
  function arrangeHexes() {
    const X = S.X;
    for (const lab of X.labels) {
      const hs = X.hexes.filter((h) => h.st === lab.st);
      const ds = S.L.districts.filter((d) => d.st === lab.st).sort((a, b) => b.p - a.p);
      hs.sort((a, b) => Math.hypot(a.x - lab.x, a.y - lab.y) - Math.hypot(b.x - lab.x, b.y - lab.y));
      hs.forEach((h, i) => { if (ds[i]) h.id = ds[i].id; });
    }
  }

  // ---------- boot ----------
  async function boot() {
    try {
      const v = Date.now();
      const get = (u) => fetch(u, { cache: "no-store" }).then((r) => { if (!r.ok) throw new Error(u); return r.json(); });
      const [L, H, G, X] = await Promise.all([get(`data/latest.json?t=${v}`), get(`data/history.json?t=${v}`), get("data/states.json"), get("data/hexmap.json")]);
      X.hexes.forEach((h) => (h.pts = hexPoints(h.x, h.y, X.R * 0.95)));
      Object.assign(S, { L, H, G, X, PI: Object.fromEntries((L.pollsters || []).map((p) => [p.name, p])) });
      arrangeHexes();
    } catch (e) {
      $("#heroSub").textContent = "The forecast data didn't load. Check your connection and refresh the page.";
      return;
    }
    renderAll();
    bindMap(); bindSenate(); bindHouse(); bindTrend(); bindFeed(); bindPollsters();
    $("#drawerClose").onclick = closeDrawer;
    $("#scrim").onclick = closeDrawer;
    document.addEventListener("keydown", (e) => { if (e.key === "Escape" && S.open) closeDrawer(); });
    $("footer details").addEventListener("toggle", (e) => { if (e.target.open) renderCredits(); });
    let rt, lastW = innerWidth;
    addEventListener("resize", () => { if (Math.abs(innerWidth - lastW) < 20) return; lastW = innerWidth; clearTimeout(rt); rt = setTimeout(() => { renderSenate(); renderHouse(); renderTrend(); if (S.open) { const r = raceBy(S.open); if (r) drawRaceCharts(r); } }, 180); });
    const hash = location.hash.slice(1).toUpperCase();
    if (STATE_NAMES[hash]) setTimeout(() => openState(hash), 300);
    if (!STATIC) {
      livePollChambers();
      setInterval(livePollChambers, 60e3);
      setInterval(() => { if (S.open) { const r = raceBy(S.open); if (r) livePollRace(r); } }, 60e3);
    }
    setInterval(refreshSnapshot, 5 * 60e3);
    setInterval(updateLivePill, 15e3);
  }
  boot();
})();
