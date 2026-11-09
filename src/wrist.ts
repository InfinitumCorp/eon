/**
 * E(O)N™ MIL wrist display. One watch-sized page per wearer, /wrist?unit=eon-1.
 * Glanceable: the nearest live hostile drone as a north-up bearing arrow and
 * range, the newest open alert with one-tap acknowledge, and link, nav and
 * battery. Polls /api/eon/wrist every 3 s. Styled to BUILD_RULES.md.
 */
export const WRIST_HTML = /* html */ `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>E(O)N™ MIL · Wrist</title>
<meta name="description" content="E(O)N™ MIL wrist display. Simulated. Not for operational use.">
<style>
:root{--ink:#111820;--muted:#52606b;--line:#d6dce1;--accent:#2454dd;--paper:#fff;--soft:#fff;--m-ease:cubic-bezier(.22,1,.36,1)}
*{box-sizing:border-box}
html,body{margin:0;background:var(--paper);color:var(--ink);font:400 16px/1.4 "Helvetica Neue",Helvetica,Arial,sans-serif}
sup{font-size:.6em}
.face{max-width:360px;margin:0 auto;padding:16px}
.top{display:flex;justify-content:space-between;align-items:center;gap:8px}
.mark{font-weight:500;font-size:15px}
select{font:inherit;font-size:14px;border:1px solid var(--line);background:var(--paper);color:var(--ink);padding:4px 6px}
.dial{position:relative;margin:16px auto 8px;width:240px;max-width:100%;aspect-ratio:1;border:1px solid var(--line);border-radius:50%;background:var(--soft);display:grid;place-items:center}
.dial.hot{border-color:var(--accent)}
.n{position:absolute;top:6px;left:50%;transform:translateX(-50%);font-size:12px;color:var(--muted)}
.arrow{position:absolute;inset:0;transition:transform .4s var(--m-ease)}
.arrow svg{width:100%;height:100%;display:block}
.read{position:relative;text-align:center;background:var(--paper);border-radius:50%;width:56%;aspect-ratio:1;display:grid;place-content:center;border:1px solid var(--line)}
.big{font-size:36px;letter-spacing:-.05em;line-height:1}
.sub{font-size:12px;color:var(--muted)}
.state{text-align:center;font-size:18px;letter-spacing:-.015em;margin:4px 0 12px;min-height:1.4em}
.state.hot{color:var(--accent)}
.alert{border:1px solid var(--line);padding:12px;display:flex;gap:12px;align-items:center;justify-content:space-between;min-height:64px}
.alert.hot{border-color:var(--accent)}
.alert p{margin:0;font-size:14px}
button{font:inherit;font-size:14px;border-radius:0;border:1px solid var(--ink);background:var(--ink);color:var(--paper);padding:10px 16px;cursor:pointer;flex:none}
button:focus-visible,select:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
button:disabled{opacity:.4;cursor:default}
dl{display:grid;grid-template-columns:repeat(2,1fr);gap:8px;margin:12px 0 0}
dl>div{border:1px solid var(--line);padding:8px;text-align:center;min-width:0}
dt{font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:.04em}
dd{margin:2px 0 0;font-size:14px;overflow-wrap:anywhere}
dd.hot{color:var(--accent)}
.meter{height:4px;background:var(--line);overflow:hidden;margin-top:4px}
.meter i{display:block;height:100%;background:var(--ink)}
.meter.low i{background:var(--accent)}
.foot{margin-top:12px;font-size:11px;color:var(--muted);text-align:center}
.foot a{color:inherit}
@media (prefers-reduced-motion:reduce){.arrow{transition:none}}
</style>
</head>
<body>
<main class="face">
  <div class="top">
    <span class="mark">E(O)N<sup class="tm">™</sup> MIL</span>
    <label><span class="sub" style="position:absolute;left:-9999px">Wearer</span>
      <select id="unit" aria-label="Wearer">
        <option value="eon-1">ASH 1-1</option>
        <option value="eon-2">ASH 1-2</option>
        <option value="eon-3">ASH 1-3</option>
        <option value="eon-4">ASH 1-4</option>
      </select>
    </label>
  </div>

  <div class="dial" id="dial" role="img" aria-label="No hostile drone">
    <span class="n" aria-hidden="true">N</span>
    <div class="arrow" id="arrow" hidden aria-hidden="true">
      <svg viewBox="0 0 100 100"><path d="M50 6 L57 20 L43 20 Z" fill="#2454dd"/></svg>
    </div>
    <div class="read">
      <div class="big" id="range">—</div>
      <div class="sub" id="bearing">clear</div>
    </div>
  </div>
  <div class="state" id="state" aria-live="polite">Connecting…</div>

  <div class="alert" id="alertBox">
    <p id="alertText">No open alerts.</p>
    <button id="ack" hidden>Ack</button>
  </div>

  <dl>
    <div><dt>Link</dt><dd id="link">—</dd></div>
    <div><dt>Nav</dt><dd id="nav">—</dd></div>
    <div><dt>Battery</dt><dd id="batt">—</dd><div class="meter" id="meter"><i id="meterFill" style="width:0"></i></div></div>
    <div><dt>Device</dt><dd id="device">—</dd></div>
  </dl>

  <p class="foot"><span id="clock">—</span> · Simulated exercise. Not for operational use. · <a href="/">Console</a></p>
</main>
<script>
const API = "/api/eon";
const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);
const UNITS = ["eon-1", "eon-2", "eon-3", "eon-4"];
let unit = UNITS.includes(params.get("unit")) ? params.get("unit") : "eon-1";
let alertId = null;
$("unit").value = unit;
$("unit").addEventListener("change", () => {
  unit = $("unit").value;
  history.replaceState(null, "", "?unit=" + unit);
  refresh();
});

function km(m) { return m >= 1000 ? (m / 1000).toFixed(1) + " km" : m + " m"; }

function render(w) {
  const t = w.threat;
  $("dial").classList.toggle("hot", !!t);
  $("state").classList.toggle("hot", !!t);
  if (t) {
    $("arrow").hidden = false;
    $("arrow").style.transform = "rotate(" + t.bearingDeg + "deg)";
    $("range").textContent = km(t.distanceM);
    $("bearing").textContent = t.bearingDeg + "° " + t.compass + " ±" + km(Math.round(t.errorM));
    $("state").textContent = "Hostile drone " + t.track + (w.moreThreats ? " +" + w.moreThreats + " more" : "");
    $("dial").setAttribute("aria-label", "Hostile drone " + t.track + ", " + km(t.distanceM) + " bearing " + t.bearingDeg + " degrees " + t.compass);
  } else {
    $("arrow").hidden = true;
    $("range").textContent = "—";
    $("bearing").textContent = "clear";
    $("state").textContent = "No hostile drone";
    $("dial").setAttribute("aria-label", "No hostile drone");
  }
  const a = w.alert;
  alertId = a ? a.id : null;
  $("alertBox").classList.toggle("hot", !!a);
  $("alertText").textContent = a ? (w.unacked > 1 ? "(" + w.unacked + ") " : "") + a.text : "No open alerts.";
  $("ack").hidden = !a;
  const u = w.unit;
  $("link").textContent = u.link.pathLabel + " " + u.link.status;
  $("link").classList.toggle("hot", u.link.status !== "clear");
  $("nav").textContent = u.nav.status === "assured" ? "GNSS ok" : "Inertial";
  $("nav").classList.toggle("hot", u.nav.status !== "assured");
  $("batt").textContent = Math.round(u.batteryPct) + "% · " + u.enduranceH + " h";
  $("meterFill").style.width = Math.max(0, Math.min(100, u.batteryPct)) + "%";
  $("meter").classList.toggle("low", u.batteryPct < 25);
  const h = u.health;
  $("device").textContent = h.score + "/100 " + h.band + (h.quarantined ? " · quarantined" : "");
  $("device").classList.toggle("hot", h.band !== "healthy");
  $("clock").textContent = u.callsign + " · tick " + w.tick + " · " + w.time.slice(11, 16) + "Z";
}

let busy = false;
async function refresh() {
  if (busy) return;
  busy = true;
  try {
    const res = await fetch(API + "/wrist?unit=" + encodeURIComponent(unit), { cache: "no-store" });
    const body = await res.json();
    if (body.ok) render(body.data);
    else $("state").textContent = body.error || "Unavailable.";
  } catch {
    $("state").textContent = "Link to team lost. Retrying…";
  } finally {
    busy = false;
  }
}

$("ack").addEventListener("click", async () => {
  if (!alertId) return;
  $("ack").disabled = true;
  try {
    await fetch(API + "/ack", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ role: "operator", alertId }) });
  } finally {
    $("ack").disabled = false;
    refresh();
  }
});

refresh();
setInterval(() => { if (!document.hidden) refresh(); }, 3000);
document.addEventListener("visibilitychange", () => { if (!document.hidden) refresh(); });
</script>
</body>
</html>`;
