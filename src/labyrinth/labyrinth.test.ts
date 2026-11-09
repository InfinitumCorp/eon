import { test } from "node:test";
import assert from "node:assert/strict";
import worker from "../worker.ts";
import { createEonLabyrinth, proxyLabyrinthRequest } from "./index.ts";

test("repository route fails closed without configuration or a CID session", async () => {
  const request = () => new Request("https://product.example/api/labyrinth", { method: "POST", headers: { "content-type": "application/json", "x-labyrinth": "1" }, body: JSON.stringify({ action: "list" }) });
  assert.equal((await worker.fetch(request(), {})).status, 503);
  assert.equal((await worker.fetch(request(), { LBRNTH_ENDPOINT: "https://cid.example/api/labyrinth" })).status, 401);
});

test("thin client sends real CID bearer; relay pins product and preserves central denial", async () => {
  const client = createEonLabyrinth({ endpoint: "https://product.example/api/labyrinth", token: () => "cid-session", fetch: async (_url, init) => {
    const req = new Request("https://product.example/api/labyrinth", init);
    return proxyLabyrinthRequest(req, "https://cid.example/api/labyrinth", "eon", async (_target, forwarded) => {
      assert.equal(new Headers(forwarded?.headers).get("authorization"), "Bearer cid-session");
      assert.equal(JSON.parse(String(forwarded?.body)).product, "eon");
      assert.equal(forwarded?.redirect, "error");
      return Response.json([], { status: 200 });
    });
  } });
  assert.deepEqual(await client.repositories(), []);
  const req = new Request("https://product.example/api/labyrinth", { method: "POST", headers: { authorization: "Bearer forged", "content-type": "application/json", "x-labyrinth": "1" }, body: JSON.stringify({ action: "list", product: "spoof" }) });
  assert.equal((await proxyLabyrinthRequest(req, "https://cid.example/api/labyrinth", "eon", async () => Response.json({ error: "revoked" }, { status: 401 }))).status, 401);
});
