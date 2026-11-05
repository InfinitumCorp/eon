# E(O)N™ MIL

Exercise backend and console for E(O)N™ MIL, the wearable electronic-warfare and counter-drone layer of ODIN°™ (Infinitum Corporation®).

It runs one simulated team of four wearers through Exercise QUIETFIELD: listen to the spectrum, keep the team link alive, control each wearer's signature, defend against hostile drones and share everything into one picture. A private, Ed25519-signed hash chain records every detection, fix, link switch, EMCON change and engagement.

This is a simulation. It is not for operational use. All emitters, frequencies and signal features are synthetic placeholders, not a threat library. Counter-drone engagements are decisions and recorded outcomes. No signal is modelled or generated.

Product page: https://infinitum-corporation.vercel.app/products/eon

## What it does

| Capability | In the exercise |
|---|---|
| Electronic support | Each wearer senses synthetic emitters with a log-distance path-loss model, takes a bearing (3° σ) and classifies the signal with an on-device nearest-centroid classifier. |
| Cooperative geolocation | Bearings shared by two or more wearers are fused by range-weighted least squares. Each fix carries a 95% error radius; over 100 seeds, 96% of true positions fall inside it (`npm run calibrate`). |
| Electronic protection | In-band noise rise is measured on every path of the ÆTHER™ MIL team link. Under jamming a wearer hops to the clearest usable path, then returns to primary once it is clear. |
| Resilient navigation | GNSS is checked against inertial. A spoofed fix is caught and the wearer holds position on inertial. |
| Signature control | Normal, reduced and silent EMCON profiles. Each wearer shows how far away their own emissions can be picked up. Silent wearers hold detections and release them when they speak again. |
| Counter-drone | Tracks are called friendly (against the ODIN° friendly registry), hostile (drone links) or unknown. Hostile drones raise a team-wide warning with a bearing and a fix. An operator may request an engagement; only the team lead orders one. |
| Rules of engagement | An engagement is refused if the track is friendly, not a drone, unlocated, has a stale fix, has not been heard in the last tick, is on an airframe already defeated, or (for link disruption) would reach a friendly or team band. Every refusal is on the ledger. |
| Power management | Battery and endurance per wearer. Below 25% a wearer drops to economy scan (half the revisit, less drain); a battery swap restores wide scan. |
| After-action report | Exercise control scores the shared picture against ground truth: detection latency, classification, fix accuracy against the stated ellipse, link availability, drone warnings, engagement outcomes, friendly engagements and spoof detection time, plus lessons. |

### Scenario timeline (seed 7)

| Tick | Event |
|---|---|
| 1 | Voice radio, data link, search radar and a friendly DAEMON™ MIL relay drone on the air. ASH 1-4 starts on a tired battery and drops to economy scan. |
| 2 | Hostile drone (control and video links) appears to the east. |
| 3–5 | Wideband noise on the L-band team link. ASH 1-2, the most exposed, hops to UHF. |
| 4–6 | GNSS spoofing against ASH 1-3. |
| 8 | The hostile drone leaves if it has not been engaged. |

## Roles

Roles are exercise clearances, not accounts.

- **Operator**: sweep, acknowledge alerts, set scan mode, swap batteries, request engagements. Sees the ledger status, not its entries.
- **Team lead**: everything above, plus EMCON, ordering or rejecting engagements, the ledger and the after-action report.

## HTTP

| Method | Path | Body or query |
|---|---|---|
| GET | `/api/eon/health` | — |
| GET | `/api/eon/picture` | `?role=operator\|teamlead` |
| GET | `/api/eon/ledger` | `?role=teamlead` |
| GET | `/api/eon/report` | `?role=teamlead` |
| POST | `/api/eon/sweep` | `{ role }` |
| POST | `/api/eon/emcon` | `{ role, unitId, profile: normal\|reduced\|silent }` (team lead) |
| POST | `/api/eon/scan` | `{ role, unitId, mode: wide\|economy }` |
| POST | `/api/eon/battery` | `{ role, unitId }` |
| POST | `/api/eon/ack` | `{ role, alertId }` |
| POST | `/api/eon/engagements` | `{ role, track, method: disrupt\|handoff }` |
| POST | `/api/eon/decisions` | `{ role, engagementId, decision: approve\|reject, note? }` (team lead) |
| POST | `/api/eon/reset` | `{ role }` (team lead) |

The console is served at `/`.

## Run it

Node 22.18 or later. There are no dependencies.

```bash
npm test
```

```bash
npm run dev
```

Then open http://localhost:8787.

## Layout

```
src/worker.ts              Cloudflare Worker entry: console at /, API at /api/eon/*
src/console.ts             The console page (BUILD_RULES styling)
src/lib/eon/scenario.ts    Exercise QUIETFIELD: units, synthetic emitters, link paths, scripts
src/lib/eon/rf.ts          Path loss, bearings, classifier, weighted bearing fusion
src/lib/eon/service.ts     The exercise: sense, protect, conceal, share, counter-drone, power, report
src/lib/eon/ledger.ts      Private Ed25519-signed SHA-256 hash chain
src/lib/eon/http.ts        HTTP contract
scripts/serve.ts           Local preview on Node
scripts/seeds.ts           Fix-ellipse calibration across 100 seeds
```

State lives in the Worker isolate's memory, as in ODIN°™. An isolate restart resets the exercise. Move it to a Durable Object if a session must survive restarts or be shared across isolates.

## Cloudflare

- Project name: `eon`
- Config: `wrangler.toml`
- Worker entry: `src/worker.ts`
- Deploy, once a Cloudflare API token is available:

```bash
npx wrangler deploy
```

No secrets are required. Do not commit tokens.

## Rules

See [BUILD_RULES.md](BUILD_RULES.md).
