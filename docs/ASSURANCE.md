# E(O)N™ Assurance™ — suite design and first implementation

Infinitum Corporation® · 12 November 2026

## Implemented in this branch

- `/assurance`: responsive report-review workspace, accessible file input, status feedback and normalized JSON download.
- `/api/assurance/catalog`: ten researched tools with pinned clone commits, licenses and adapter status.
- `/api/assurance/normalize`: stateless ZAP™ JSON and Nuclei™ JSON-array import, 1 MiB request limit, 2,000 finding limit, deterministic deduplication, severity counts, and origin-only asset references.
- Existing Cloudflare Access authentication runs before all new routes. There is no new auth bypass. Local development inherits the existing unauthenticated development mode; do not expose it as a public service.
- `integrations/openclaw`: two optional OpenClaw™ tools for catalog inspection and supplied-report normalization, with no shell, network, filesystem or exercise-control capability.
- `scripts/assurance-ai.ts`: explicit local Ollama™ advisory review of at most 100 normalized findings. It sends titles, source and severity only to loopback. It never downloads models or falls back to a hosted model.

This is an initial implementation, not a completed autonomous penetration-testing system. External scanners are not installed or executed. The gateway integration is unit-tested against a structural registration harness, not tested inside a live OpenClaw™ gateway. Model inference requires a separately installed model and has not been exercised in this environment. Report import is stateless: no archive, project tenancy or finding workflow is implemented yet. Observations remain unverified findings until independently reviewed.

## Product suite

These modules are a proposed roadmap, not implemented capabilities unless listed above.

| Module | User workflow | Source foundation | Status |
|---|---|---|---|
| `E(O)N™ / CONTROL™` | Define an authorized assessment, assets, owner, scope and evidence requirements | Custom control plane; OpenClaw™ for advisory assistance | Design |
| `E(O)N™ / WEB™` | Review web and API assessment reports | ZAP™ and Nuclei™ | Two importers implemented |
| `E(O)N™ / COVERAGE™` | Match lab test observations to detection and prevention evidence | Atomic Red Team™ and Caldera™ | Design; no executor |
| `E(O)N™ / IDENTITY™` | Inspect an authorized directory snapshot for excessive access relationships | BloodHound™ | Design; no directory collector |
| `E(O)N™ / SEGMENT™` | Review isolated-lab segmentation assessment results | Infection Monkey™ | Design; no propagation or runner |
| `E(O)N™ / VALIDATE™` | Attach operator-produced validation evidence and remediation retests | Metasploit Framework™ as research reference | Design; no exploitation API |
| `E(O)N™ / AI-LAB™` | Evaluate locally hosted application models against reviewed test datasets | garak™ and PyRIT™ | Design; no evaluation runner |
| `E(O)N™ / FINDINGS™` | Normalize findings, identify duplicates and track resolution | DefectDojo™ patterns and import APIs | Normalization only |
| `E(O)N™ / ADVISOR™` | Explain evidence, uncertainty and remediation priorities | OpenClaw™ plus Ollama™ | Plugin source and local review script |
| `E(O)N™ / EVIDENCE™` | Preserve source hashes, tool version, test time and provenance | Custom artifact records; optional explicit Labyrinth integration later | Design; no automatic export |

The E(O)N™ wearable remains a thin client. Larger model inference and assessment services belong on an operator-controlled workstation or server, not on a wearable or inside a Cloudflare Worker. The existing exercise, radio simulation, counter-drone decisions, wearer positions and ODIN°™ feed are outside the assurance data flow.

## Architecture

The existing Worker serves a report-review UI behind its existing Access boundary. It receives only an explicitly uploaded report and returns normalized observations. Imported evidence cannot select a target, invoke a command, change a role or modify an exercise. Untrusted report text is rendered with `textContent`, never `innerHTML`.

Local AI is a separate process: user-selected normalized report → constrained projection → loopback Ollama™ → advisory text. It has no tool executor. Treat model output as an untrusted draft, not an authorization or a verified result. For the optional OpenClaw™ integration, use a dedicated agent with only the two assurance tools available; enabling this plugin does not disable unrelated tools on an existing agent.

Later persistence needs project membership and per-project authorization, source artifact hashes, timestamps, provenance, redaction, retention/deletion, rate limits and audit records before enabling multi-customer use. Tool presence in the catalog never implies that it is installed or approved to run.

## Free, open source and keyless

OpenClaw™ and Ollama™ have MIT-licensed source. Local inference does not require a paid AI-provider API key. An `ollama-local` configuration marker is not a purchased credential. Keep Ollama™ on loopback and do not add a hosted fallback. Hardware, electricity, storage and any hosting still cost money. Downloaded model weights have their own licenses; inspect the selected model separately.

Target credentials, local service credentials and the existing E(O)N™ sign-in remain necessary where applicable. “Keyless” does not mean unauthenticated access to customer infrastructure.

## Local use

From the repository root, Node 22.18+:

```bash
npm ci --ignore-scripts
npm test
npm run dev
```

Open `http://localhost:8787/assurance`. Select ZAP™ JSON or Nuclei™ JSON array, choose a report, review and download. Convert JSONL to a JSON array before upload. The importer omits raw requests/responses and strips URL credentials, paths and queries. Titles and remediation text can still contain sensitive information: review/redact them before upload or AI analysis.

For a separately installed local Ollama™ model, supply its exact installed model ID:

```bash
npm run assurance:ai -- ./eon-assurance-findings.json YOUR_INSTALLED_LOCAL_MODEL_ID
```

The script only contacts `http://127.0.0.1:11434/api/chat`, disallows redirects and cloud-named models, and has input/output limits and a timeout. No API key or new package is required by this script. It does not establish what an externally managed Ollama™ daemon routes internally; configure that daemon for local-only use.

### OpenClaw™ development integration

Use the cloned OpenClaw™ documentation to install the gateway and choose Ollama™ / Local only during onboarding. Verify that the selected model supports tools. Link this plugin so its relative imports continue to resolve inside this checkout:

```bash
openclaw plugins install --link ./integrations/openclaw
```

Enable `eon-assurance` and permit only `eon_assurance_catalog` and `eon_assurance_normalize` on the dedicated assessment-review agent. Restart the gateway and verify tool registration before use. Existing global tools, network access and agent permissions are independent of this plugin; audit them explicitly. Packaging a standalone distributable plugin will require bundling the shared normalization/catalog modules into its own directory.

## Repository and reuse inventory

The sibling research checkouts are shallow source clones, not built installations. Exact SHAs and URLs appear in `assurance-repositories.json`. The ten are a suitability shortlist across assessment, AI evaluation and finding management, not a claim of a universal top-ten ranking. OpenClaw™ and Ollama™ are additional foundation repositories.

Prefer process/API adapters and upstream releases over copying entire codebases into E(O)N™. Upstream code has not been merged into the product: the current adapters are original report-format wrappers. Before distributing modified dependencies, preserve applicable LICENSE/NOTICE files and review component-specific licenses, plugins, templates, datasets, models and binary dependencies. Infection Monkey™ uses GPL-3.0; keep it a separately evaluated integration, not presumed compatible vendored proprietary code. Metasploit Framework™ includes component-specific terms. A root license is not a dependency audit.

## Delivery sequence

1. Review this branch's report contracts and UI; validate with scrubbed real reports from authorized labs.
2. Install the local gateway/model on an operator workstation and perform a live integration smoke test; do not enable other agent tools by default.
3. Add separate adapters for garak™ and PyRIT™ output using pinned-version fixtures. Add schema migrations and provenance fields before accepting multiple report versions.
4. Add identity/coverage report views using exported snapshots, without collecting directory credentials or launching tests from the wearable.
5. Implement per-project evidence storage, authorization, retention and finding lifecycle; choose explicit private artifact saves rather than automatic cross-product exports.
6. Benchmark device/workstation workloads. Deploy only the Worker-compatible UI/API on Cloudflare after checks; local inference and lab tools need a workstation or separate server.

## Primary references

- https://github.com/openclaw/openclaw
- https://docs.openclaw.ai/providers/ollama
- https://docs.openclaw.ai/tools/plugin
- https://github.com/ollama/ollama
- https://github.com/apache/caldera
- https://github.com/redcanaryco/atomic-red-team
- https://github.com/rapid7/metasploit-framework
- https://github.com/zaproxy/zaproxy
- https://github.com/projectdiscovery/nuclei
- https://github.com/SpecterOps/BloodHound
- https://github.com/guardicore/monkey
- https://github.com/NVIDIA/garak
- https://github.com/Azure/PyRIT
- https://github.com/DefectDojo/django-DefectDojo
