# Handoff

A record of the E(O)N™ MIL exercise backend, for the next person or model to pick up. It is not the running service. The service is `src/`.

This is a simulation. It is not for operational use. It models no signal, no jamming and no weapon.

The service commit this record describes is `32a8421`.

## TypeScript

```ts
import { brief, WORK, API, RULES, SCENARIO } from "./eon_work.ts";

console.log(brief());
```

## JavaScript

Same exports, generated from the TypeScript. Use this if the TypeScript file will not import.

```js
import { brief, WORK, API, RULES } from "./eon_work.js";

console.log(brief());
```

## Python

```python
from eon_work import brief, WORK, API, RULES

print(brief())
```

`WORK` is what was built and what was not. `API` is the HTTP contract. `SCENARIO` is the exercise timeline. `CHECKS` are the device-integrity weights. `RULES` states the limits: simulated exercise, no signal modelled, human orders, private ledger, deployed behind Cloudflare Access.

## Keeping it current

Edit `eon_work.ts` only, then run:

```bash
npm run handoff
```

That rewrites `eon_work.js` and `eon_work.py`. `npm test` fails if the three disagree, if the record's API differs from the routes documented in `src/lib/eon/http.ts`, or if a listed route does not exist.
