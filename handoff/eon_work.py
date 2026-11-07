"""Handoff of the E(O)N™ MIL exercise backend.

Generated from eon_work.ts by scripts/handoff.ts. Do not edit by hand.

    from eon_work import brief, WORK, API, RULES

    print(brief())

This is a record of what was written. It is not the running service.
It models no signal, no jamming, no weapon and no real location.
"""

REPO = "https://github.com/InfinitumCorp/eon"

HEAD = "32a8421"

EXERCISE = "QUIETFIELD"

PRODUCT = "E(O)N™ MIL"

PARENT = "ODIN°™"

URL = "https://eon.infinitumcorp.workers.dev"

ROLES = {
    "operator": {
        "may": "Sweep, acknowledge alerts, set scan mode, swap batteries, request engagements. Sees the ledger status, not its entries.",
    },
    "teamlead": {
        "may": "Everything an operator may, plus EMCON, ordering or rejecting engagements, quarantining a device, the ledger, the after-action report and reset.",
    },
}

RULES = {
    "whatItIs": "A simulated wearable electronic-warfare and counter-drone team of four in one fictional exercise. Sense, protect, conceal, share, decide. Private ledger. Human orders.",
    "notForOperationalUse": True,
    "noSignalModelled": True,
    "syntheticEmittersOnly": True,
    "noRealLocations": True,
    "noDataSale": True,
    "privateLedger": True,
    "engagements": "An operator may request. Only the team lead orders. Rules-of-engagement refusals are recorded. Outcomes are exercise results, not modelled effects.",
    "identity": "Cloudflare Access signs every request. The Worker verifies the token and records the signed-in email on each decision.",
    "deviceIntegrity": "Checks run on each wearer's device; only pass or fail per check and one health score leave it. In this exercise the signals are scripted. A browser cannot inspect a real phone.",
    "host": "Cloudflare Workers, project eon, one Durable Object. Deployed behind Cloudflare Access.",
    "backend": "Live state in the Durable Object. The shared Infinitum Corp Supabase project (eon schema) holds only the team-lead roster and a record of finished runs; no picture data.",
}

COMMITS = [
    {
        "sha": "80763e7",
        "did": "Exercise backend, RF model, counter-drone, power, after-action report, ledger and console.",
    },
    {
        "sha": "23b20eb",
        "did": "Live Cloudflare URL recorded.",
    },
    {
        "sha": "1a547b6",
        "did": "Cloudflare Access noted on the deployed console.",
    },
    {
        "sha": "1fea1c6",
        "did": "One Durable Object holds the exercise as a replayable action log.",
    },
    {
        "sha": "583b30c",
        "did": "Two-step exercise reset for the team lead.",
    },
    {
        "sha": "cdb66f4",
        "did": "Per-wearer wrist display.",
    },
    {
        "sha": "d6ecbbb",
        "did": "GitHub Actions runs the tests on every push and pull request.",
    },
    {
        "sha": "e21df8a",
        "did": "The signed-in person is named on every decision.",
    },
    {
        "sha": "7259190",
        "did": "Team lead role locked to named sign-ins.",
    },
    {
        "sha": "32a8421",
        "did": "On-device integrity checks with one health score and quarantine.",
    },
    {
        "sha": "0be9a36",
        "did": "BUILD_RULES: Conductor renamed :\\ARCHITECT\\™.",
    },
]

FILES = {
    "src/worker.ts": "Cloudflare Worker entry. Verifies Access, sets the person and clearance, routes to the Durable Object.",
    "src/console.ts": "White console page.",
    "src/wrist.ts": "Per-wearer wrist display page.",
    "src/lib/eon/scenario.ts": "Units, synthetic emitters, link paths and the scripted events.",
    "src/lib/eon/rf.ts": "Path loss, bearings, classifier, weighted bearing fusion.",
    "src/lib/eon/service.ts": "The exercise: sense, protect, conceal, share, counter-drone, power, integrity, report.",
    "src/lib/eon/integrity.ts": "On-device checks, weights, recommendations, health score.",
    "src/lib/eon/service.ts#odinFeed": "Read-only ODIN°™ feed: emitter fixes as ODIN tracks and Lattice entities.",
    "src/lib/eon/ledger.ts": "Private Ed25519-signed SHA-256 hash chain.",
    "src/lib/eon/access.ts": "Cloudflare Access JWT verification.",
    "src/lib/eon/http.ts": "HTTP contract. Parses requests into actions and enforces clearance.",
    "src/lib/eon/exercise.ts": "Action log, replay and the shared exercise session.",
    "src/lib/eon/supabase.ts": "Supabase link: eon.team_leads roster (cached) and eon.exercise_runs archive.",
    "supabase/migrations/": "eon schema, row-level security on, no anon or authenticated grants.",
    "src/lib/eon/*.test.ts": "Node test runner. No network.",
    "scripts/serve.ts": "Local preview on Node.",
    "scripts/seeds.ts": "Fix-ellipse calibration across 100 seeds.",
    "wrangler.toml": "Worker eon, Durable Object EXERCISE, Access team domain, audience, TEAM_LEADS and SUPABASE_URL.",
    ".github/workflows/test.yml": "CI: npm test.",
    "docs/device-stack.md": "Planned device and app dependencies with licenses. Not used here.",
}

API = [
    {
        "method": "GET",
        "path": "/api/eon/health",
        "body": None,
    },
    {
        "method": "GET",
        "path": "/api/eon/picture",
        "body": "query role",
    },
    {
        "method": "GET",
        "path": "/api/eon/wrist",
        "body": "query unit",
    },
    {
        "method": "GET",
        "path": "/api/eon/feed/odin",
        "body": None,
    },
    {
        "method": "GET",
        "path": "/api/eon/ledger",
        "body": "query role=teamlead",
    },
    {
        "method": "GET",
        "path": "/api/eon/report",
        "body": "query role=teamlead",
    },
    {
        "method": "POST",
        "path": "/api/eon/sweep",
        "body": {
            "role": "",
        },
    },
    {
        "method": "POST",
        "path": "/api/eon/emcon",
        "body": {
            "role": "teamlead",
            "unitId": "",
            "profile": "normal|reduced|silent",
        },
    },
    {
        "method": "POST",
        "path": "/api/eon/ack",
        "body": {
            "role": "",
            "alertId": "",
        },
    },
    {
        "method": "POST",
        "path": "/api/eon/engagements",
        "body": {
            "role": "",
            "track": "",
            "method": "disrupt|handoff",
        },
    },
    {
        "method": "POST",
        "path": "/api/eon/decisions",
        "body": {
            "role": "teamlead",
            "engagementId": "",
            "decision": "approve|reject",
            "note": "optional",
        },
    },
    {
        "method": "POST",
        "path": "/api/eon/scan",
        "body": {
            "role": "",
            "unitId": "",
            "mode": "wide|economy",
        },
    },
    {
        "method": "POST",
        "path": "/api/eon/battery",
        "body": {
            "role": "",
            "unitId": "",
        },
    },
    {
        "method": "POST",
        "path": "/api/eon/quarantine",
        "body": {
            "role": "teamlead",
            "unitId": "",
            "on": "true|false",
        },
    },
    {
        "method": "POST",
        "path": "/api/eon/clock",
        "body": {
            "role": "teamlead",
            "on": "true|false",
        },
    },
    {
        "method": "POST",
        "path": "/api/eon/reset",
        "body": {
            "role": "teamlead",
        },
    },
]

PAGES = {
    "/": "Console",
    "/wrist?unit=eon-1": "Wrist display for one wearer",
}

SCENARIO = [
    {
        "tick": "1",
        "event": "Voice radio, data link, search radar and a friendly DAEMON™ MIL relay drone on the air. ASH 1-4 drops to economy scan on a tired battery.",
    },
    {
        "tick": "2",
        "event": "Hostile drone (control and video links) appears to the east.",
    },
    {
        "tick": "2-3",
        "event": "Debug session on ASH 1-2's device: health 75, degraded.",
    },
    {
        "tick": "3-5",
        "event": "Wideband noise on the L-band team link. ASH 1-2 hops to UHF.",
    },
    {
        "tick": "4-6",
        "event": "GNSS spoofing against ASH 1-3. It holds on inertial.",
    },
    {
        "tick": "5 on",
        "event": "ASH 1-4's device is hooked and rooted: health 25, compromised.",
    },
    {
        "tick": "8",
        "event": "The hostile drone leaves if it has not been engaged.",
    },
]

CHECKS = [
    {
        "check": "root",
        "weight": 40,
    },
    {
        "check": "hooking",
        "weight": 35,
    },
    {
        "check": "emulator",
        "weight": 30,
    },
    {
        "check": "debugger",
        "weight": 25,
    },
]

LEDGER = {
    "signature": "Ed25519",
    "hash": "SHA-256 over canonical JSON",
    "store": "Rebuilt by replaying the action log in Durable Object storage. Same seed and log, same hashes.",
    "by": "Entries a signed-in person caused carry payload.by with their verified email.",
    "reader": "Team lead only. Operators see that the chain verifies, not its entries.",
}

WORK = [
    {
        "name": "Sense and classify",
        "done": True,
        "detail": "Log-distance path loss, 3° bearing noise, nearest-centroid classifier with confidence.",
    },
    {
        "name": "Cooperative geolocation",
        "done": True,
        "detail": "Range-weighted least squares with a 95% error radius, calibrated at 96% over 100 seeds.",
    },
    {
        "name": "Link protection",
        "done": True,
        "detail": "Noise rise measured on every team-link path; hop below 6 dB SINR, return at 12 dB.",
    },
    {
        "name": "Resilient navigation",
        "done": True,
        "detail": "GNSS checked against inertial. Spoofing is caught; the wearer holds on inertial.",
    },
    {
        "name": "Signature control",
        "done": True,
        "detail": "Normal, reduced and silent EMCON. Silent holds detections until released.",
    },
    {
        "name": "Counter-drone",
        "done": True,
        "detail": "Friend, hostile or unknown. Operator requests, team lead orders, rules-of-engagement refusals recorded.",
    },
    {
        "name": "Power management",
        "done": True,
        "detail": "Battery and endurance per wearer. Economy scan below 25%. Battery swap.",
    },
    {
        "name": "Device integrity",
        "done": True,
        "detail": "Root, debugger, hooking and emulator checks. One score. Alerts with recommendations. Team-lead quarantine.",
    },
    {
        "name": "After-action report",
        "done": True,
        "detail": "Scored against ground truth: latency, classification, fix accuracy, links, warnings, engagements, spoof, integrity.",
    },
    {
        "name": "Private ledger",
        "done": True,
        "detail": "Signed hash chain, verified on every picture.",
    },
    {
        "name": "Durable exercise",
        "done": True,
        "detail": "One Durable Object. The action log replays after a restart or deploy.",
    },
    {
        "name": "Identity and roles",
        "done": True,
        "detail": "Access JWT verified in the Worker. Signed-in email on every decision. Team lead locked to TEAM_LEADS.",
    },
    {
        "name": "Console and wrist display",
        "done": True,
        "detail": "White console at /. Watch-sized wrist view at /wrist.",
    },
    {
        "name": "Deployed",
        "done": True,
        "detail": "Cloudflare Workers at eon.infinitumcorp.workers.dev behind Cloudflare Access.",
    },
    {
        "name": "CI",
        "done": True,
        "detail": "GitHub Actions runs npm test.",
    },
    {
        "name": "Live exercise clock",
        "done": True,
        "detail": "The team lead starts a clock that sweeps every 30 s on a Durable Object alarm. It is in the action log, survives restarts, and stops itself after 40 ticks.",
    },
    {
        "name": "ODIN°™ picture feed",
        "done": True,
        "detail": "GET /api/eon/feed/odin publishes every emitter fix as an ODIN track and a Lattice entity. Read-only; wearer positions, device health, EMCON and pending engagements stay inside the team.",
    },
    {
        "name": "Supabase backend",
        "done": False,
        "detail": "Migration and Worker code are in. Not live: the migration is not applied, eon is not an exposed schema, and SUPABASE_SERVICE_ROLE_KEY is not set as a Worker secret.",
    },
    {
        "name": "ODIN°™ pulls the feed",
        "done": False,
        "detail": "ODIN°™ is not deployed and does not call the feed yet. It would pull with a Cloudflare Access service token.",
    },
    {
        "name": "Real device checks",
        "done": False,
        "detail": "No native wearable firmware or app. Integrity signals are scripted.",
    },
    {
        "name": "Wearable device stack",
        "done": False,
        "detail": "Planned open-source dependencies, licenses and NOTICE duties for the device and companion app are in docs/device-stack.md. None are used in this repo.",
    },
]

NOT_DONE = [item["name"] for item in WORK if not item["done"]]


def brief() -> str:
    """One page of text. Print this, or hand the string to another model."""
    lines = [
        f"{PRODUCT} exercise backend. Exercise {EXERCISE}. Inside {PARENT}.",
        REPO,
        URL,
        f"HEAD {HEAD}.",
        "",
        RULES["whatItIs"],
        "Simulation only. Not for operational use. No signal is modelled. Synthetic emitters only.",
        "Private ledger. No data sale.",
        "",
        "Done:",
        *[f"- [{'yes' if item['done'] else 'no'}] {item['name']}. {item['detail']}" for item in WORK],
        "",
        "HTTP:",
        *[f"- {route['method']} {route['path']}" for route in API],
        "",
        "Roles: operator and team lead. An operator requests. Only the team lead orders.",
    ]
    return "\n".join(lines)


if __name__ == "__main__":
    print(brief())
