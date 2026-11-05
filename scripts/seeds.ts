import { Eon } from "../src/lib/eon/service.ts";
import { distance } from "../src/lib/eon/rf.ts";
let n = 0, inside = 0, worst = 0;
for (let seed = 1; seed <= 100; seed++) {
  const eon = await Eon.create(seed);
  for (let i = 0; i < 9; i++) {
    await eon.sweep("operator");
    const p = await eon.picture("teamlead");
    for (const f of p.fixes.filter(f => f.tick === p.tick)) {
      const miss = Math.min(...eon.truth().emitters.map(e => distance(e.pos, f.pos)));
      n++; if (miss <= f.errorM) inside++; worst = Math.max(worst, miss / f.errorM);
    }
  }
}
console.log({ fixes: n, within95: (inside / n * 100).toFixed(1) + "%", worstRatio: worst.toFixed(2) });
