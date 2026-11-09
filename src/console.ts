/**
 * E(O)N™ MIL exercise console. One static page; it talks to /api/eon/*.
 * Uses the shared Infinitum app shell (inlined: the CSP allows inline styles only).
 */
import { appShellCss } from "./app-shell-css.ts";

export const CONSOLE_HTML = /* html */ `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>E(O)N™ MIL · Exercise QUIETFIELD</title>
<meta name="description" content="E(O)N™ MIL exercise console. Simulated. Not for operational use.">
<style>
${appShellCss}
</style>
<style>
:root{--soft:var(--paper);--m-ease:var(--ease)}
.lead{font-size:18px;letter-spacing:-.015em;color:var(--muted);margin:8px 0 0}
.small{font-size:12px;color:var(--muted)}
.console-head{display:flex;flex-wrap:wrap;gap:16px;align-items:flex-end;justify-content:space-between;padding-bottom:24px;border-bottom:1px solid var(--line)}
.console-head h1{margin:0;font-size:var(--title)}
h2{font-size:22px;letter-spacing:-.02em;margin:0 0 16px}
.bar{display:flex;flex-wrap:wrap;gap:8px;align-items:center}
button,select{font:inherit;font-size:14px;border-radius:0;border:1px solid var(--line);background:var(--paper);color:var(--ink);padding:8px 16px;cursor:pointer;transition:border-color .15s var(--m-ease),background .15s var(--m-ease)}
select{padding:6px 8px}
button:hover{border-color:var(--accent);color:var(--accent)}
button.primary{background:var(--ink);border-color:var(--ink);color:var(--paper)}
button.primary:hover,button.accent:hover{background:var(--accent);border-color:var(--accent);color:var(--paper)}
button.accent{background:var(--ink);border-color:var(--ink);color:var(--paper)}
button:disabled{opacity:.4;cursor:default}
.seg{display:inline-flex;border:1px solid var(--line);padding:2px}
.seg button{border:0;padding:6px 14px}
.seg button[aria-pressed=true]{background:var(--ink);color:var(--paper)}
.grid{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:24px;margin-top:24px}
@media (max-width:860px){.grid{grid-template-columns:1fr}}
section{border:1px solid var(--line);padding:24px;min-width:0}
.full{grid-column:1/-1}
svg{width:100%;height:auto;display:block;background:var(--paper);border:1px solid var(--line)}
ul{list-style:none;margin:0;padding:0}
li{padding:12px 0;border-top:1px solid var(--line)}
li:first-child{border-top:0;padding-top:0}
.row{display:flex;gap:12px;align-items:baseline;justify-content:space-between;flex-wrap:wrap}
.tag{font-size:12px;color:var(--muted);text-transform:uppercase;letter-spacing:.04em}
.tag.hot{color:var(--accent)}
.acked{color:var(--muted)}
table{width:100%;border-collapse:collapse;font-size:14px}
th{font-weight:400;color:var(--muted);font-size:12px;text-align:left;padding:0 8px 8px 0}
td{padding:10px 8px 10px 0;border-top:1px solid var(--line);vertical-align:middle}
.units{display:grid;grid-template-columns:repeat(auto-fill,minmax(230px,1fr));gap:16px}
.unit{border:1px solid var(--line);padding:16px}
.unit dl{display:grid;grid-template-columns:auto 1fr;gap:4px 12px;margin:12px 0;font-size:14px}
.unit dt{color:var(--muted)}
.unit dd{margin:0}
.unit dd.hot{color:var(--accent)}
.meter{height:4px;background:var(--line);overflow:hidden;margin-top:4px}
.meter i{display:block;height:100%;background:var(--ink)}
.meter.low i{background:var(--accent)}
.toast{position:fixed;left:50%;bottom:24px;transform:translateX(-50%);background:var(--ink);color:var(--paper);padding:10px 16px;font-size:14px;max-width:calc(100% - 32px);opacity:0;transition:opacity .2s var(--m-ease);pointer-events:none}
.toast.show{opacity:1}
.kpis{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:16px;margin-bottom:16px}
.kpi b{display:block;font-weight:400;font-size:28px;letter-spacing:-.04em}
.empty{color:var(--muted);font-size:14px;padding:0;border:0;text-align:left}
.tablewrap{overflow-x:auto}
</style>
</head>
<body>
<a class="skip-link" href="#main">Skip to content</a>
<header class="app-bar">
  <a class="app-wordmark" href="/">E(O)N<sup class="tm">™</sup> MIL</a>
  <nav class="app-nav" aria-label="Main">
    <a href="/" aria-current="page">Console</a>
    <a href="/wrist">Wrist display</a>
  </nav>
</header>
<main id="main" class="app-main">
  <div class="console-head">
    <div>
      <h1>Exercise QUIETFIELD</h1>
      <p class="lead" id="status">Loading the picture…</p>
      <p class="small">Simulation. Not for operational use. Synthetic emitters only. Inside ODIN°<sup class="tm">™</sup>.</p>
    </div>
    <div class="bar">
      <div class="seg" role="group" aria-label="Role">
        <button data-role="operator" aria-pressed="true">Operator</button>
        <button data-role="teamlead" aria-pressed="false">Team lead</button>
      </div>
      <button id="reset" hidden>Reset exercise</button>
      <button id="clock" hidden aria-pressed="false">Start clock</button>
      <button class="primary" id="sweep">Sweep</button>
    </div>
  </div>

  <div class="grid">
    <section>
      <h2>Spectrum picture</h2>
      <svg id="map" viewBox="0 0 4000 4000" role="img" aria-label="Exercise grid with wearers and emitter fixes"></svg>
      <p class="small">4 × 4 km grid. Dots are wearers. Rings are emitter fixes drawn at their 95% error radius: solid for hostile, dashed for friendly, grey for other.</p>
    </section>
    <section>
      <h2>Alerts</h2>
      <ul id="alerts"></ul>
    </section>
    <section class="full">
      <h2>Tracks</h2>
      <div class="tablewrap"><table id="tracks"></table></div>
    </section>
    <section class="full">
      <h2>Counter-drone engagements</h2>
      <ul id="engagements"></ul>
      <p class="small">Operators request. Only the team lead orders. Engagements are refused for friendly, unlocated or stale tracks, and link disruption is refused when it would reach a friendly band. They follow the customer's rules of engagement.</p>
    </section>
    <section class="full">
      <h2>Team</h2>
      <div class="units" id="units"></div>
    </section>
    <section class="full" id="reportBox" hidden>
      <div class="row"><h2>After-action report</h2><span><button id="ledgerDl">Download ledger</button> <button id="report">Refresh report</button></span></div>
      <div id="reportBody"></div>
    </section>
  </div>
</main>
<div class="toast" id="toast" role="status" aria-live="polite"></div>
<script>
const API = "/api/eon";
let role = "operator";
let pic = null;
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const label = { "voice-radio": "Voice radio", "data-link": "Data link", "drone-control": "Drone control", "drone-video": "Drone video", "search-radar": "Search radar", "wideband-noise": "Wideband noise", unknown: "Unknown" };

function toast(text) {
  const t = $("toast");
  t.textContent = text;
  t.classList.add("show");
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => t.classList.remove("show"), 3200);
}

async function call(path, body) {
  const res = await fetch(API + "/" + path, body ? { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ role, ...body }) } : undefined);
  const data = await res.json().catch(() => ({ ok: false, error: "No response." }));
  if (!res.ok || data.ok === false) toast(data.error || "Request failed.");
  return data;
}

async function load() {
  pic = await call("picture?role=" + role);
  if (pic && pic.units) render();
}

function render() {
  const lead = role === "teamlead";
  $("status").textContent = "Tick " + pic.tick + " · " + pic.time.slice(11, 16) + "Z · ledger " + (pic.ledgerOk ? "verified" : "BROKEN") + ", " + pic.ledgerLength + " entries" + (pic.viewer ? " · signed in as " + pic.viewer + (pic.clearance ? " (" + (pic.clearance === "teamlead" ? "team lead" : "operator") + ")" : "") : "");
  // Roles locked by sign-in: only people cleared as team lead see the toggle.
  document.querySelector('[data-role="teamlead"]').hidden = pic.clearance === "operator";
  $("reportBox").hidden = !lead;
  $("reset").hidden = !lead;
  // Live clock: the team lead starts and stops it; everyone sees it running.
  const c = pic.clock;
  $("clock").hidden = !lead;
  $("clock").textContent = c.on ? "Stop clock" : "Start clock";
  $("clock").setAttribute("aria-pressed", String(c.on));
  $("clock").classList.toggle("accent", c.on);
  $("status").textContent += c.on
    ? " · clock running, tick every " + c.tickSeconds + " s (" + c.ticks + "/" + c.limit + ")"
    : c.stoppedBy === "limit" ? " · clock stopped at its " + c.limit + "-tick limit" : "";

  // Map
  const ring = pic.fixes.map((f) => {
    const r = Math.max(40, Math.min(f.errorM, 1500));
    const hostile = f.affiliation === "hostile";
    const stroke = hostile ? "var(--accent)" : f.affiliation === "friendly" ? "var(--ink)" : "var(--muted)";
    return '<g><circle cx="' + f.pos.x + '" cy="' + (4000 - f.pos.y) + '" r="' + r + '" fill="none" stroke="' + stroke + '" stroke-width="' + (hostile ? 16 : 10) + '"' + (f.affiliation === "friendly" ? ' stroke-dasharray="40 30"' : "") + ' opacity=".9"/>' +
      '<text x="' + (f.pos.x + 60) + '" y="' + (4000 - f.pos.y - 60) + '" font-size="110" fill="' + stroke + '">' + esc(f.track) + "</text></g>";
  }).join("");
  const dots = pic.units.map((u) => '<g><circle cx="' + u.pos.x + '" cy="' + (4000 - u.pos.y) + '" r="60" fill="var(--ink)"/><text x="' + (u.pos.x + 90) + '" y="' + (4000 - u.pos.y + 40) + '" font-size="120" fill="var(--ink)">' + esc(u.callsign) + "</text></g>").join("");
  const lines = [1000, 2000, 3000].map((v) => '<line x1="' + v + '" y1="0" x2="' + v + '" y2="4000" stroke="var(--line)" stroke-width="6"/><line x1="0" y1="' + v + '" x2="4000" y2="' + v + '" stroke="var(--line)" stroke-width="6"/>').join("");
  $("map").innerHTML = lines + ring + dots;

  // Alerts
  $("alerts").innerHTML = pic.alerts.length ? pic.alerts.slice(0, 12).map((a) =>
    '<li class="' + (a.acked ? "acked" : "") + '"><div class="row"><span class="tag ' + (a.acked ? "" : "hot") + '">' + esc(a.kind) + " · tick " + a.tick + "</span>" +
    (a.acked ? '<span class="small">Acknowledged</span>' : '<button data-ack="' + a.id + '">Acknowledge</button>') + "</div><div>" + esc(a.text) + "</div></li>").join("")
    : '<li class="empty">Nothing yet. Sweep to listen.</li>';

  // Tracks
  const engaged = new Set(pic.engagements.filter((e) => ["requested", "ordered"].includes(e.status)).map((e) => e.track));
  $("tracks").innerHTML = pic.fixes.length ? "<tr><th>Track</th><th>Class</th><th>ID</th><th>Fix</th><th>±95%</th><th>Bearings</th><th></th></tr>" + pic.fixes.map((f) => {
    const drone = f.cls === "drone-control" || f.cls === "drone-video";
    const can = drone && f.affiliation === "hostile" && !engaged.has(f.track) && pic.tick - f.tick <= 1;
    const verb = lead ? "" : "Request ";
    const act = drone && f.affiliation === "hostile"
      ? '<div class="bar"><button data-engage="' + f.track + '" data-method="disrupt"' + (can ? "" : " disabled") + ">" + verb + "Disrupt</button>" +
        '<button data-engage="' + f.track + '" data-method="handoff"' + (can ? "" : " disabled") + ">" + verb + "WARDEN<sup>™</sup></button></div>"
      : "";
    return "<tr><td>" + esc(f.track) + "</td><td>" + esc(label[f.cls] || f.cls) + "</td><td>" + esc(f.affiliation) + "</td><td>" + Math.round(f.pos.x) + " E " + Math.round(f.pos.y) + " N</td><td>" + f.errorM + " m</td><td>" + f.bearings + " (t" + f.tick + ")</td><td>" + act + "</td></tr>";
  }).join("") : '<tr><td class="empty">No fixes yet. Two or more wearers must share bearings on the same track.</td></tr>';

  // Engagements
  $("engagements").innerHTML = pic.engagements.length ? pic.engagements.map((e) =>
    '<li><div class="row"><span class="tag ' + (e.status === "requested" ? "hot" : "") + '">' + esc(e.id) + " · " + esc(e.method) + " · " + esc(e.status) + "</span>" +
    (lead && e.status === "requested" ? '<div class="bar"><button class="accent" data-decide="' + e.id + '" data-d="approve">Order</button><button data-decide="' + e.id + '" data-d="reject">Reject</button></div>' : "") +
    "</div><div>" + esc(e.text) + "</div>" +
    (e.requestedByPerson || e.decidedBy ? '<div class="small">' + [e.requestedByPerson ? "Requested by " + esc(e.requestedByPerson) : "", e.decidedBy ? (e.status === "rejected" ? "Rejected by " : "Ordered by ") + esc(e.decidedBy) : ""].filter(Boolean).join(" · ") + "</div>" : "") +
    "</li>").join("") : '<li class="empty">No engagements.</li>';

  // Units
  $("units").innerHTML = pic.units.map((u) => {
    const low = u.batteryPct < 25;
    const h = u.health;
    // Each failing on-device check, with what to do about it.
    const failing = h.checks.filter((c) => !c.ok).map((c) =>
      '<p class="small" style="margin:0 0 8px"><span class="tag hot">' + esc(c.label) + " · since tick " + c.since + "</span><br>" + esc(c.finding || "") + ". " + esc(c.recommendation || "") + "</p>").join("");
    const emcon = lead
      ? '<select data-emcon="' + u.id + '" aria-label="Emission control for ' + esc(u.callsign) + '">' + ["normal", "reduced", "silent"].map((p) => "<option" + (p === u.profile ? " selected" : "") + ">" + p + "</option>").join("") + "</select>"
      : esc(u.profile);
    const scan = '<select data-scan="' + u.id + '" aria-label="Scan mode for ' + esc(u.callsign) + '">' + ["wide", "economy"].map((m) => "<option" + (m === u.scan ? " selected" : "") + ">" + m + "</option>").join("") + "</select>" + (u.scanAuto ? ' <span class="small">auto</span>' : "");
    return '<div class="unit"><div class="row"><b style="font-weight:500">' + esc(u.callsign) + '</b><span class="small">' + esc(u.id) + "</span></div><dl>" +
      "<dt>Link</dt><dd>" + esc(u.link.pathLabel) + " · " + u.link.sinrDb + " dB " + esc(u.link.status) + (u.link.noiseRiseDb >= 6 ? " · noise +" + u.link.noiseRiseDb + " dB" : "") + "</dd>" +
      "<dt>Nav</dt><dd>" + esc(u.nav.status) + " · " + esc(u.nav.source) + "</dd>" +
      "<dt>EMCON</dt><dd>" + emcon + "</dd>" +
      "<dt>Visible to</dt><dd>" + (u.detectableKm ? u.detectableKm + " km" : "not emitting") + (u.held ? " · " + u.held + " held" : "") + "</dd>" +
      "<dt>Scan</dt><dd>" + scan + "</dd>" +
      "<dt>Battery</dt><dd>" + Math.round(u.batteryPct) + "% · " + u.enduranceH + ' h<div class="meter' + (low ? " low" : "") + '"><i style="width:' + u.batteryPct + '%"></i></div></dd>' +
      "<dt>Device</dt><dd" + (h.band !== "healthy" ? ' class="hot"' : "") + ">" + h.score + "/100 · " + esc(h.band) + (h.quarantined ? " · quarantined" : "") + (u.withheld ? " · " + u.withheld + " withheld" : "") + "</dd>" +
      "</dl>" + failing +
      '<div class="bar"><button data-swap="' + u.id + '">Swap battery</button>' +
      (lead ? '<button data-quarantine="' + u.id + '" data-on="' + String(!h.quarantined) + '"' + (h.band === "compromised" && !h.quarantined ? ' class="accent"' : "") + ">" + (h.quarantined ? "Restore reports" : "Quarantine") + "</button>" : "") +
      "</div></div>";
  }).join("");
}

async function loadReport() {
  const r = await call("report?role=teamlead");
  if (!r.ok) return;
  const s = r.data.summary;
  const kpi = (v, l) => '<div class="kpi"><b>' + esc(v) + '</b><span class="small">' + esc(l) + "</span></div>";
  $("reportBody").innerHTML = '<div class="kpis">' +
    kpi(s.emittersDetected, "Emitters detected") + kpi(s.classifiedRight, "Classified right") + kpi(s.fixesInsideEllipse, "Fixes inside ellipse") +
    kpi(s.medianFixMissM === null ? "—" : s.medianFixMissM + " m", "Median fix miss") + kpi(s.linkAvailabilityPct + "%", "Link availability") +
    kpi(s.hostileDronesWarned, "Hostile drones warned") + kpi(s.engagements.effective + s.engagements.intercepted + "/" + s.engagements.ordered, "Engagements resolved") +
    kpi(String(s.friendlyEngaged), "Friendly engaged") + "</div>" +
    "<ul>" + r.data.lessons.map((l) => "<li>" + esc(l) + "</li>").join("") + "</ul>";
}

document.addEventListener("click", async (ev) => {
  const b = ev.target.closest("button");
  if (!b || b.disabled) return;
  if (b.dataset.role) {
    role = b.dataset.role;
    document.querySelectorAll("[data-role]").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
    $("reportBody").innerHTML = "";
    return load();
  }
  b.disabled = true;
  try {
    if (b.id === "sweep") {
      const r = await call("sweep", {});
      if (r.ok && r.data.alerts.length) toast(r.data.alerts.length + " new alert" + (r.data.alerts.length > 1 ? "s" : "") + ".");
    } else if (b.dataset.ack) await call("ack", { alertId: b.dataset.ack });
    else if (b.dataset.engage) {
      const r = await call("engagements", { track: b.dataset.engage, method: b.dataset.method });
      if (r.ok) toast(r.data.text);
    } else if (b.dataset.decide) {
      const r = await call("decisions", { engagementId: b.dataset.decide, decision: b.dataset.d });
      if (r.ok) toast(r.data.text);
    } else if (b.dataset.quarantine) {
      const on = b.dataset.on === "true";
      const r = await call("quarantine", { unitId: b.dataset.quarantine, on });
      if (r.ok) toast(r.data.callsign + (on ? " quarantined: its reports are withheld from the picture." : " restored to the picture."));
    } else if (b.dataset.swap) {
      const r = await call("battery", { unitId: b.dataset.swap });
      if (r.ok) toast(r.data.callsign + " battery swapped.");
    } else if (b.id === "clock") {
      const on = !(pic && pic.clock && pic.clock.on);
      const r = await call("clock", { on });
      if (r.ok) toast(on ? "Clock started: the exercise sweeps itself every " + r.data.tickSeconds + " s." : "Clock stopped.");
    } else if (b.id === "reset") {
      // Two clicks: the first arms the button for five seconds, the second resets.
      if (!b.dataset.armed) {
        b.dataset.armed = "1";
        b.textContent = "Confirm reset?";
        b.classList.add("accent");
        clearTimeout(b.disarm);
        b.disarm = setTimeout(() => { delete b.dataset.armed; b.textContent = "Reset exercise"; b.classList.remove("accent"); }, 5000);
        return;
      }
      clearTimeout(b.disarm);
      delete b.dataset.armed;
      b.textContent = "Reset exercise";
      b.classList.remove("accent");
      const r = await call("reset", {});
      if (r.ok) {
        toast("Exercise reset to tick 0.");
        $("reportBody").innerHTML = "";
      }
    } else if (b.id === "report") return await loadReport();
    else if (b.id === "ledgerDl") {
      // The signed ledger with its public key, for checking outside E(O)N.
      const r = await call("ledger?role=teamlead");
      if (!r.ok) return;
      const url = URL.createObjectURL(new Blob([JSON.stringify(r, null, 2)], { type: "application/json" }));
      const a = Object.assign(document.createElement("a"), { href: url, download: "eon-ledger-tick-" + r.tick + ".json" });
      document.body.append(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      toast("Ledger downloaded: " + r.length + " entries, head " + r.head.slice(0, 12) + "…");
      return;
    }
    await load();
    if (role === "teamlead" && $("reportBody").innerHTML) await loadReport();
  } finally {
    b.disabled = false;
  }
});

document.addEventListener("change", async (ev) => {
  const s = ev.target;
  if (s.dataset.emcon) await call("emcon", { unitId: s.dataset.emcon, profile: s.value });
  if (s.dataset.scan) await call("scan", { unitId: s.dataset.scan, mode: s.value });
  await load();
});

load();

// Keep the picture current while the clock (or another viewer) moves it on.
// Re-render only when something changed, and never under an open dropdown.
setInterval(async () => {
  if (document.hidden || !pic) return;
  if (document.activeElement && document.activeElement.tagName === "SELECT") return;
  try {
    const res = await fetch(API + "/picture?role=" + role, { cache: "no-store" });
    if (!res.ok) return;
    const next = await res.json();
    if (next.tick !== pic.tick || next.ledgerLength !== pic.ledgerLength || next.clock.on !== pic.clock.on) {
      pic = next;
      render();
      if (role === "teamlead" && $("reportBody").innerHTML) await loadReport();
    }
  } catch {}
}, 5000);
</script>
</body>
</html>`;
