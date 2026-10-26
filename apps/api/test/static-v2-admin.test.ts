import test, { after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Hono } from "hono";

const dir = mkdtempSync(join(tmpdir(), "inkast-v2-admin-"));
process.env.INKAST_DATA_DIR = dir;
const { db } = await import("../src/storage/db.js");
const { createV2Store } = await import("../src/storage/v2-jobs.js");
const { getV2AdminSnapshot } = await import("../src/storage/v2-admin.js");
const { listPluginGallery, pluginGalleryTotal, pluginGalleryCountsByPlugin, insertPluginGalleryItem } = await import("../src/storage/plugin-gallery.js");
const { adminRoutes } = await import("../src/server/routes/admin.js");
const conn = db();
after(() => { conn.close(); rmSync(dir, { recursive: true, force: true }); });

function setup() {
  conn.exec("DELETE FROM static_v2_layers; DELETE FROM static_v2_jobs; DELETE FROM plugin_gallery_items; DELETE FROM static_v2_workers; DELETE FROM plugin_tasks");
  const store = createV2Store(conn, () => 1000000); store.heartbeat("snapub", "worker", "revision");
  store.heartbeat("other", "worker", "revision");
  const submit = (id: string, plugin = "snapub") => store.submit({ id, plugin, owner: "private-owner", task: "", source: "", billingVersion: 1, creation: { prompt: "private creative brief" } });
  return { store, submit };
}

test("3D monitoring counts final tasks separately and exposes only safe diagnostic fields", () => {
  const { store, submit } = setup(); submit("pending");
  const leased = store.claim("snapub", "worker", "revision", true)!;
  store.saveLayer("snapub", leased.id, leased.leaseToken, "background", JSON.stringify({status:"submitted",upstreamStatus:"awaiting_admission",taskId:"frozen-upstream-id",lastPolledAt:1000000,providerHash:"private-provider-hash"}));
  store.renew("snapub", leased.id, leased.leaseToken, "generating_background");
  submit("queued");
  const snapshot = getV2AdminSnapshot(0, conn, 1060000);
  assert.equal(snapshot.total, 2); assert.equal(snapshot.recent.find(j=>j.id===leased.id)?.elapsedMs, 60000);
  assert.equal(snapshot.recent.find(j=>j.id===leased.id)?.layers[0]?.upstreamStatus, "awaiting_admission");
  for (const secret of ["private-owner", "private creative brief", "private-provider-hash", leased.leaseToken, "lease_hash"]) assert.equal(JSON.stringify(snapshot).includes(secret), false);
  assert.equal(getV2AdminSnapshot(1000001,conn).total,0);
});

test("gallery merges durable 3D cards and labeled layers with stable pagination and matching counts", () => {
  const { store, submit } = setup(); submit("three-d");
  const leased = store.claim("snapub","worker","revision",true)!;
  for (const layer of ["foreground","background"]) store.saveLayer("snapub",leased.id,leased.leaseToken,layer,JSON.stringify({status:"succeeded",imageUrl:`https://images.example/${layer}.png`,createdAt:1000000,completedAt:1000000}));
  store.finish("snapub",leased.id,leased.leaseToken,{status:"succeeded",imageUrl:"https://images.example/final.webp"});
  for (const [id, pluginId] of [["normal","snapub"],["other","other"]]) insertPluginGalleryItem({id:id!,pluginId:pluginId!,providerId:null,providerName:null,imageUrl:"https://images.example/ordinary.png",mime:"image/png",prompt:"ordinary",finalPromptText:"exact provider prompt",promptJson:'{"safe":true}',rewrittenPrompts:[],successRound:0,postReviewEdited:false,llmDurationMs:null,imageDurationMs:null,createdAt:1000000});
  assert.equal(pluginGalleryTotal(),5); assert.equal(pluginGalleryTotal("snapub"),4);
  assert.deepEqual(pluginGalleryCountsByPlugin(),[{pluginId:"snapub",count:4},{pluginId:"other",count:1}]);
  let cursor: string | null = null; const ids: string[] = [], kinds: string[] = [];
  do {
    const page = listPluginGallery({limit:2,pluginId:"snapub",cursor});
    ids.push(...page.items.map(i=>i.id)); kinds.push(...page.items.map(i=>i.artifactKind)); cursor=page.nextCursor;
  } while(cursor);
  assert.equal(new Set(ids).size,4); assert.equal(ids.length,4);
  assert.deepEqual(kinds.sort(),["3d_background","3d_card","3d_foreground","image"]);
  const ordinary=listPluginGallery({limit:10}).items.find(i=>i.id==="normal")!;
  assert.equal(ordinary.finalPromptText,"exact provider prompt"); assert.equal(ordinary.promptJson,'{"safe":true}');
  assert.equal(listPluginGallery({limit:10}).items.find(i=>i.id==="three-d")?.prompt,"private creative brief");
});

test("failed jobs keep successful materials visible without presenting them as delivered cards", () => {
  const {store,submit}=setup();submit("failed-card");const leased=store.claim("snapub","worker","revision",true)!;
  store.saveLayer("snapub",leased.id,leased.leaseToken,"foreground",JSON.stringify({status:"succeeded",imageUrl:"https://images.example/fg.png",createdAt:1000000}));
  store.saveLayer("snapub",leased.id,leased.leaseToken,"background","invalid json");
  store.finish("snapub",leased.id,leased.leaseToken,{status:"failed",errorCode:"generation_task_missing"});
  const gallery=listPluginGallery({limit:10}); assert.equal(gallery.items.length,1);assert.equal(gallery.items[0]?.artifactKind,"3d_foreground");
  assert.equal(getV2AdminSnapshot(0,conn).recent[0]?.layers.find(l=>l.layer==="background")?.status,"unknown");
});

test("admin HTML and gallery JSON show 3D diagnostics and escape untrusted IDs and image links", async () => {
  const {store,submit}=setup();submit("<script>bad</script>");const leased=store.claim("snapub","worker","revision",true)!;
  store.saveLayer("snapub",leased.id,leased.leaseToken,"foreground",JSON.stringify({status:"succeeded",imageUrl:"https://images.example/fg.png",upstreamStatus:"success"}));
  store.saveLayer("snapub",leased.id,leased.leaseToken,"background",JSON.stringify({status:"submitted",upstreamStatus:"awaiting_admission",taskId:"frozen-upstream-id"}));
  const app=new Hono();app.route("/admin",adminRoutes);
  const html=await (await app.request("/admin/plugin-stats?window=all")).text();
  assert.equal(html.includes("3D 卡牌 · 独立任务"),false);assert.match(html,/id="plugin-recent-tasks"/);assert.match(html,/data-task-kind="3d"/);assert.match(html,/等待上游建立记录/);assert.match(html,/frozen-upstream-id/);
  assert.equal(html.includes("<script>bad</script>"),false);assert.match(html,/&lt;script&gt;/);assert.equal(html.includes(leased.leaseToken),false);
  const gallery=await (await app.request("/admin/plugin-gallery.json?pluginId=snapub")).json() as {total:number;items:Array<{artifactKind:string}>};
  assert.equal(gallery.total,1);assert.equal(gallery.items[0]?.artifactKind,"3d_foreground");
});


test("plugin-stats interleaves ordinary and 3D tasks in one table and includes both in overview", async () => {
  const {store,submit}=setup(); submit("three-d-middle");
  const {createPluginTask}=await import("../src/storage/plugin-tasks.js");
  const old=createPluginTask({pluginId:"snapub",prompt:"old ordinary",callbackUrl:"https://example.com/callback",callbackToken:"test"});
  const newest=createPluginTask({pluginId:"snapub",prompt:"new ordinary",callbackUrl:"https://example.com/callback",callbackToken:"test"});
  conn.prepare("UPDATE plugin_tasks SET created_at=? WHERE id=?").run(999999,old.id);
  conn.prepare("UPDATE plugin_tasks SET created_at=? WHERE id=?").run(1000001,newest.id);
  const app=new Hono();app.route("/admin",adminRoutes);
  const html=await (await app.request("/admin/plugin-stats?window=all")).text();
  const mixed=html.match(/<table id="plugin-recent-tasks">([\s\S]*?)<\/table>/)![1]!;
  const rows=[...mixed.matchAll(/data-task-kind="(plugin|3d)" data-task-id="([^"]+)"/g)].map(m=>({kind:m[1],id:m[2]}));
  assert.deepEqual(rows,[{kind:"plugin",id:newest.id},{kind:"3d",id:"three-d-middle"},{kind:"plugin",id:old.id}]);
  assert.equal((html.match(/id="plugin-recent-tasks"/g)||[]).length,1);
  assert.equal(html.includes("3D 卡牌 · 独立任务"),false);
  assert.match(html,/<div class="big">3<\/div>/);
  assert.equal(store.get("snapub","three-d-middle")?.deliveries,0);
  assert.match(mixed,/3D 卡牌 · 直接生成/);assert.match(mixed,/普通生图/);
});

test("mixed recent tasks have one global fifty-row limit rather than fifty rows per type", async () => {
  const {submit}=setup();submit("three-d-visible");
  const {createPluginTask}=await import("../src/storage/plugin-tasks.js");
  for(let i=0;i<55;i++){
    const ordinary=createPluginTask({pluginId:"snapub",prompt:"ordinary",callbackUrl:"https://example.com/callback",callbackToken:"test"});
    conn.prepare("UPDATE plugin_tasks SET created_at=? WHERE id=?").run(999980+i,ordinary.id);
  }
  const app=new Hono();app.route("/admin",adminRoutes);
  const html=await (await app.request("/admin/plugin-stats?window=all")).text();
  const mixed=html.match(/<table id="plugin-recent-tasks">([\s\S]*?)<\/table>/)![1]!;
  assert.equal([...mixed.matchAll(/data-task-kind=/g)].length,50);
  assert.match(mixed,/data-task-id="three-d-visible"/);
  assert.match(html,/<div class="big">56<\/div>/);
});


test("3D aggregate counts, plugin breakdown, errors and hourly trend share the task-level scope", () => {
  const {store,submit}=setup();submit("reviewed");const leased=store.claim("snapub","worker","revision",true)!;
  store.finish("snapub",leased.id,leased.leaseToken,{status:"needs_review",errorCode:"quality_not_passed"});
  submit("waiting","other");
  const snapshot=getV2AdminSnapshot(0,conn,1060000);
  assert.equal(snapshot.total,2);
  assert.deepEqual(snapshot.errors,[{code:"quality_not_passed",count:1}]);
  assert.equal(snapshot.byPlugin.find(x=>x.pluginId==="snapub"&&x.status==="needs_review")?.count,1);
  assert.equal(snapshot.byPlugin.find(x=>x.pluginId==="other"&&x.status==="queued")?.count,1);
  assert.equal(snapshot.buckets.reduce((n,x)=>n+x.total,0),2);
  assert.equal(snapshot.buckets.reduce((n,x)=>n+x.failed,0),1);
  const excluded=getV2AdminSnapshot(1000001,conn,1060000);
  assert.equal(excluded.total,0);assert.deepEqual(excluded.byPlugin,[]);assert.deepEqual(excluded.errors,[]);
});
