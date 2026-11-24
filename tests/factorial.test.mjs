import { test } from "node:test";
import assert from "node:assert/strict";
import { localDB } from "../scripts/database.mjs";
import { ARMS, HOTELS, STUDY_CONSENT, TRIP, initialOrder } from "../worker/experiment.mjs";
import { studyApi } from "../worker/study-api.mjs";

const origin="https://rua.example.test";
const owner={"oai-authenticated-user-id":"research-owner","oai-authenticated-user-email":"owner@example.test"};
const secret="test-only-"+ "a".repeat(32);
async function fixture(t){
  const db=localDB();
  t.after(()=>db.close());
  const env={DB:db,RESEARCH_OWNER_EMAIL:"owner@example.test",RESEARCH_ADMIN_TOKEN:secret};
  function browser(){
    const key=Array.from(crypto.getRandomValues(new Uint8Array(32)),x=>x.toString(16).padStart(2,"0")).join("");
    return {
      async api(path,data,headers={}){
        return studyApi(new Request(origin+path,{headers:{"X-Study-Key":key,...headers},
          method:data===undefined?"GET":"POST",body:data===undefined?undefined:JSON.stringify(data)}),env);
      },
      async start(arm){
        const resp=await this.api("/api/study/start",{consent:STUDY_CONSENT,preview:true,previewArm:arm},owner);
        assert.equal(resp.status,200);
        return resp.json();
      },
    };
  }
  async function fetchResearch(path,headers=owner){return studyApi(new Request(origin+"/api/research/"+path,{headers}),env);}
  return {db,browser,fetchResearch};
}

test("four equal-probability arms have one initial focal and identical fresh tail",()=>{
  for(const a of ARMS){
    const list=initialOrder(a);
    const first=a.focal_quality==="high"?"H":"L";
    assert.equal(list.length,13);
    assert.equal(list[0],first);
    assert.deepEqual(list.slice(1,6),["M1","M2","M3","M4","M5"]);
    assert.equal(list[6],a.retarget?first:"M6");
    assert.deepEqual(list.slice(7),["M7","M8","M9","M10","M11","M12"]);
    assert.equal(new Set(list).size,a.retarget?12:13);
  }
  const all=Object.values(HOTELS);
  assert.equal(new Set(all.map(h=>h.photo)).size,14);
  assert.equal(new Set(all.map(h=>h.sourceRank)).size,14);
  for(const h of all.filter(x=>x.id.startsWith("M"))){
    assert(h.score>HOTELS.L.score&&h.score<HOTELS.H.score);
    for(const k of ["stars","cleanliness","comfort","facilities"])assert(h[k]>=HOTELS.L[k]&&h[k]<=HOTELS.H[k]);
  }
});
test("consent is required and repeated start preserves assignment, identities and list",async t=>{
  const {browser,db}=await fixture(t), client=browser();
  assert.equal((await client.api("/api/study/session")).status,404);
  assert.equal((await client.api("/api/study/start",{consent:"no"})).status,400);
  assert.equal((await client.api("/api/study/start",{consent:STUDY_CONSENT,preview:true})).status,403);
  const [a,b]=await Promise.all([client.start("high_retarget"),client.start("low_no_retarget")]);
  assert.deepEqual(a,b);
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM study_sessions").first().count,1);
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM study_list_entries").first().count,13);
  assert.equal(Object.hasOwn(a.session,"arm"),false);
  assert.notEqual(a.list.entries[0].id,a.list.entries[6].id);
});
test("real sorting and filters preserve ownership, provenance and default position",async t=>{
  const {browser,db}=await fixture(t);
  const one=browser(),two=browser(), s=await one.start("low_retarget");
  await two.start("high_no_retarget");
  const op={id:crypto.randomUUID(),previousId:s.list.id,reason:"sort",query:{...TRIP,sort:"scores"}};
  const res=await one.api("/api/study/list",op);
  assert.equal(res.status,200);
  const v=await res.json();
  assert.equal(v.list.previousId,s.list.id);
  assert.notEqual(v.list.entries.find(e=>e.defaultRank===7).rank,7);
  assert.deepEqual(await (await one.api("/api/study/list",op)).json(),v);
  const filtered=await (await one.api("/api/study/list",{...op,id:crypto.randomUUID(),previousId:v.list.id,reason:"filter",query:{...TRIP,stars:[4],minScore:9}})).json();
  assert(filtered.list.entries.every(e=>e.hotel.stars===4&&e.hotel.score>=9));
  assert.equal(filtered.list.entries.length,1);
  assert.equal((await two.api("/api/study/session?list="+s.list.id)).status,404);
  assert.equal((await two.api("/api/study/list",op)).status,404);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM study_lists WHERE session_id=?").bind(s.session.id).first().n,3);
});
test("deduplicated telemetry preserves original exposure, instances and tab attribution",async t=>{
  const {browser,fetchResearch,db}=await fixture(t), c=browser();
  const state=await c.start("high_retarget");
  const tab1=crypto.randomUUID(),tab2=crypto.randomUUID();
  const seq=Date.now()+100;
  const event=(id,type,offset,tab=tab1)=>({id:crypto.randomUUID(),type,page:"results",eventSeq:offset+1,pageViewId:crypto.randomUUID(),
    tabId:tab,listId:state.list.id,instance:id,at:new Date(seq+offset).toISOString()});
  const logs=[event("p01","card_impression",1),event("p07","viewport_enter",2),event("p07","card_impression",3),
    event("p08","card_impression",4),event("p01","hotel_open",5),{...event("p01","booking_enter",6,tab2),page:"booking"}];
  for(let i=0;i<2;i++)assert.equal((await c.api("/api/study/events",{events:logs})).status,200);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM study_events WHERE event_type='card_impression'").first().n,3);
  const complete={id:crypto.randomUUID(),action:"confirm",instance:"p01",listId:state.list.id,rate:"double-flex",context:{...logs.at(-1),page:"review"}};
  assert.equal((await c.api("/api/study/finish",complete)).status,200);
  assert.equal((await c.api("/api/study/finish",complete)).status,200);
  const timeline=await (await fetchResearch("timeline?session="+state.session.id)).json();
  assert.equal(timeline.session.status,"booked");
  assert.equal(timeline.session.first_after_critical,"card_impression");
  assert.equal(timeline.session.continued_to_new,1);
  assert.equal(timeline.session.booked_focal,1);
  assert.equal(timeline.session.final_instance_id,"p01");
  const exposure=timeline.events.find(e=>e.event_type==="card_impression"&&e.default_rank===7);
  assert.equal(exposure.hotel_id,"H");
  assert.equal(exposure.listing_instance_id,"p07");
  assert.equal(timeline.events.filter(e=>e.event_type==="booking_confirm").length,1);
  assert.equal(timeline.events.find(e=>e.event_type==="booking_enter").tab_id,tab2);
});
test("timeout is missing information; explicit exit is terminal; CSV and timeline are protected",async t=>{
  const {browser,fetchResearch,db}=await fixture(t);
  const abandoned=await browser().start("low_no_retarget"), b=browser(), leaving=await b.start("high_no_retarget");
  db.prepare("UPDATE study_sessions SET last_active_at=? WHERE session_id=?").bind("2026-01-01T00:00:00.000Z",abandoned.session.id).run();
  await b.api("/api/study/finish",{id:crypto.randomUUID(),action:"exit",listId:leaving.list.id,context:{page:"results"}});
  assert.equal((await fetchResearch("summary",{})).status,401);
  const auth={Authorization:"Basic "+btoa("researcher:"+secret)};
  const s=await (await fetchResearch("sessions?run=preview",auth)).json();
  const unknown=s.items.find(x=>x.session_id===abandoned.session.id), ended=s.items.find(x=>x.session_id===leaving.session.id);
  assert.equal(unknown.status,"unfinished");assert.equal(unknown.activity_status,"timed_out");assert.equal(unknown.exit_reason,"unknown");
  assert.equal(ended.status,"explicit_exit");assert.equal(ended.exit_reason,"button");
  for(const [table,column] of [["sessions","focal_quality"],["rankings","listing_instance_id"],["events","page_view_id"],["stimuli","sourceHotel"]]){
    const response=await fetchResearch("export?run=preview&table="+table,auth);
    assert.equal(response.status,200);
    const csv=await response.text();
    assert(csv.split("\n")[0].includes(column));
    assert(csv.split("\n").length>2);
  }
});
