# E(O)N™ MIL

Exercise backend and console for E(O)N™ MIL, the wearable electronic-warfare and counter-drone layer of ODIN°™ (Infinitum Corporation®).

It runs one simulated team of four wearers through Exercise QUIETFIELD: listen to the spectrum, keep the team link alive, control each wearer's signature, defend against hostile drones and share everything into one picture. A private, Ed25519-signed hash chain records every detection, fix, link switch, EMCON change and engagement.

This is a simulation. It is not for operational use. All emitters, frequencies and signal features are synthetic placeholders, not a threat library. Counter-drone engagements are decisions and recorded outcomes. No signal is modelled or generated.

Live: https://eon.infinitumcorp.workers.dev

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
| Wrist display | Each wearer gets a watch-sized page at `/wrist?unit=eon-1`: a north-up arrow and range to the nearest live hostile drone (located, heard in the last tick, airframe not yet defeated) with its error radius, the newest open alert with one-tap acknowledge, and link, nav and battery. It refreshes every 3 s. |
| Device integrity | Each wearer's device checks itself every tick for a rooted or jailbroken OS, a debugger attached to the app, a hooking framework in the app, and an emulated environment. Only the outcome leaves the device: pass or fail per check and one 0–100 health score (root −40, hooking −35, emulator −30, debugger −25; healthy ≥ 90, degraded 60–89, compromised < 60). Each new failure raises an alert to that wearer and the team with a recommendation. The team lead can quarantine a device, which withholds its reports from the shared picture; the after-action report counts every tick a compromised device's reports still flowed. In the exercise the signals are scripted (ASH 1-2 has a debug session at ticks 2–3; ASH 1-4 is hooked and rooted from tick 5); on fielded hardware the same checks would read the OS's own attestation. |
| ODIN°™ feed | `GET /api/eon/feed/odin` publishes every located emitter as an ODIN track (`id, name, source, note, grid, confidence, classification`) and as a Lattice entity, the two shapes ODIN already uses. Read-only: ODIN pulls; E(O)N never writes into ODIN. Only emitter fixes leave the team: wearer positions, device health, EMCON and engagements awaiting a decision stay inside. Grids are in the QUIETFIELD frame (metres); no mapping to ODIN's range grid is assumed. The feed cites the ledger head and tick it reflects. ODIN°™ is not deployed yet, so nothing pulls it today; it would use a Cloudflare Access service token. |
| After-action report | Exercise control scores the shared picture against ground truth: detection latency, classification, fix accuracy against the stated ellipse, link availability, drone warnings, engagement outcomes, friendly engagements and spoof detection time, plus lessons. |

### Scenario timeline (seed 7)

| Tick | Event |
|---|---|
| 1 | Voice radio, data link, search radar and a friendly DAEMON™ MIL relay drone on the air. ASH 1-4 starts on a tired battery and drops to economy scan. |
| 2 | Hostile drone (control and video links) appears to the east. |
| 2–3 | A debug session is attached to ASH 1-2's device (health 75, degraded). |
| 3–5 | Wideband noise on the L-band team link. ASH 1-2, the most exposed, hops to UHF. |
| 4–6 | GNSS spoofing against ASH 1-3. |
| 5 → | ASH 1-4's device is hooked and rooted (health 25, compromised) until the end. |
| 8 | The hostile drone leaves if it has not been engaged. |

## Roles

Roles are locked to sign-ins. With Cloudflare Access on, only the emails in `TEAM_LEADS` (`wrangler.toml`, comma-separated, case-insensitive) are cleared as team lead; everyone else who signs in is an operator. The Worker passes the clearance to the exercise in an `x-eon-clearance` header it always strips from client requests, and the API refuses any team-lead request (picture, ledger, report, EMCON, orders, reset) from someone not cleared, with a 403. The console hides the Team lead toggle for operators. With Access on and `TEAM_LEADS` empty, no one is team lead. Local runs have no Access, so any role goes.

Who acts comes from Cloudflare Access: the Worker verifies the Access token (RS256 signature against the team's published keys, issuer, audience, expiry) on every request and refuses the request if it does not check out. The verified email is kept with each action in the log and written as `by` on every ledger entry a person caused, and engagements record who requested and who ordered or rejected them. The Worker strips any `x-eon-person` header a client sends, so no one can name themselves. Local runs have no Access and name no one.

- **Operator**: sweep, acknowledge alerts, set scan mode, swap batteries, request engagements. Sees the ledger status, not its entries.
- **Team lead**: everything above, plus EMCON, ordering or rejecting engagements, quarantining a device, the ledger and the after-action report.

## HTTP

| Method | Path | Body or query |
|---|---|---|
| GET | `/api/eon/health` | — |
| GET | `/api/eon/picture` | `?role=operator\|teamlead` |
| GET | `/api/eon/wrist` | `?unit=eon-1` (one wearer's wrist view) |
| GET | `/api/eon/feed/odin` | — (read-only feed for ODIN°™) |
| GET | `/api/eon/ledger` | `?role=teamlead` |
| GET | `/api/eon/report` | `?role=teamlead` |
| POST | `/api/eon/sweep` | `{ role }` |
| POST | `/api/eon/emcon` | `{ role, unitId, profile: normal\|reduced\|silent }` (team lead) |
| POST | `/api/eon/scan` | `{ role, unitId, mode: wide\|economy }` |
| POST | `/api/eon/battery` | `{ role, unitId }` |
| POST | `/api/eon/ack` | `{ role, alertId }` |
| POST | `/api/eon/engagements` | `{ role, track, method: disrupt\|handoff }` |
| POST | `/api/eon/decisions` | `{ role, engagementId, decision: approve\|reject, note? }` (team lead) |
| POST | `/api/eon/quarantine` | `{ role, unitId, on: true\|false }` (team lead) |
| POST | `/api/eon/reset` | `{ role }` (team lead) |

The console is served at `/` and the wrist display at `/wrist`.

## Run it

Node 22.18 or later. There are no dependencies.

```bash
npm test
```

```bash
npm run dev
```

Then open http://localhost:8787 (console) or http://localhost:8787/wrist?unit=eon-1 (wrist display).

GitHub Actions runs `npm test` on every push to main and on pull requests (`.github/workflows/test.yml`).

## Layout

```
src/worker.ts              Cloudflare Worker entry: console at /, wrist at /wrist, API at /api/eon/*
src/console.ts             The console page (BUILD_RULES styling)
src/wrist.ts               The per-wearer wrist display
src/lib/eon/scenario.ts    Exercise QUIETFIELD: units, synthetic emitters, link paths, scripts
src/lib/eon/rf.ts          Path loss, bearings, classifier, weighted bearing fusion
src/lib/eon/service.ts     The exercise: sense, protect, conceal, share, counter-drone, power, report
src/lib/eon/ledger.ts      Private Ed25519-signed SHA-256 hash chain
src/lib/eon/http.ts        HTTP contract: parses requests into actions
src/lib/eon/exercise.ts    Action log, replay and the shared exercise session
src/lib/eon/access.ts      Cloudflare Access token verification (who is acting)
src/lib/eon/integrity.ts   On-device integrity checks, weights, recommendations, health score
scripts/serve.ts           Local preview on Node
scripts/seeds.ts           Fix-ellipse calibration across 100 seeds
scripts/handoff.ts         Writes handoff/eon_work.js and .py from eon_work.ts
handoff/                   Handoff record (TypeScript, JavaScript, Python) for the next person or model
```

State lives in one Durable Object (`EonExercise`), so every viewer sees the same exercise. The exercise is deterministic from its seed, so its state is just the ordered log of actions (sweeps, EMCON changes, engagements and so on) kept in the object's storage. When the object starts again after an eviction or a deploy, it replays the log and rebuilds the same picture, ledger hashes included. Requests are applied one at a time, so the log order is the order the exercise saw them. Reset clears the log. Local runs (`npm run dev`) keep the log in memory.

## Cloudflare

- Project name: `eon`
- Production URL: https://eon.infinitumcorp.workers.dev (account subdomain `infinitumcorp`)
- Access: Cloudflare Access protects every Worker on the account (production and previews) with the "Cloudflare account" policy, so only members of the Cloudflare account can sign in. Add people under Manage Account → Members, or change the policy in Zero Trust.
- Identity: `ACCESS_TEAM_DOMAIN` and `ACCESS_AUD` in `wrangler.toml` turn on Access token checks (`src/lib/eon/access.ts`). `TEAM_LEADS` lists who may act as team lead; edit it and redeploy to change who leads. If the Access application is recreated, update `ACCESS_AUD` to its new audience tag.
- Config: `wrangler.toml`
- Worker entry: `src/worker.ts`
- Durable Object: `EonExercise` (binding `EXERCISE`, SQLite-backed, migration `v1`)
- Deploy (after `npx wrangler login`, or with `CLOUDFLARE_API_TOKEN` set):

```bash
npx wrangler deploy
```

No secrets are required. Do not commit tokens.

## Rules

See [BUILD_RULES.md](BUILD_RULES.md).

## Labyrinth client repositories

Explicit Cumulus ID-authenticated artifact save/load SDK and `/api/labyrinth` relay.
Existing product auth remains unchanged. [Integration and rollout contract](LABYRINTH.md).
