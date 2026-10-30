import test from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { readFileSync } from "node:fs";
import sharp from "sharp";
import { createHash } from "node:crypto";
import { createV2Store } from "../src/storage/v2-jobs.js";
import { createVisionJobStore } from "../src/storage/vision-jobs.js";
import { pollV2Scene } from "../src/domain/v2-scene.js";
import { parseSceneLayout, backgroundLayoutPrompt } from "../src/domain/vision/scene-layout.js";
import type { InkastPlugin } from "../src/plugins/types.js";
const value = { placement: { centerX: .5, centerY: .5, zoom: 1, rotationDeg: 0 }, subjectAnchor: [.5,.4], backgroundFocus: [.2,.3], backgroundIntent: "以主题中的环境光和透视承接人物位置，不额外添加装饰", reason: "保持人物动作和场景的整体重心" };
async function fixture() {
 const db = new Database(":memory:");db.exec(readFileSync(new URL("../src/storage/schema.sql", import.meta.url),"utf8"));let now = Date.now();const store = createV2Store(db,()=>now), vs = createVisionJobStore(db,()=>now);
 store.heartbeat("snapub","w","r");const job = store.submit({ id:"scene-test",plugin:"snapub",owner:"owner",task:"",source:"",billingVersion:1,creation:{prompt:"original scene"} });const lease = store.claim("snapub","w","r",true)!;
 const bytes=await sharp({create:{width:1024,height:1280,channels:4,background:"transparent"}}).png().toBuffer();const sha=createHash("sha256").update(bytes).digest("hex");let reads=0,calls=0;
 const plugin={id:"snapub",visionTasks:{v2_plan:{maxImages:4,providerIds:["llm"],systemPrompt:"",outputSchema:{}}}} as unknown as InkastPlugin;
 const runner={store:vs,submit:async(p:InkastPlugin,id:string,task:string,input:any)=>{calls++;return vs.submit(p.id,id,task,input)}};
 const args={store,plugin,job,token:lease.leaseToken,sha,read:async()=>{reads++;return bytes;},brief:"original scene"};return {db,store,vs,runner,args,counts:()=>({reads,calls}),advance:(ms:number)=>{now+=ms;},clock:()=>now};
}
test("scene layout reserves exact input, resumes one durable job and never reloads the PNG on every poll",async()=>{
 const f=await fixture();try{
  const run=()=>pollV2Scene(f.args,{runner:f.runner as any,now:f.clock});assert.equal((await run()).status,"pending");const state=JSON.parse(f.store.layer("snapub",f.args.job.id,"scene-layout")!);
  assert.equal((await run()).status,"pending");assert.deepEqual(f.counts(),{reads:1,calls:1});f.vs.claim("snapub",state.id);f.vs.finish("snapub",state.id,{data:value},null);
  const result=await run();assert.equal(result.status,"succeeded");assert.equal(result.layout!.foregroundSha256,f.args.sha);assert.match(backgroundLayoutPrompt(result.layout!),/subjectCoreInSquareCard/);
  assert.equal((await run()).status,"succeeded");assert.deepEqual(f.counts(),{reads:1,calls:1});
  const frozen=JSON.parse(f.store.layer("snapub",f.args.job.id,"scene-layout")!);assert.deepEqual(frozen.input,{images:[]});
 }finally{f.db.close();}
});
test("lost accepted layout job and unknown upstream outcome do not create a replacement analysis",async()=>{
 const f=await fixture();try{
  await pollV2Scene(f.args,{runner:f.runner as any,now:f.clock});const s=JSON.parse(f.store.layer("snapub",f.args.job.id,"scene-layout")!);f.db.prepare("DELETE FROM plugin_vision_jobs WHERE id=?").run(s.id);
  assert.equal((await pollV2Scene(f.args,{runner:f.runner as any,now:f.clock})).status,"failed");assert.equal(f.counts().calls,1);
 }finally{f.db.close();}
});
test("layout is bound to the exact foreground and stale lease cannot submit analysis",async()=>{
 const f=await fixture();try{
  await pollV2Scene(f.args,{runner:f.runner as any,now:f.clock});await assert.rejects(pollV2Scene({...f.args,sha:"f".repeat(64)},{runner:f.runner as any}),/generation_policy_changed/);
  f.advance(181000);f.store.claim("snapub","w","r",true);await assert.rejects(pollV2Scene(f.args,{runner:f.runner as any}),/lease_lost/);assert.equal(f.counts().calls,1);
  assert.throws(()=>parseSceneLayout({...value,placement:{...value.placement,zoom:99}},f.args.sha,1024,1280));
 }finally{f.db.close();}
});
test("a busy layout queue keeps its reserved input and ID without redownloading the foreground",async()=>{
 const f=await fixture();let count=0;
 try{
  const runner={...f.runner,submit:async(...args:any[])=>{count++;if(count===1)throw {status:429};return (f.runner.submit as any)(...args)}};
  assert.equal((await pollV2Scene(f.args,{runner:runner as any,now:f.clock})).status,"pending");const old=JSON.parse(f.store.layer("snapub",f.args.job.id,"scene-layout")!);
  assert.equal((await pollV2Scene(f.args,{runner:runner as any,now:f.clock})).status,"pending");const next=JSON.parse(f.store.layer("snapub",f.args.job.id,"scene-layout")!);
  assert.equal(old.id,next.id);assert.equal(f.counts().reads,1);assert.equal(f.counts().calls,1);
 }finally{f.db.close();}
});

test("head protection validation uses the original shared transform for legacy 2:3 material",async()=>{
 const {balancedPlanGeometryError}=await import("../src/domain/vision/adaptive.js");
 const plan={zoom:1,centerX:.5,centerY:.5,rotationDeg:0,subjectParts:[{kind:"body",name:"完整头部",segmentation:"complete",anchor:[.5,.15]}],protectedRegions:[{polygon:[[.48,.17],[.52,.17],[.52,.19],[.48,.19]]}]};
 assert.equal(balancedPlanGeometryError({candidates:[{plan}]},{sourcePlacement:{width:1024,height:1536}}),null);
 assert.ok(balancedPlanGeometryError({candidates:[{plan}]},{layerLayout:{mode:"independent-portrait"},sourcePlacement:{width:1024,height:1280}}));
});
