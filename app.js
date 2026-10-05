"use strict";
(() => {
  // ---------- helpers ----------
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
  const STATIC = !!window.CR_STATIC; // snapshot copy where live market calls are blocked
  const DAY = 86400;
  const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const STATE_NAMES = { AL: "Alabama", AK: "Alaska", AZ: "Arizona", AR: "Arkansas", CA: "California", CO: "Colorado", CT: "Connecticut", DE: "Delaware", FL: "Florida", GA: "Georgia", HI: "Hawaii", ID: "Idaho", IL: "Illinois", IN: "Indiana", IA: "Iowa", KS: "Kansas", KY: "Kentucky", LA: "Louisiana", ME: "Maine", MD: "Maryland", MA: "Massachusetts", MI: "Michigan", MN: "Minnesota", MS: "Mississippi", MO: "Missouri", MT: "Montana", NE: "Nebraska", NV: "Nevada", NH: "New Hampshire", NJ: "New Jersey", NM: "New Mexico", NY: "New York", NC: "North Carolina", ND: "North Dakota", OH: "Ohio", OK: "Oklahoma", OR: "Oregon", PA: "Pennsylvania", RI: "Rhode Island", SC: "South Carolina", SD: "South Dakota", TN: "Tennessee", TX: "Texas", UT: "Utah", VT: "Vermont", VA: "Virginia", WA: "Washington", WV: "West Virginia", WI: "Wisconsin", WY: "Wyoming" };
  const PARTY = { D: "Democrat", R: "Republican", I: "Independent", O: "Other" };
  const PARTIES = { D: "Democrats", R: "Republicans", I: "Independents" };
  const SMALL = ["VT", "NH", "MA", "RI", "CT", "NJ", "DE", "MD"];
  const LABEL_NUDGE = { FL: [14, 6], LA: [-10, 0], MI: [12, 22], KY: [4, 2], CA: [-8, 0], ID: [0, 14], WV: [-3, 3], VA: [8, 2], TX: [8, 0], MN: [-6, 8], NY: [6, 0], OK: [10, 0], NC: [6, 0], SC: [4, 0] };

  const pct = (p) => (p == null || Number.isNaN(p) ? "—" : p > 0.995 ? "over 99%" : p < 0.005 ? "under 1%" : Math.round(p * 100) + "%");
  const aChance = (p) => (p > 0.995 ? "a better than 99% chance" : p < 0.005 ? "less than a 1% chance" : `a ${Math.round(p * 100)}% chance`);
  const pctShort = (p) => (p == null ? "—" : p > 0.995 ? ">99%" : p < 0.005 ? "<1%" : Math.round(p * 100) + "%");
  const color = (P, shade = 1) => `var(--${P === "D" ? "d" : P === "R" ? "r" : "i"}${shade})`;
  const words = (n) => n.replace(/["“”][^"“”]*["“”]/g, " ").split(/\s+/).filter((w) => w && !/^(jr|sr|ii|iii)\.?,?$/i.test(w));
  const lastName = (n) => { const w = words(n); return w[w.length - 1] || n; };
  const initials = (n) => { const w = words(n); return ((w[0]?.[0] || "") + (w.length > 1 ? w[w.length - 1][0] : "")).toUpperCase(); };
  const fmtDay = (s) => { const d = new Date(s + "T12:00:00Z"); return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`; };
  const fmtWhen = (iso) => new Date(iso).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  function inTen(p) { // plain-English odds
    if (p >= 0.995) return "a near-certain bet";
    if (p >= 0.45 && p <= 0.55) return "about a coin flip";
    const n = Math.round(p * 10);
    return n >= 10 ? "about 19 in 20" : `about ${n} in 10`;
  }

  // forecast categories, in words
  function rating(pD, pR, pI = 0) {
    const lead = pD >= pR && pD >= pI ? "D" : pR >= pI ? "R" : "I";
    const p = Math.max(pD, pR, pI);
    const tier = p >= 0.95 ? 1 : p >= 0.8 ? 2 : p >= 0.6 ? 3 : 0;
    const label = tier === 0 ? "Too close to call" : `${["", "Very likely", "Likely", "Leaning"][tier]} ${PARTY[lead]}`;
    const fill = tier === 0 ? "var(--toss)" : color(lead, tier);
    return { lead, p, tier, label, fill, light: tier === 0 || tier === 3 };
  }
  const chip = (rt) => `<span class="status" style="background:${rt.fill};color:${rt.light ? "var(--ink)" : "#fff"}">${rt.label}</span>`;

  function photo(c, size = "") {
    const cls = `photo ${size} ${c.party || "O"}`;
    if (c.img) return `<span class="${cls}"><img src="${esc(c.img)}" alt="Photo of ${esc(c.name)}" loading="lazy" onerror="this.parentNode.textContent='${esc(initials(c.name))}'"></span>`;
    return `<span class="${cls}" aria-hidden="true">${c.generic ? c.party : esc(initials(c.name))}</span>`;
  }
  const split = (pL, colL, pR, colR) => `<div class="split"><i style="width:${pL * 100}%;background:${colL}"></i><i style="width:${Math.max(0, 1 - pL - pR) * 100}%;background:var(--toss)"></i><i style="width:${pR * 100}%;background:${colR}"></i></div>`;

  // ---------- state ----------
  const S = { L: null, H: null, G: null, mode: "senate", build: false, pick: { senate: {}, house: {} }, live: { house: null, senate: null, race: {} }, open: null, focusD: null, allPolls: false, allDistricts: false, lastFocus: null, allPollsters: false };
  const raceBy = (st) => S.L.races.find((r) => r.st === st);
  const distsOf = (st) => S.L.districts.filter((d) => d.st === st);

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
  function chamber(name) {
    const c = S.L[name], pm = S.live[name] ?? c.sources.polymarket;
    return { pD: blend(c.sources.polls, pm, c.sources.kalshi), polls: c.sources.polls, pm, kalshi: c.sources.kalshi };
  }

  // ---------- simulations (same model as scripts/update.mjs) ----------
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
    let s = seed >>> 0, spare = null;
    const u = () => { s += 0x6d2b79f5; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
    const n = () => { if (spare != null) { const v = spare; spare = null; return v; } const r = Math.sqrt(-2 * Math.log(u() || 1e-12)), a = 2 * Math.PI * u(); spare = r * Math.sin(a); return r * Math.cos(a); };
    return { u, n };
  }
  function simulateSenate(picks = {}, N = 12000) {
    const races = S.L.races, nu = S.L.senate.notUp, { u, n } = rng(2026);
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
      seats += R;
      dc += R >= 50 ? 0 : D >= 51 ? 1 : 0.5;
    }
    return { pD: dc / N, R: seats / N };
  }
  function simulateHouse(picks = {}, N = 3000) {
    const ds = S.L.districts, { n } = rng(435);
    const SD = 7, NAT = 2, LOC = Math.sqrt(SD * SD - NAT * NAT);
    const z = ds.map((d) => SD * phiInv(d.p));
    const fixed = ds.map((d) => (picks[d.st] ? (picks[d.st] === "D" ? 1 : 0) : d.sameParty ? (d.p > 0.5 ? 1 : 0) : -1));
    let ctl = 0, seats = 0;
    for (let k = 0; k < N; k++) {
      const e = n() * NAT;
      let D = 0;
      for (let i = 0; i < z.length; i++) { const f = fixed[i]; if (f >= 0) D += f; else if (z[i] + e + n() * LOC > 0) D++; }
      seats += D;
      if (D >= 218) ctl++;
    }
    return { pD: ctl / N, D: seats / N };
  }

  // ---------- top cards ----------
  function sentence(p, chamberName) {
    const lead = p >= 0.5 ? "D" : "R", pl = Math.max(p, 1 - p), who = PARTIES[lead];
    if (pl < 0.55) return `The ${chamberName} is a toss-up, with ${who} a hair ahead`;
    if (pl < 0.7) return `${who} are slightly favored to win the ${chamberName}`;
    if (pl < 0.85) return `${who} are favored to win the ${chamberName}`;
    return `${who} are very likely to win the ${chamberName}`;
  }
  function seatbar({ dSeats, close, rSeats, total, need, dLabel, rLabel, closeLabel }) {
    return `<div class="bar" role="img" aria-label="${dLabel} ${dSeats}, ${closeLabel} ${close}, ${rLabel} ${rSeats}. ${need} needed for control.">
        <div style="flex:${dSeats};background:var(--d1)"></div><div style="flex:${close};background:var(--toss)"></div><div style="flex:${rSeats};background:var(--r1)"></div>
      </div><div class="mark" style="left:${(need / total) * 100}%"><span>${need} to win</span></div>
      <div class="keys"><span class="dem">${dLabel} <b>${dSeats}</b></span>${close ? `<span>${closeLabel} <b>${close}</b></span>` : ""}<span class="rep">${rLabel} <b>${rSeats}</b></span></div>`;
  }
  function renderCards() {
    for (const name of ["house", "senate"]) {
      const ch = chamber(name), p = ch.pD, lead = p >= 0.5 ? "D" : "R", pl = Math.max(p, 1 - p), other = lead === "D" ? "R" : "D";
      const chamberName = name === "house" ? "House" : "Senate";
      $(`#${name}-say`).textContent = sentence(p, chamberName);
      $(`#${name}-chance`).innerHTML = `<div><div class="big" style="color:${color(lead)}">${Math.round(pl * 100)}<small>%</small></div><div class="lbl">chance for ${PARTIES[lead]} (${inTen(pl)})</div></div><div class="other"><div class="mid" style="color:${color(other)}">${Math.round((1 - pl) * 100)}%</div><div class="lbl">${PARTIES[other]}</div></div>`;
      if (name === "house") {
        const ds = S.L.districts;
        const d = ds.filter((x) => x.p >= 0.6).length, r = ds.filter((x) => x.p <= 0.4).length;
        $("#house-bar").innerHTML = seatbar({ dSeats: d, close: 435 - d - r, rSeats: r, total: 435, need: 218, dLabel: "Leaning Democratic", rLabel: "Leaning Republican", closeLabel: "Too close" });
        const e = Math.round(S.L.house.expected.combined);
        $("#house-foot").textContent = `Our best guess: ${e} Democrats and ${435 - e} Republicans. A party needs 218 of 435 seats to control the House.`;
      } else {
        const nu = S.L.senate.notUp;
        let d = nu.D, r = nu.R;
        for (const race of S.L.races) { const q = raceP(race); if (q.D + q.I >= 0.6) d++; else if (q.R >= 0.6) r++; }
        $("#senate-bar").innerHTML = seatbar({ dSeats: d, close: 100 - d - r, rSeats: r, total: 100, need: 51, dLabel: "Leaning Democratic", rLabel: "Leaning Republican", closeLabel: "Too close" });
        $("#senate-foot").textContent = `35 of 100 seats are on the ballot. Democrats need 51 seats. Republicans need only 50, because the Vice President breaks ties.`;
      }
    }
  }
  function renderIntro() {
    const days = Math.max(0, Math.ceil((Date.parse("2026-11-03T05:00:00Z") - Date.now()) / 86400e3));
    $("#lede").textContent = `Election Day is Tuesday, November 3${days > 0 ? `, ${days} days from now` : ""}. These odds combine public polls with betting markets.`;
    $("#updated").textContent = STATIC ? `Snapshot taken ${fmtWhen(S.L.updated)}.` : `Updated ${fmtWhen(S.L.updated)}. Betting odds refresh every minute while this page is open.`;
    $("#foot").textContent = `Updated ${fmtWhen(S.L.updated)}. Polls from VoteHub; betting odds from Polymarket and Kalshi.`;
    $("#refreshNote").textContent = STATIC ? `This page is a snapshot from ${fmtWhen(S.L.updated)}.` : "Polls and Kalshi odds refresh every 30 minutes. Polymarket odds refresh every minute while the page is open.";
  }

  // ---------- map ----------
  function senateFill(st) {
    const race = raceBy(st);
    if (!race) return null;
    const pk = S.build && S.mode === "senate" ? S.pick.senate[st] : null;
    if (pk) return { fill: color(pk), picked: true, light: false };
    const p = raceP(race), rt = rating(p.D, p.R, p.I);
    return { fill: rt.fill, light: rt.light };
  }
  function houseShare(st) { const ds = distsOf(st); return ds.length ? ds.reduce((a, d) => a + d.p, 0) / ds.length : null; }
  function shareFill(s) {
    if (s >= 0.8) return { fill: "var(--d1)", light: false };
    if (s >= 0.55) return { fill: "var(--d2)", light: false };
    if (s > 0.45) return { fill: "var(--toss)", light: true };
    if (s > 0.2) return { fill: "var(--r2)", light: false };
    return { fill: "var(--r1)", light: false };
  }
  function houseFill(st) {
    const pk = S.build && S.mode === "house" ? S.pick.house[st] : null;
    if (pk) return { fill: color(pk), picked: true, light: false };
    const s = houseShare(st);
    return s == null ? null : shareFill(s);
  }
  function renderMap() {
    const G = S.G, svg = $("#mapSvg");
    const fillOf = (st) => (S.mode === "senate" ? senateFill(st) : houseFill(st));
    svg.innerHTML = G.states.map((s) => {
      const f = fillOf(s.abbr);
      const label = S.mode === "senate" ? (raceBy(s.abbr) ? `${s.name}: Senate race` : `${s.name}: no Senate race this year`) : `${s.name}: House races`;
      return `<path class="st${f ? "" : " none"}${f?.picked ? " picked" : ""}${S.open === s.abbr ? " sel" : ""}" data-st="${s.abbr}" d="${s.d}" style="fill:${f ? f.fill : "var(--none)"}" tabindex="0" role="button" aria-label="${esc(label)}"></path>`;
    }).join("") + G.states.filter((s) => s.w > 26 && s.h > 18 && !SMALL.includes(s.abbr)).map((s) => {
      const [dx, dy] = LABEL_NUDGE[s.abbr] || [0, 0];
      const f = fillOf(s.abbr);
      return `<text class="lbl" x="${s.cx + dx}" y="${s.cy + dy}" style="fill:${!f ? "var(--ink-3)" : f.light ? "#15171c" : "#fff"}">${s.abbr}</text>`;
    }).join("");
    const L = S.mode === "senate"
      ? [["var(--d1)", "Very likely Democrat"], ["var(--d2)", "Likely Democrat"], ["var(--d3)", "Leaning Democrat"], ["var(--toss)", "Too close to call"], ["var(--r3)", "Leaning Republican"], ["var(--r2)", "Likely Republican"], ["var(--r1)", "Very likely Republican"], ["var(--i2)", "Independent favored"], ["var(--none)", "No Senate race this year"]]
      : [["var(--d1)", "Almost all seats Democratic"], ["var(--d2)", "Mostly Democratic"], ["var(--toss)", "Evenly split"], ["var(--r2)", "Mostly Republican"], ["var(--r1)", "Almost all seats Republican"]];
    $("#legend").innerHTML = L.map(([c, l]) => `<span><i style="background:${c}"></i>${l}</span>`).join("");
    $("#smallStates").innerHTML = "<span>Small states:</span>" + SMALL.map((st) => { const f = fillOf(st); return `<button type="button" data-st="${st}"><i style="background:${f ? f.fill : "var(--none)"}"></i>${STATE_NAMES[st]}</button>`; }).join("");
    if (S.build) renderBuild();
  }
  function tipHTML(st) {
    let h = `<b>${esc(STATE_NAMES[st])}</b>`;
    if (S.mode === "senate") {
      const race = raceBy(st);
      if (!race) return h + `<div class="hint">No Senate race this year</div>`;
      const p = raceP(race);
      h += race.c.filter((c) => p[c.party] >= 0.01).map((c) => `<div class="row"><span>${esc(c.name)} (${c.party})</span><b style="color:${color(c.party)}">${pctShort(p[c.party])}</b></div>`).join("");
    } else {
      const ds = distsOf(st), eD = ds.reduce((a, d) => a + d.p, 0);
      h += `<div class="row"><span>${ds.length} House seat${ds.length > 1 ? "s" : ""}</span></div><div class="row"><span>Expected</span><b><span class="dem">${Math.round(eD)} D</span> · <span class="rep">${ds.length - Math.round(eD)} R</span></b></div>`;
    }
    return h + `<div class="hint">${S.build ? "Tap to change your pick" : "Tap for details"}</div>`;
  }
  function activate(st) {
    if (S.build) return cyclePick(st);
    openPanel(st);
  }
  function bindMap() {
    const svg = $("#mapSvg"), tip = $("#tip");
    svg.addEventListener("pointermove", (e) => {
      const el = e.target.closest(".st");
      if (!el || e.pointerType !== "mouse") { tip.hidden = true; return; }
      tip.innerHTML = tipHTML(el.dataset.st);
      tip.style.left = clamp(e.clientX, 150, innerWidth - 150) + "px"; tip.style.top = e.clientY + "px"; tip.hidden = false;
    });
    svg.addEventListener("pointerleave", () => (tip.hidden = true));
    svg.addEventListener("click", (e) => { const el = e.target.closest(".st"); if (el) { tip.hidden = true; activate(el.dataset.st); } });
    svg.addEventListener("keydown", (e) => { const el = e.target.closest(".st"); if (el && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); activate(el.dataset.st); } });
    $("#smallStates").addEventListener("click", (e) => { const b = e.target.closest("[data-st]"); if (b) activate(b.dataset.st); });
    $("#statePick").innerHTML = '<option value="">Choose a state from a list…</option>' + Object.entries(STATE_NAMES).sort((a, b) => a[1].localeCompare(b[1])).map(([k, v]) => `<option value="${k}">${v}</option>`).join("");
    $("#statePick").addEventListener("change", (e) => { if (e.target.value) { openPanel(e.target.value); e.target.value = ""; } });
    const setMode = (m) => { S.mode = m; $("#tabSenate").setAttribute("aria-pressed", m === "senate"); $("#tabHouse").setAttribute("aria-pressed", m === "house"); renderMap(); };
    $("#tabSenate").onclick = () => setMode("senate");
    $("#tabHouse").onclick = () => setMode("house");
    $("#buildBtn").onclick = () => setBuild(!S.build);
    $("#buildDone").onclick = () => setBuild(false);
    $("#buildReset").onclick = () => { S.pick[S.mode] = {}; renderMap(); };
    $("#buildFill").onclick = fillFavorites;
  }

  // ---------- make your own prediction ----------
  function setBuild(on) {
    S.build = on;
    $("#buildBtn").setAttribute("aria-pressed", on);
    $("#buildBtn").textContent = on ? "Making your prediction…" : "Make your own prediction";
    $("#build").hidden = !on;
    renderMap();
    if (on) $("#build").scrollIntoView({ block: "nearest", behavior: "smooth" });
  }
  function cyclePick(st) {
    const picks = S.pick[S.mode];
    let order;
    if (S.mode === "senate") { const r = raceBy(st); if (!r) return; order = [r.altParty, "R"]; }
    else { if (!distsOf(st).length) return; order = ["D", "R"]; }
    const i = order.indexOf(picks[st]);
    if (i === -1) picks[st] = order[0]; else if (i === order.length - 1) delete picks[st]; else picks[st] = order[i + 1];
    renderMap();
  }
  function fillFavorites() {
    if (S.mode === "senate") for (const r of S.L.races) { if (S.pick.senate[r.st]) continue; const p = raceP(r); S.pick.senate[r.st] = p.R >= Math.max(p.D, p.I) ? "R" : p.D >= p.I ? "D" : "I"; }
    else for (const st of Object.keys(STATE_NAMES)) { if (S.pick.house[st] || !distsOf(st).length) continue; S.pick.house[st] = houseShare(st) >= 0.5 ? "D" : "R"; }
    renderMap();
  }
  let buildTimer;
  function renderBuild() {
    const senate = S.mode === "senate", picks = S.pick[S.mode], keys = Object.keys(picks);
    $("#buildHow").textContent = senate
      ? "Tap a state to give its Senate race to the Democrats (or the independent). Tap again for the Republicans. Tap a third time to undo."
      : "Tap a state to give all of its House seats to the Democrats. Tap again for the Republicans. Tap a third time to undo.";
    let dLock, rLock, total, need;
    if (senate) {
      dLock = S.L.senate.notUp.D + keys.filter((k) => picks[k] !== "R").length;
      rLock = S.L.senate.notUp.R + keys.filter((k) => picks[k] === "R").length;
      total = 100; need = 51;
    } else {
      dLock = 0; rLock = 0;
      for (const d of S.L.districts) { const pk = picks[d.st]; if (pk === "D") dLock++; else if (pk === "R") rLock++; }
      total = 435; need = 218;
    }
    const open = total - dLock - rLock;
    $("#buildResult").innerHTML = `<p class="result-say" id="buildSay">Working it out…</p><p class="result-sub" id="buildSub">&nbsp;</p>
      <div class="seatbar"><div class="bar"><div style="flex:${dLock};background:var(--d1)"></div><div style="flex:${open}"></div><div style="flex:${rLock};background:var(--r1)"></div></div>
      <div class="mark" style="left:${(need / total) * 100}%"><span>${need} to win</span></div>
      <div class="keys"><span class="dem">Democrats <b>${dLock}</b></span><span>Not picked yet <b>${open}</b></span><span class="rep">Republicans <b>${rLock}</b></span></div></div>`;
    clearTimeout(buildTimer);
    buildTimer = setTimeout(() => {
      const res = senate ? simulateSenate(picks) : simulateHouse(picks);
      const lead = res.pD >= 0.5 ? "D" : "R", pl = Math.max(res.pD, 1 - res.pD), ch = senate ? "Senate" : "House";
      let say, sub;
      if (open === 0) {
        const winD = senate ? dLock >= 51 : dLock >= 218, tie = senate && dLock === 50;
        say = tie ? "A 50–50 Senate. Republicans keep control because the Vice President breaks ties." : `${winD ? "Democrats" : "Republicans"} win the ${ch}, ${Math.max(dLock, rLock)} to ${Math.min(dLock, rLock)}.`;
        sub = "Every race is decided in your map.";
      } else if (!keys.length) {
        say = `Our forecast: ${PARTIES[lead]} have ${aChance(pl)} of winning the ${ch}.`;
        sub = "Start tapping states to see how your picks change the outcome.";
      } else {
        say = `With your picks, ${PARTIES[lead]} have ${aChance(pl)} of winning the ${ch}.`;
        sub = `The races you haven't picked are filled in with our forecast. Expected result: ${senate ? `${Math.round(100 - res.R)} Democrats, ${Math.round(res.R)} Republicans` : `${Math.round(res.D)} Democrats, ${435 - Math.round(res.D)} Republicans`}.`;
      }
      const a = $("#buildSay"), b = $("#buildSub");
      if (a) { a.textContent = say; b.textContent = sub; }
    }, 20);
  }

  // ---------- state panel ----------
  function openPanel(st, focusD) {
    if (!STATE_NAMES[st]) return;
    if (!S.open) S.lastFocus = document.activeElement;
    S.open = st; S.focusD = focusD || null; S.allPolls = false; S.allDistricts = false;
    renderPanel();
    $("#panel").classList.add("open"); $("#scrim").classList.add("open");
    $("#panel").setAttribute("aria-hidden", "false");
    document.body.style.overflow = "hidden";
    $$("#mapSvg .st").forEach((p) => p.classList.toggle("sel", p.dataset.st === st));
    try { history.replaceState(null, "", "#" + st); } catch {}
    setTimeout(() => { if (focusD) { const el = $(`.district[data-id="${focusD}"]`); el?.scrollIntoView({ block: "center" }); el?.querySelector("button")?.focus({ preventScroll: true }); } else $("#panelClose").focus({ preventScroll: true }); }, 60);
    const race = raceBy(st);
    if (race && !STATIC) liveRace(race);
  }
  function closePanel() {
    S.open = null;
    $("#panel").classList.remove("open"); $("#scrim").classList.remove("open");
    $("#panel").setAttribute("aria-hidden", "true");
    document.body.style.overflow = "";
    $$("#mapSvg .sel").forEach((p) => p.classList.remove("sel"));
    try { history.replaceState(null, "", location.pathname + location.search); } catch {}
    S.lastFocus?.focus?.({ preventScroll: true });
  }
  // pollster info, in words
  function trustWords(g) {
    if (g == null) return "Not rated";
    if (g >= 2.5) return "Highly rated";
    if (g >= 1.8) return "Rated OK";
    if (g >= 1.0) return "Mixed record";
    return "Poor record";
  }
  const stars = (g) => (g == null ? "" : "★".repeat(Math.max(1, Math.round(g))));
  function paidBy(p) {
    if (p.internal) return `<span class="tag">The campaign's own poll</span>`;
    if (p.partisan === "REP") return `<span class="tag paidR">Paid for by Republicans${p.sponsors ? ` (${esc(p.sponsors)})` : ""}</span>`;
    if (p.partisan === "DEM") return `<span class="tag paidD">Paid for by Democrats${p.sponsors ? ` (${esc(p.sponsors)})` : ""}</span>`;
    return `<span>Independent poll</span>`;
  }
  function leanWords(name) {
    const ps = S.PI[name];
    if (!ps || ps.heN < 3 || Math.abs(ps.he) < 1.5) return "";
    return `Usually leans ${ps.he > 0 ? "Democratic" : "Republican"}`;
  }
  function pollItem(q, aKey, aName, rName) {
    const lean = leanWords(q.pollster);
    return `<li><span class="pollster">${q.url ? `<a href="${esc(q.url)}" target="_blank" rel="noopener">${esc(q.pollster)}</a>` : esc(q.pollster)}</span>
      <span class="res"><span style="color:${color(aKey)}">${esc(aName)} ${q[aKey] ?? "—"}</span>, <span style="color:var(--r1)">${esc(rName)} ${q.R ?? "—"}</span></span>
      <span class="sub"><span>${fmtDay(q.date)}</span>${paidBy(q)}<span>${q.grade != null ? `<span class="stars">${stars(q.grade)}</span> ` : ""}${trustWords(q.grade)}</span>${lean ? `<span>${lean}</span>` : ""}</span></li>`;
  }
  function person(c, p) {
    return `<div class="person">${photo(c)}<div class="name">${esc(c.name)}</div><div class="meta">${PARTY[c.party] || "Other"}${c.inc ? " · Current senator" : c.office ? ` · ${esc(c.office)}` : ""}</div><div class="pct" style="color:${color(c.party)}">${pctShort(p)}<small>chance to win</small></div></div>`;
  }
  function senateSection(r) {
    const p = raceP(r), rt = rating(p.D, p.R, p.I);
    const A = r.altParty, alt = r.c.find((c) => c.party === A), rep = r.c.find((c) => c.party === "R");
    const others = r.c.filter((c) => c !== alt && c !== rep && (p[c.party] || 0) >= 0.01);
    const leader = p[A] >= p.R ? alt : rep, lp = Math.max(p[A], p.R);
    const pm = S.live.race[r.st] || r.pm;
    const avg = r.avg ? (Math.abs(r.avg.margin) < 0.5 ? "Tied" : `${esc(lastName(r.avg.margin > 0 ? alt.name : rep.name))} ahead by ${Math.abs(r.avg.margin).toFixed(1)} points`) : "No public polls yet";
    const polls = S.allPolls ? r.polls : r.polls.slice(0, 5);
    return `<section>
      <h3>Senate race${r.special ? " (special election)" : ""}</h3>
      ${chip(rt)}
      <div class="faceoff">${person(alt, p[A])}${person(rep, p.R)}</div>
      ${others.length ? `<p class="muted">Also running: ${others.map((c) => `${esc(c.name)} (${PARTY[c.party]}, ${pctShort(p[c.party])})`).join(", ")}</p>` : ""}
      <p class="say"><b>${esc(leader.name)}</b> (${PARTY[leader.party]}) has ${aChance(lp)} of winning, ${inTen(lp)}.</p>
      <div class="facts">
        <div><span class="k">Polling average</span><span class="v">${avg}</span></div>
        <div><span class="k">Polls alone give ${esc(lastName(alt.name))}</span><span class="v">${pctShort(r.poll[A])}</span></div>
        <div><span class="k">Betting on Polymarket gives ${esc(lastName(alt.name))}</span><span class="v">${pm ? pctShort(pm[A]) : "No market"}</span></div>
        <div><span class="k">Betting on Kalshi gives ${esc(lastName(alt.name))}</span><span class="v">${r.k ? pctShort(r.k[A]) : "No market"}</span></div>
        <div><span class="k">Seat is now held by</span><span class="v">${PARTIES[r.held]}</span></div>
      </div>
      ${r.polls.length >= 2 ? `<h3 style="margin-top:24px">Polls over time</h3><div class="chart-box" id="pollChart"></div>` : ""}
      ${r.polls.length ? `<h3 style="margin-top:24px">${S.allPolls ? `All ${r.polls.length} polls` : "Latest polls"}</h3>
        <ul class="polls">${polls.map((q) => pollItem(q, A, lastName(alt.name), lastName(rep.name))).join("")}</ul>
        ${r.polls.length > 5 ? `<button type="button" class="btn" id="allPolls" style="margin-top:12px">${S.allPolls ? "Show fewer polls" : `Show all ${r.polls.length} polls`}</button>` : ""}` : `<p class="muted">No public polls of this race yet, so we lean more on the betting markets and how the state usually votes.</p>`}
      <div class="link-row"><a href="https://polymarket.com/event/${esc(r.pmSlug)}" target="_blank" rel="noopener">See this race on Polymarket</a>${r.kalshi ? `<a href="https://kalshi.com/markets/${esc(r.kalshi.split("-")[0].toLowerCase())}" target="_blank" rel="noopener">See it on Kalshi</a>` : ""}</div>
    </section>`;
  }
  function districtRow(d, open) {
    const rt = rating(d.p, 1 - d.p);
    const dc = d.c.find((c) => c.party === "D"), rc = d.c.find((c) => c.party === "R");
    const who = d.sameParty ? `${d.c.slice(0, 2).map((c) => esc(c.name)).join(" vs ")} (both ${PARTIES[d.c[0].party]})` : [dc, rc].filter(Boolean).map((c) => `${esc(c.name)} (${c.party}${c.inc ? ", current member" : ""})`).join(" vs ");
    const odds = d.sameParty ? `<span style="color:${color(d.c[0].party)}">${d.c[0].party} hold</span><small>Same-party race</small>` : `<span style="color:${color(rt.lead)}">${rt.lead} ${pctShort(rt.p)}</span><small>${rt.label}</small>`;
    return `<li class="district${d.id === S.focusD ? " hl" : ""}" data-id="${d.id}"><button type="button" aria-expanded="${open}"><span class="dn">${d.n === 0 ? "At-large seat" : `District ${d.n}`}</span><span class="who">${who}</span><span class="odds">${odds}</span></button>${open ? districtDetail(d) : ""}</li>`;
  }
  function districtDetail(d) {
    const cs = d.c.slice(0, 2);
    const pOf = (c) => (d.sameParty ? c.pm : c.party === "D" ? d.p : c.party === "R" ? 1 - d.p : c.pm);
    const dc = d.c.find((c) => c.party === "D"), rc = d.c.find((c) => c.party === "R");
    return `<div class="detail"><div class="faceoff">${cs.map((c) => `<div class="person">${photo(c)}<div class="name">${esc(c.name)}</div><div class="meta">${PARTY[c.party] || "Other"}${c.inc ? " · Current member" : ""}</div><div class="pct" style="color:${color(c.party)}">${pctShort(pOf(c))}<small>chance to win</small></div></div>`).join("")}</div>
      ${d.sameParty ? "" : `<div class="facts">
        <div><span class="k">Betting on Polymarket gives the Democrat</span><span class="v">${pctShort(d.pmD)}</span></div>
        ${d.kD != null ? `<div><span class="k">Betting on Kalshi gives the Democrat</span><span class="v">${pctShort(d.kD)}</span></div>` : ""}
        ${d.pollMargin != null ? `<div><span class="k">Local polls</span><span class="v">${Math.abs(d.pollMargin) < 0.5 ? "Tied" : `${d.pollMargin > 0 ? "Democrat" : "Republican"} ahead by ${Math.abs(d.pollMargin).toFixed(1)}`}</span></div>` : ""}
        ${d.holder ? `<div><span class="k">Current member for this district number</span><span class="v">${esc(d.holder)} (${d.held})</span></div>` : ""}
      </div>`}
      ${d.polls ? `<ul class="polls">${d.polls.map((q) => pollItem({ ...q, D: q.d, R: q.r }, "D", dc ? lastName(dc.name) : "Dem", rc ? lastName(rc.name) : "Rep")).join("")}</ul>` : ""}
      <div class="link-row"><a href="https://polymarket.com/event/${esc(d.slug)}" target="_blank" rel="noopener">See this race on Polymarket</a></div></div>`;
  }
  function houseSection(st) {
    const ds = distsOf(st), eD = Math.round(ds.reduce((a, d) => a + d.p, 0));
    const close = ds.filter((d) => !d.sameParty && d.p > 0.2 && d.p < 0.8);
    const show = S.allDistricts || ds.length <= 6 ? ds : ds.filter((d) => close.includes(d) || d.id === S.focusD);
    return `<section>
      <h3>House seats (${ds.length})</h3>
      <p>Our best guess: <b class="dem">${eD} Democrat${eD === 1 ? "" : "s"}</b> and <b class="rep">${ds.length - eD} Republican${ds.length - eD === 1 ? "" : "s"}</b>.${ds.length > 6 ? ` ${close.length ? `${close.length} of these races ${close.length === 1 ? "is" : "are"} close.` : "None of the races here are close."}` : ""}</p>
      <ul class="districts" id="districtList">${show.map((d) => districtRow(d, d.id === S.focusD)).join("")}</ul>
      ${ds.length > 6 && show.length < ds.length ? `<button type="button" class="btn" id="allDistricts" style="margin-top:12px">Show all ${ds.length} districts</button>` : ""}
    </section>`;
  }
  function renderPanel() {
    const st = S.open, race = raceBy(st);
    $("#panelTitle").textContent = STATE_NAMES[st];
    const senate = race ? senateSection(race) : `<section><h3>Senate</h3><p class="muted">${STATE_NAMES[st]} has no Senate race this year.</p></section>`;
    $("#panelBody").innerHTML = !race || S.focusD || (S.mode === "house" && !S.build) ? houseSection(st) + senate : senate + houseSection(st);
    $("#panelBody").scrollTop = 0;
    if (race) requestAnimationFrame(() => drawPollChart(race));
  }
  function bindPanel() {
    $("#panelClose").onclick = closePanel;
    $("#scrim").onclick = closePanel;
    document.addEventListener("keydown", (e) => { if (e.key === "Escape" && S.open) closePanel(); });
    $("#panelBody").addEventListener("click", (e) => {
      if (e.target.closest("#allPolls")) { S.allPolls = !S.allPolls; const y = $("#panelBody").scrollTop; renderPanel(); $("#panelBody").scrollTop = y; return; }
      if (e.target.closest("#allDistricts")) { S.allDistricts = true; const y = $("#panelBody").scrollTop; renderPanel(); $("#panelBody").scrollTop = y; return; }
      const btn = e.target.closest(".district > button");
      if (btn) { const li = btn.parentElement, d = S.L.districts.find((x) => x.id === li.dataset.id); li.outerHTML = districtRow(d, btn.getAttribute("aria-expanded") !== "true"); }
    });
  }

  // ---------- charts ----------
  function axisMonths(t0, t1, x, H, W, m) {
    const out = [], d0 = new Date(t0 * 1000);
    for (let d = new Date(Date.UTC(d0.getUTCFullYear(), d0.getUTCMonth() + 1, 1)); d.getTime() / 1000 <= t1; d.setUTCMonth(d.getUTCMonth() + 1)) out.push(new Date(d));
    const every = Math.max(1, Math.ceil(out.length / Math.max(2, Math.floor((W - m.l - m.r) / 60))));
    return out.filter((_, i) => i % every === 0).map((d) => `<text x="${x(d.getTime() / 1000)}" y="${H - 6}" text-anchor="middle">${MONTHS[d.getUTCMonth()]}${d.getUTCMonth() === 0 ? " " + d.getUTCFullYear() : ""}</text>`).join("");
  }
  function hover(el, svg, W, x, t0, t1, m, base, rows) {
    const tip = el.querySelector(".chart-tip");
    svg.addEventListener("pointermove", (e) => {
      const r = svg.getBoundingClientRect(), t = t0 + ((((e.clientX - r.left) / r.width) * W - m.l) / (W - m.l - m.r)) * (t1 - t0);
      let best = base[0];
      for (const d of base) if (Math.abs(d[0] - t) < Math.abs(best[0] - t)) best = d;
      const d = new Date(best[0] * 1000);
      tip.innerHTML = `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}: ${rows(best)}`;
      tip.style.left = clamp((x(best[0]) / W) * r.width, 70, r.width - 70) + "px"; tip.style.top = "20px"; tip.hidden = false;
    });
    svg.addEventListener("pointerleave", () => (tip.hidden = true));
  }
  // chance-over-time chart: line turns blue above 50% and red below
  function trendChart(el, series) {
    if (!el || !series?.length) return;
    const data = series.filter((d) => d[0] >= Date.parse("2026-01-01") / 1000);
    const W = Math.max(280, el.clientWidth), H = 220, m = { l: 40, r: 44, t: 10, b: 26 };
    const t0 = data[0][0], t1 = data[data.length - 1][0];
    const x = (t) => m.l + ((t - t0) / (t1 - t0 || 1)) * (W - m.l - m.r), y = (v) => m.t + (1 - v) * (H - m.t - m.b);
    const line = data.map(([t, v], i) => `${i ? "L" : "M"}${x(t).toFixed(1)},${y(v).toFixed(1)}`).join("");
    const area = `${line}L${x(t1)},${y(0.5)}L${x(t0)},${y(0.5)}Z`;
    const last = data[data.length - 1], id = el.id;
    el.innerHTML = `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Chance over time, now ${pctShort(last[1])} for Democrats">
      <defs><clipPath id="${id}-up"><rect x="0" y="0" width="${W}" height="${y(0.5)}"/></clipPath><clipPath id="${id}-dn"><rect x="0" y="${y(0.5)}" width="${W}" height="${H}"/></clipPath></defs>
      <g class="grid">${[0, 0.25, 0.5, 0.75, 1].map((v) => `<line x1="${m.l}" x2="${W - m.r}" y1="${y(v)}" y2="${y(v)}"${v === 0.5 ? ' style="stroke:var(--ink-3);stroke-dasharray:4 4"' : ""}/>`).join("")}</g>
      ${[0, 0.5, 1].map((v) => `<text x="${m.l - 8}" y="${y(v) + 4}" text-anchor="end">${Math.round(v * 100)}%</text>`).join("")}
      <text x="${W - m.r + 6}" y="${y(0.5) + 4}">Even</text>
      ${axisMonths(t0, t1, x, H, W, m)}
      <path d="${area}" clip-path="url(#${id}-up)" style="fill:var(--d1)" opacity=".14"/><path d="${area}" clip-path="url(#${id}-dn)" style="fill:var(--r1)" opacity=".14"/>
      <path d="${line}" clip-path="url(#${id}-up)" fill="none" style="stroke:var(--d1)" stroke-width="3" stroke-linejoin="round"/>
      <path d="${line}" clip-path="url(#${id}-dn)" fill="none" style="stroke:var(--r1)" stroke-width="3" stroke-linejoin="round"/>
      <circle cx="${x(last[0])}" cy="${y(last[1])}" r="5" style="fill:${last[1] >= 0.5 ? "var(--d1)" : "var(--r1)"}"/>
      <text x="${x(last[0]) + 8}" y="${y(last[1]) + 5}" style="font-weight:800;fill:var(--ink)">${Math.round(last[1] * 100)}%</text>
      <rect x="${m.l}" y="0" width="${W - m.l - m.r}" height="${H}" fill="transparent"/></svg><div class="chart-tip" hidden></div>`;
    hover(el, el.querySelector("svg"), W, x, t0, t1, m, data, (d) => `Democrats <b>${pctShort(d[1])}</b>`);
  }
  function pollAverage(polls, keys) {
    const POP = { lv: 1, rv: 0.9, v: 0.9, a: 0.7 };
    const ts = polls.map((p) => ({ t: Date.parse(p.date + "T12:00:00Z") / 1000, p })).filter(({ p }) => keys.every((k) => p[k] != null));
    if (!ts.length) return [];
    const t0 = Math.min(...ts.map((v) => v.t)), t1 = Math.max(Date.now() / 1000, ...ts.map((v) => v.t)), out = [];
    for (let t = t0; t <= t1 + 1; t += DAY) {
      const sum = keys.map(() => 0); let sw = 0;
      for (const { t: pt, p } of ts) {
        const gap = (t - pt) / (18 * DAY); // smooth bell-shaped weighting so the lines don't jump with each new poll
        if (Math.abs(gap) > 4) continue;
        const w = Math.exp(-0.5 * gap * gap) * Math.sqrt(clamp(p.n || 600, 300, 3000) / 600) * (POP[p.pop] ?? 0.8) * (p.partisan ? 0.5 : 1) * (p.grade != null ? 0.45 + 0.55 * (p.grade / 3) : 0.6);
        keys.forEach((k, i) => (sum[i] += w * p[k])); sw += w;
      }
      if (sw) out.push([t, ...sum.map((s) => s / sw)]);
    }
    return out;
  }
  function drawPollChart(r) {
    const el = $("#pollChart");
    if (!el) return;
    const A = r.altParty, avg = pollAverage(r.polls, [A, "R"]);
    if (!avg.length) return;
    const pts = r.polls.filter((q) => q[A] != null && q.R != null).map((q) => [Date.parse(q.date + "T12:00:00Z") / 1000, q[A], q.R]);
    const vals = pts.flatMap((p) => [p[1], p[2]]);
    const lo = Math.floor((Math.min(...vals) - 2) / 5) * 5, hi = Math.ceil((Math.max(...vals) + 2) / 5) * 5;
    const W = Math.max(280, el.clientWidth), H = 220, m = { l: 34, r: 74, t: 10, b: 26 };
    const t0 = avg[0][0], t1 = avg[avg.length - 1][0];
    const x = (t) => m.l + ((t - t0) / (t1 - t0 || 1)) * (W - m.l - m.r), y = (v) => m.t + (1 - (v - lo) / (hi - lo)) * (H - m.t - m.b);
    const path = (i) => avg.map((d, j) => `${j ? "L" : "M"}${x(d[0]).toFixed(1)},${y(d[i]).toFixed(1)}`).join("");
    const last = avg[avg.length - 1];
    const ticks = []; for (let v = lo; v <= hi; v += 5) ticks.push(v);
    const alt = r.c.find((c) => c.party === A), rep = r.c.find((c) => c.party === "R");
    el.innerHTML = `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Poll average over time">
      <g class="grid">${ticks.map((v) => `<line x1="${m.l}" x2="${W - m.r}" y1="${y(v)}" y2="${y(v)}"/>`).join("")}</g>
      ${ticks.map((v) => `<text x="${m.l - 6}" y="${y(v) + 4}" text-anchor="end">${v}</text>`).join("")}
      ${axisMonths(t0, t1, x, H, W, m)}
      ${pts.map((p) => `<circle cx="${x(p[0])}" cy="${y(p[1])}" r="3" style="fill:${color(A)}" opacity=".35"/><circle cx="${x(p[0])}" cy="${y(p[2])}" r="3" style="fill:var(--r1)" opacity=".35"/>`).join("")}
      <path d="${path(1)}" fill="none" style="stroke:${color(A)}" stroke-width="3"/><path d="${path(2)}" fill="none" style="stroke:var(--r1)" stroke-width="3"/>
      <text x="${x(last[0]) + 6}" y="${y(last[1]) + (last[1] >= last[2] ? -2 : 12)}" style="font-weight:800;fill:${color(A)}">${esc(lastName(alt.name))} ${last[1].toFixed(0)}</text>
      <text x="${x(last[0]) + 6}" y="${y(last[2]) + (last[2] > last[1] ? -2 : 12)}" style="font-weight:800;fill:var(--r1)">${esc(lastName(rep.name))} ${last[2].toFixed(0)}</text>
      <rect x="${m.l}" y="0" width="${W - m.l - m.r}" height="${H}" fill="transparent"/></svg><div class="chart-tip" hidden></div>`;
    hover(el, el.querySelector("svg"), W, x, t0, t1, m, avg, (d) => `${esc(lastName(alt.name))} <b>${d[1].toFixed(1)}</b>, ${esc(lastName(rep.name))} <b>${d[2].toFixed(1)}</b>`);
  }

  // ---------- closest races ----------
  function renderClosest() {
    const sen = S.L.races.map((r) => ({ r, p: raceP(r) })).sort((a, b) => Math.abs(a.p.R - 0.5) - Math.abs(b.p.R - 0.5)).slice(0, 6);
    $("#closeSenate").innerHTML = sen.map(({ r, p }) => {
      const A = r.altParty, alt = r.c.find((c) => c.party === A), rep = r.c.find((c) => c.party === "R"), rt = rating(p.D, p.R, p.I);
      return `<li><button type="button" data-st="${r.st}"><span class="where">${esc(r.name)}</span><span class="who">${esc(lastName(alt.name))} (${A}) vs ${esc(lastName(rep.name))} (R)</span><span class="odds" style="color:${color(rt.lead)}">${rt.lead} ${pctShort(rt.p)}<small>${rt.label}</small></span>${split(p[A], color(A), p.R, "var(--r1)")}</button></li>`;
    }).join("");
    const hs = S.L.districts.filter((d) => !d.sameParty).sort((a, b) => Math.abs(a.p - 0.5) - Math.abs(b.p - 0.5)).slice(0, 6);
    $("#closeHouse").innerHTML = hs.map((d) => {
      const dc = d.c.find((c) => c.party === "D"), rc = d.c.find((c) => c.party === "R"), rt = rating(d.p, 1 - d.p);
      return `<li><button type="button" data-st="${d.st}" data-d="${d.id}"><span class="where">${esc(STATE_NAMES[d.st])}, District ${d.n || "at-large"}</span><span class="who">${esc(dc ? lastName(dc.name) : "Democrat")} (D) vs ${esc(rc ? lastName(rc.name) : "Republican")} (R)</span><span class="odds" style="color:${color(rt.lead)}">${rt.lead} ${pctShort(rt.p)}<small>${rt.label}</small></span>${split(d.p, "var(--d1)", 1 - d.p, "var(--r1)")}</button></li>`;
    }).join("");
  }
  function bindClosest() {
    $("#close").addEventListener("click", (e) => { const b = e.target.closest("[data-st]"); if (b) openPanel(b.dataset.st, b.dataset.d); });
  }

  // ---------- how it works ----------
  function renderHow() {
    const h = chamber("house"), s = chamber("senate"), W = S.L.weights;
    const val = (p) => `Democrats ${pctShort(p)}`;
    $("#sources").innerHTML = [
      ["Polls", "Counts for half", "Every public poll, with better and more recent polls counting more.", h.polls, s.polls],
      ["Polymarket", "Counts for a quarter", "A betting market where people trade on who will win.", h.pm, s.pm],
      ["Kalshi", "Counts for a quarter", "A betting market regulated in the U.S.", h.kalshi, s.kalshi],
    ].map(([n, w, d, hv, sv]) => `<div class="source"><h3>${n} <span>${w}</span></h3><p>${d}</p><div class="vals"><span>House: <b>${val(hv)}</b></span><span>Senate: <b>${val(sv)}</b></span></div></div>`).join("");
    const eq = (ch, name) => `<p><b>${name}:</b> ${pctShort(ch.polls)} × ½ + ${pctShort(ch.pm)} × ¼ + ${pctShort(ch.kalshi)} × ¼ = <b>${pctShort(ch.pD)}</b> chance for Democrats</p>`;
    $("#math").innerHTML = W.polls === 0.5 ? eq(h, "House") + eq(s, "Senate") : "";
    renderPollsters();
    renderFeed();
  }
  function renderPollsters() {
    const ps = (S.L.pollsters || []).slice().sort((a, b) => b.n - a.n);
    const show = S.allPollsters ? ps : ps.slice(0, 20);
    $("#pollsterTable").innerHTML = `<thead><tr><th>Pollster</th><th>Track record</th><th>Usually leans</th><th class="r">Polls this year</th><th>Paid for by a party</th></tr></thead><tbody>${show.map((p) => {
      const lean = p.heN >= 3 && Math.abs(p.he) >= 1 ? `<span style="color:${p.he > 0 ? "var(--d1)" : "var(--r1)"}">${p.he > 0 ? "Democratic" : "Republican"} by ${Math.abs(p.he).toFixed(1)}</span>` : p.heN >= 3 ? "Close to average" : '<span class="muted">Too few polls to tell</span>';
      const paid = p.rB || p.dB ? [p.rB ? `<span class="rep">${p.rB} by Republicans</span>` : "", p.dB ? `<span class="dem">${p.dB} by Democrats</span>` : ""].filter(Boolean).join(", ") : '<span class="muted">None</span>';
      return `<tr><td><b>${esc(p.name)}</b></td><td>${p.grade != null ? `<span class="stars">${stars(p.grade)}</span> ` : ""}${trustWords(p.grade)}</td><td>${lean}</td><td class="r num">${p.n}</td><td>${paid}</td></tr>`;
    }).join("")}</tbody>`;
    const b = $("#pollsterMore");
    b.hidden = ps.length <= 20;
    b.textContent = S.allPollsters ? "Show fewer" : `Show all ${ps.length} pollsters`;
  }
  function renderFeed() {
    const rows = S.L.feed.slice(0, 60).map((f) => {
      let race, res;
      if (f.type === "generic") { race = "National: which party for Congress?"; res = `<span class="dem">Democrats ${f.D}</span>, <span class="rep">Republicans ${f.R}</span>`; }
      else if (f.type === "senate") { const r = raceBy(f.st), alt = r.c.find((c) => c.party === r.altParty), rep = r.c.find((c) => c.party === "R"); race = `${esc(r.name)} Senate`; res = `<span style="color:${color(r.altParty)}">${esc(lastName(alt.name))} ${f[r.altParty] ?? "—"}</span>, <span class="rep">${esc(lastName(rep.name))} ${f.R ?? "—"}</span>`; }
      else { const d = S.L.districts.find((x) => x.id === f.id); race = `${esc(STATE_NAMES[d?.st] || "")} District ${d?.n || ""}`; res = `<span class="dem">Dem ${f.D}</span>, <span class="rep">Rep ${f.R}</span>`; }
      return `<tr><td class="num">${fmtDay(f.date)}</td><td>${race}</td><td>${f.url ? `<a href="${esc(f.url)}" target="_blank" rel="noopener">${esc(f.pollster)}</a>` : esc(f.pollster)}</td><td class="num">${res}</td><td>${paidBy(f)} · ${trustWords(f.grade)}</td></tr>`;
    }).join("");
    $("#feedTable").innerHTML = `<thead><tr><th>Date</th><th>Race</th><th>Pollster</th><th>Result</th><th>Notes</th></tr></thead><tbody>${rows}</tbody>`;
  }

  function renderAll() {
    renderIntro(); renderCards(); renderMap(); renderClosest(); renderHow();
    trendChart($("#trendHouse"), S.H.house.combined);
    trendChart($("#trendSenate"), S.H.senate.combined);
  }

  // ---------- live Polymarket (hosted copies only) ----------
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
  async function liveChambers() {
    try {
      const [h, s] = await Promise.all([pmEvent(S.L.live.house), pmEvent(S.L.live.senate)]);
      for (const [k, e] of [["house", h], ["senate", s]]) {
        const ms = (e?.markets || []).filter((m) => m.active && !m.closed);
        const d = ms.find((m) => /democrat/i.test(m.groupItemTitle)), r = ms.find((m) => /republican/i.test(m.groupItemTitle));
        if (d && r) { const pd = pmPrice(d), pr = pmPrice(r); if (pd != null && pr != null) S.live[k] = pd / (pd + pr); }
      }
      renderCards(); renderHow();
    } catch {}
  }
  async function liveRace(race) {
    try {
      const e = await pmEvent(race.pmSlug), ms = (e?.markets || []).filter((m) => m.active && !m.closed), o = { D: 0, R: 0, I: 0 };
      let tot = 0;
      for (const c of race.c) { const m = ms.find((x) => (x.groupItemTitle || "").trim() === c.pmLabel); const p = m ? pmPrice(m) : null; if (p != null) { o[c.party] += p; tot += p; } }
      if (!tot) return;
      for (const k in o) o[k] /= tot;
      S.live.race[race.st] = o;
      if (S.open === race.st) { const y = $("#panelBody").scrollTop; renderPanel(); $("#panelBody").scrollTop = y; }
    } catch {}
  }

  // ---------- boot ----------
  async function boot() {
    try {
      const v = Date.now(), get = (u) => fetch(u, { cache: "no-store" }).then((r) => { if (!r.ok) throw new Error(u); return r.json(); });
      const [L, H, G] = await Promise.all([get(`data/latest.json?t=${v}`), get(`data/history.json?t=${v}`), get("data/states.json")]);
      Object.assign(S, { L, H, G, PI: Object.fromEntries((L.pollsters || []).map((p) => [p.name, p])) });
    } catch {
      $("#lede").textContent = "The forecast didn't load. Please check your internet connection and refresh the page.";
      return;
    }
    renderAll();
    bindMap(); bindPanel(); bindClosest();
    $("#pollsterMore").onclick = () => { S.allPollsters = !S.allPollsters; renderPollsters(); };
    let rt, lastW = innerWidth;
    addEventListener("resize", () => { if (Math.abs(innerWidth - lastW) < 30) return; lastW = innerWidth; clearTimeout(rt); rt = setTimeout(() => { trendChart($("#trendHouse"), S.H.house.combined); trendChart($("#trendSenate"), S.H.senate.combined); if (S.open) { const r = raceBy(S.open); if (r) drawPollChart(r); } }, 200); });
    const hash = location.hash.slice(1).toUpperCase();
    if (STATE_NAMES[hash]) setTimeout(() => openPanel(hash), 200);
    addEventListener("hashchange", () => { const h = location.hash.slice(1).toUpperCase(); if (STATE_NAMES[h] && S.open !== h) openPanel(h); });
    if (!STATIC) {
      liveChambers();
      setInterval(liveChambers, 60e3);
      setInterval(() => { const r = S.open && raceBy(S.open); if (r) liveRace(r); }, 60e3);
    }
  }
  boot();
})();
