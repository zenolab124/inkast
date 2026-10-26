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
  store.heartbeat("snapub", "worker-one", "revision");
  const input = (id: string, owner = "owner-one", task = id) => ({ id, plugin: "snapub", owner, task, source: "https://images.example/original.png", billingVersion: 1 });
  return { conn, store, input, advance: (ms: number) => { now += ms; } };
}
test("resource gating leaves conversions untouched while native jobs of the same owner run independently", () => {
  const { conn, store, input } = fixture();
  try {
    store.submit(input("conversion", "owner-one"));
    store.submit({ ...input("same-owner-native", "owner-one"), creation: { prompt: "Native layers" } });
    store.submit({ ...input("other-owner-native", "owner-two"), creation: { prompt: "Native layers" } });
    const before = store.get("snapub", "conversion");
    const first = store.claim("snapub", "worker-one", "revision", true, false)!;
    const second = store.claim("snapub", "worker-two", "revision", true, false)!;
    assert.equal(first.id, "same-owner-native"); assert.equal(second.id, "other-owner-native");
    assert.deepEqual(store.get("snapub", "conversion"), before);
    assert.equal(store.claim("snapub", "worker-one", "revision", true, false), null);
    const conversion = store.claim("snapub", "worker-one", "revision", true, true)!;
    assert.equal(conversion.id, "conversion");
    assert.equal(store.get("snapub", first.id)?.status, "running");
    store.finish("snapub", first.id, first.leaseToken, { status: "succeeded" });
    store.finish("snapub", second.id, second.leaseToken, { status: "failed" });
    store.finish("snapub", conversion.id, conversion.leaseToken, { status: "failed" });
  } finally { conn.close(); }
});
test("global capacity is five generated plus one conversion across workers, including one user's parallel jobs", () => {
  const { conn, store, input, advance } = fixture();
  try {
    for (let n=0;n<7;n++) store.submit({ ...input(`native-${n}`, "same-owner"), creation: { prompt: "Native layers" } });
    store.submit(input("convert-1")); store.submit(input("convert-2", "other-owner"));
    const native = Array.from({ length: 5 }, (_, n) => store.claim("snapub", `worker-${n}`, "revision", true, false)!);
    assert.equal(new Set(native.map(row => row.id)).size, 5);
    assert.equal(store.claim("snapub", "worker-6", "revision", true, false), null);
    const conversion = store.claim("snapub", "worker-6", "revision", true)!;
    assert.equal(conversion.id, "convert-1");
    assert.equal(store.claim("snapub", "worker-7", "revision", true), null);
    assert.equal(store.get("snapub", "native-5")?.deliveries, 0);
    assert.equal(store.get("snapub", "convert-2")?.deliveries, 0);
    assert.equal(store.claim("snapub", "worker-7", "revision", true, false, false), null);
    store.finish("snapub", native[0]!.id, native[0]!.leaseToken, { status: "succeeded" });
    const sixth = store.claim("snapub", "worker-7", "revision", true, false)!;
    assert.equal(sixth.id, "native-5");
    advance(150000); store.renew("snapub", sixth.id, sixth.leaseToken, "planning"); advance(31000);
    const resumed = store.claim("snapub", "worker-8", "revision", true, false)!;
    assert.equal(resumed.id, native[1]!.id);
    assert.throws(() => store.renew("snapub", resumed.id, native[1]!.leaseToken, "planning"), /lease_lost/);
    assert.equal(store.get("snapub", sixth.id)?.lease_hash, sixth.lease_hash);
  } finally { conn.close(); }
});
test("V2 submit is idempotent and owner-bound, without trial daily/source limits", () => {
  const { conn, store, input } = fixture();
  try {
    const first = store.submit(input("one"));
    assert.equal(store.submit(input("one")).id, first.id);
    assert.throws(() => store.submit(input("one", "other-owner")), /idempotency_conflict/);
    assert.equal(store.submit(input("two", "owner-one", "one")).status, "queued");
    const claim = store.claim("snapub", "worker-one", "revision", true)!;
    store.finish("snapub", claim.id, claim.leaseToken, { status: "needs_review" });
    assert.equal(store.submit(input("two", "owner-one", "one")).status, "queued");
    const next = store.claim("snapub", "worker-one", "revision", true)!;
    store.finish("snapub", next.id, next.leaseToken, { status: "failed" });
    assert.equal(store.submit(input("three", "owner-one", "one")).status, "queued");
    const third = store.claim("snapub", "worker-one", "revision", true)!;
    store.finish("snapub", third.id, third.leaseToken, { status: "failed" });
    assert.equal(store.submit(input("four")).status, "queued");
    assert.throws(() => store.submit({ ...input("missing-billing"), billingVersion: undefined }), /billing_required/);
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

test("independent V2 history is owner-bound, keeps failed attempts and promotes an old task when it completes", () => {
  const { conn, store, input, advance } = fixture();
  try {
    store.submit(input("old-job", "owner-a"));
    const old = store.claim("snapub", "worker-one", "revision", true)!;
    store.submit(input("new-job", "owner-b"));
    advance(1000); store.finish("snapub", old.id, old.leaseToken, { status: "succeeded" });
    // A later failed attempt remains its own history entry.
    store.submit(input("retry-job", "owner-a", "different-source"));
    const other = store.claim("snapub", "worker-one", "revision", true)!;
    store.finish("snapub", other.id, other.leaseToken, { status: "failed" });
    const last = store.claim("snapub", "worker-one", "revision", true)!;
    store.finish("snapub", last.id, last.leaseToken, { status: "failed" });
    const page = store.list("snapub", "owner-a", 1);
    assert.equal(page.items[0]!.id, "retry-job");
    assert.ok(page.next);
    assert.equal(store.list("snapub", "owner-a", 1, page.next!).items[0]!.id, "old-job");
    assert.equal(store.list("snapub", "owner-b", 12).items.length, 1);
    assert.equal(store.list("other-plugin", "owner-a", 12).items.length, 0);
    // Completion time, not original creation time, determines its final position.
    conn.prepare("UPDATE static_v2_jobs SET updated_at=updated_at+10000 WHERE id='old-job'").run();
    assert.equal(store.list("snapub", "owner-a", 12).items[0]!.id, "old-job");
  } finally { conn.close(); }
});

test("same-owner tasks wait FIFO through check cooldown; other owners run and deferred acknowledgements are idempotent", () => {
  const { conn, store, input, advance } = fixture();
  try {
    store.submit(input("z-first"));
    const first = store.claim("snapub", "worker-one", "revision", true)!;
    store.submit(input("a-second")); // same millisecond, reverse lexical order
    store.submit(input("other", "owner-two"));
    store.renew("snapub", first.id, first.leaseToken, "recovery_wait");
    const deferred = store.defer("snapub", first.id, first.leaseToken, 60000);
    assert.equal(deferred.status, "queued"); assert.equal(deferred.stage, "check_retry_wait");
    assert.equal(deferred.deliveries, 1);
    advance(1000);
    assert.equal(store.defer("snapub", first.id, first.leaseToken, 60000).lease_until, deferred.lease_until);
    const other = store.claim("snapub", "worker-one", "revision", true)!;
    assert.equal(other.id, "other");
    store.finish("snapub", other.id, other.leaseToken, { status: "succeeded" });
    assert.equal(store.claim("snapub", "worker-one", "revision", true), null);
    advance(59000);
    const resumed = store.claim("snapub", "worker-one", "revision", true)!;
    assert.equal(resumed.id, first.id); assert.equal(resumed.deliveries, 2);
    assert.throws(() => store.defer("snapub", first.id, first.leaseToken, 60000), /lease_lost/);
    store.finish("snapub", resumed.id, resumed.leaseToken, { status: "succeeded" });
    const second = store.claim("snapub", "worker-one", "revision", true)!;
    assert.equal(second.id, "a-second");
    assert.equal(store.list("snapub", "owner-one", 12).items.length, 2);
  } finally { conn.close(); }
});

test("check deferral cannot reset delivery bounds, bypass pipeline identity, or defer a non-check stage", () => {
  const { conn, store, input, advance } = fixture();
  try {
    store.submit(input("one"));
    let claim = store.claim("snapub", "worker-one", "revision", true)!;
    assert.throws(() => store.defer("snapub", claim.id, claim.leaseToken, 60000), /invalid_recovery/);
    for (let i=1;i<=3;i++) {
      store.renew("snapub", claim.id, claim.leaseToken, "checking");
      const row = store.defer("snapub", claim.id, claim.leaseToken, 60000);
      if (i<3) { advance(60000); claim = store.claim("snapub", "worker-one", "revision", true)!; }
      else { assert.equal(row.status,"failed"); assert.equal(row.error_code,"recovery_limit"); }
    }
    store.submit(input("new"));
    const old = store.claim("snapub", "worker-one", "old-revision", true)!;
    store.renew("snapub", old.id, old.leaseToken, "checking");
    store.defer("snapub", old.id, old.leaseToken, 60000); advance(60000);
    assert.equal(store.claim("snapub", "worker-one", "new-revision", true), null);
    assert.equal(store.get("snapub",old.id)?.error_code,"pipeline_changed");
  } finally { conn.close(); }
});

test("allowing same-owner queuing preserves the global sixteen-job bound", () => {
  const { conn, store, input } = fixture();
  try {
    for (let i=0;i<16;i++) store.submit(input(`job-${i}`,`owner-${i}`));
    assert.throws(() => store.submit(input("full","owner-full")), /queue_full/);
    const first = store.claim("snapub","worker-one","revision",true)!;
    store.finish("snapub",first.id,first.leaseToken,{status:"succeeded"});
    assert.equal(store.submit(input("full","owner-full")).status,"queued");
  } finally { conn.close(); }
});

test("planning deferral preserves FIFO and rejects recovery for the wrong stage", () => {
  const { conn, store, input, advance } = fixture();
  try {
    store.submit(input("first")); store.submit(input("second"));
    const first = store.claim("snapub", "worker-one", "revision", true)!;
    store.renew("snapub", first.id, first.leaseToken, "planning");
    assert.throws(() => store.defer("snapub", first.id, first.leaseToken, 60000), /invalid_recovery/);
    const deferred = store.defer("snapub", first.id, first.leaseToken, 60000, "plan_retry_wait");
    assert.equal(deferred.stage, "plan_retry_wait"); assert.equal(deferred.status, "queued");
    advance(1000);
    assert.equal(store.defer("snapub", first.id, first.leaseToken, 60000, "plan_retry_wait").lease_until, deferred.lease_until);
    assert.equal(store.claim("snapub", "worker-one", "revision", true), null);
    advance(59000);
    const resumed = store.claim("snapub", "worker-one", "revision", true)!;
    assert.equal(resumed.id, first.id); assert.equal(resumed.deliveries, 2);
    store.renew("snapub", resumed.id, resumed.leaseToken, "checking");
    assert.throws(() => store.defer("snapub", resumed.id, resumed.leaseToken, 60000, "plan_retry_wait"), /invalid_recovery/);
    store.finish("snapub", resumed.id, resumed.leaseToken, { status: "succeeded" });
    assert.equal(store.claim("snapub", "worker-one", "revision", true)!.id, "second");
  } finally { conn.close(); }
});


test("heartbeats keep a resource-waiting worker online without leasing jobs; claim alone is not a heartbeat", () => {
  const {conn,store,input,advance}=fixture();
  try {
    store.submit(input("waiting")); const before=store.get("snapub","waiting");
    for(let i=0;i<8;i++){advance(30000);store.heartbeat("snapub","worker-one","revision");assert.equal(store.online("snapub"),true);}
    assert.deepEqual(store.get("snapub","waiting"),before);
    store.submit(input("second"));assert.equal(store.get("snapub","second")?.status,"queued");
    advance(121000);assert.equal(store.online("snapub"),false);
    assert.equal(store.claim("snapub","worker-one","revision",false),null);
    assert.equal(store.online("snapub"),false);
    store.heartbeat("snapub","worker-one","revision");
    assert.equal(store.claim("snapub","worker-one","revision",true)?.id,"waiting");
  } finally {conn.close();}
});

test("a worker never reclaims or exhausts a task still active locally after a temporary lease-renewal outage", () => {
  const { conn, store, input, advance } = fixture();
  try {
    store.submit({ ...input("locally-active"), creation: { prompt: "Native" } });
    const first=store.claim("snapub","worker","revision",true)!;
    conn.prepare("UPDATE static_v2_jobs SET deliveries=3 WHERE id=?").run(first.id);
    advance(181000); store.heartbeat("snapub","worker","revision");
    store.submit({ ...input("next-native"), creation: { prompt: "Native" } });
    const next=store.claim("snapub","worker","revision",true,false,true,[first.id])!;
    assert.equal(next.id,"next-native");
    assert.equal(store.get("snapub",first.id)?.status,"running");
    assert.equal(store.get("snapub",first.id)?.deliveries,3);
    assert.equal(store.claim("snapub","worker","revision",true,false,true,[first.id,next.id]),null);
    store.claim("snapub","worker","revision",true,false,true,[next.id]);
    assert.equal(store.get("snapub",first.id)?.error_code,"recovery_limit");
  } finally {conn.close();}
});
