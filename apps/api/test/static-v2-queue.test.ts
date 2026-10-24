import test from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { readFileSync } from "node:fs";
import { createV2Store } from "../src/storage/v2-jobs.js";

function fixture() {
  const conn = new Database(":memory:");
  conn.exec(readFileSync(new URL("../src/storage/schema.sql", import.meta.url), "utf8"));
  let now = 1000000;
  const store = createV2Store(conn, () => now);
  store.claim("snapub", "worker-one", "revision", false);
  const input = (id: string, owner = "owner-one", task = id) => ({ id, plugin: "snapub", owner, task, source: "https://images.example/original.png" });
  return { conn, store, input, advance: (ms: number) => { now += ms; } };
}
test("V2 submit is idempotent, owner-bound and atomically limits active/free tasks", () => {
  const { conn, store, input } = fixture();
  try {
    const first = store.submit(input("one"));
    assert.equal(store.submit(input("one")).id, first.id);
    assert.throws(() => store.submit(input("one", "other-owner")), /idempotency_conflict/);
    assert.throws(() => store.submit(input("two")), /owner_busy/);
    const claim = store.claim("snapub", "worker-one", "revision", true)!;
    store.finish("snapub", claim.id, claim.leaseToken, { status: "needs_review" });
    store.submit(input("two", "owner-one", "one"));
    const next = store.claim("snapub", "worker-one", "revision", true)!;
    store.finish("snapub", next.id, next.leaseToken, { status: "failed" });
    assert.throws(() => store.submit(input("three", "owner-one", "one")), /retry_limit/);
    store.submit(input("three"));
    const third = store.claim("snapub", "worker-one", "revision", true)!;
    store.finish("snapub", third.id, third.leaseToken, { status: "failed" });
    assert.throws(() => store.submit(input("four")), /daily_limit/);
  } finally { conn.close(); }
});
test("V2 leases fence old workers; heartbeats preserve long tasks; result acknowledgement can be retried", () => {
  const { conn, store, input, advance } = fixture();
  try {
    store.submit(input("one"));
    const old = store.claim("snapub", "worker-one", "revision", true)!;
    assert.equal(store.claim("snapub", "worker-two", "revision", true), null);
    advance(150000); store.renew("snapub", old.id, old.leaseToken, "checking");
    advance(150000); assert.equal(store.claim("snapub", "worker-two", "revision", true), null);
    advance(31000); const fresh = store.claim("snapub", "worker-two", "revision", true)!;
    assert.ok(fresh.leaseToken !== old.leaseToken);
    assert.throws(() => store.finish("snapub", old.id, old.leaseToken, { status: "succeeded" }), /lease_lost/);
    const result = { status: "succeeded", imageUrl: "https://images.example/v2/content-hash.png", sourceSha256: "source", codeSha256: "code" };
    store.finish("snapub", fresh.id, fresh.leaseToken, result);
    assert.equal(store.finish("snapub", fresh.id, fresh.leaseToken, result).image_url, result.imageUrl);
    assert.equal(store.get("different-plugin", fresh.id), undefined);
  } finally { conn.close(); }
});
test("three interrupted deliveries terminate, and an offline worker refuses new work", () => {
  const { conn, store, input, advance } = fixture();
  try {
    store.submit(input("one"));
    for (let i = 0; i < 3; i++) { assert.ok(store.claim("snapub", "worker-one", "revision", true)); advance(181000); }
    assert.equal(store.claim("snapub", "worker-one", "revision", true), null);
    assert.equal(store.get("snapub", "one")?.error_code, "recovery_limit");
    advance(121000);
    assert.throws(() => store.submit(input("two")), /worker_unavailable/);
  } finally { conn.close(); }
});

test("an interrupted task cannot silently reset its model budget after code/assets/API identity changes", () => {
  const { conn, store, input, advance } = fixture();
  try {
    store.submit(input("one")); store.claim("snapub", "worker-one", "old-pipeline", true);
    advance(181000);
    assert.equal(store.claim("snapub", "worker-one", "new-pipeline", true), null);
    assert.equal(store.get("snapub", "one")?.error_code, "pipeline_changed");
  } finally { conn.close(); }
});
