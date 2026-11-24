import {test} from "node:test";
import assert from "node:assert/strict";
import {api} from "../worker/api.mjs";
import {CONSENT,profiles,initialLayout,publicState,ranks,sessionSummary} from "../worker/design.mjs";
import {localDB} from "../scripts/database.mjs";
function fixture(){
 const db=localDB(), env={DB:db,RESEARCH_OWNER_EMAIL:"owner@example.test"};
 const token="a1".repeat(32);
 async function send(route,body,headers={}){
  const r=await api(new Request("https://test.invalid/api/"+route,{method:body?"POST":"GET",headers:{Authorization:"Bearer "+token,...headers},body:body?JSON.stringify(body):undefined}),env);
  return r;
 }
 async function data(route,body){const r=await send(route,body);assert.equal(r.status,200,route);return r.json();}
 async function start(protocol="vertical"){return data("start",{protocol,consent:CONSENT,preview:true});}
 async function action(s,type,surface="results",extra={}){return data("action",{id:crypto.randomUUID(),revision:s.revision,action:type,surface,...extra});}
 const row=()=>db.prepare("SELECT * FROM sessions LIMIT 1").first();
 return {db,send,data,start,action,row};
}
test("four arms have identical numeric cues within each quality; six entirely new hotels follow slot 7",()=>{
 for(const highFirst of [true,false]){
  const layout={...initialLayout("vertical"),highFirst};const cards={};
  for(const arm of ["old_high","new_high","old_low","new_low"]){
   const session={layout,arm,protocol:"vertical",released:13,session_id:"test"};
   const seq=ranks(session); cards[arm]=publicState(session).cards;
   const prior=new Set(seq.slice(0,6).map(x=>x.id)), tail=seq.slice(7).map(x=>x.id);
   assert.equal(prior.has(seq[6].id),arm.startsWith("old"));
   assert.equal(seq[6].profile,arm.split("_")[1]);assert.equal(new Set(tail).size,6);
   assert(tail.every(x=>!seq.slice(0,7).some(prev=>prev.id===x)));
   assert.equal(seq.filter(x=>x.profile.startsWith("m")).length,10);
  }
  for(const q of ["high","low"]){const a=cards["old_"+q],b=cards["new_"+q];
  assert.deepEqual(a.slice(0,6),b.slice(0,6));assert.deepEqual(a.slice(7),b.slice(7));assert.notEqual(a[6].id,b[6].id);
  for(const k of ["score","stars","clean","comfort","facilities"])assert.equal(a[6][k],b[6][k]);}
 }
 for(let i=1;i<=10;i++)for(let k=0;k<5;k++){const v=profiles["m"+i][k];assert(v>=profiles.low[k]&&v<=profiles.high[k]);}
});
test("reloading and retrying keep assignment; scrolling past 7 immediately returns listings 8 and 9; history booking persists",async()=>{
 const f=fixture();let s=await f.start();assert.equal(s.cards.length,3);assert.deepEqual(s,await f.start());assert.equal(f.row().arm,null);
 s=await f.action(s,"continue");assert.equal(s.cards.length,6);
 const cmd={id:crypto.randomUUID(),revision:s.revision,action:"continue",surface:"results"};
 s=await f.data("action",cmd);assert.equal(s.cards.length,7);assert.ok(f.row().arm);assert.deepEqual(await f.data("action",cmd),s);
 s=await f.action(s,"continue","results",{method:"scroll"});assert.equal(s.survey,false);assert.equal(s.cards.length,9);
 assert.equal(f.row().critical_choice,"continue");assert.equal(f.row().critical_control,"scroll");
 assert.deepEqual(await f.data("session"),s);assert.equal(sessionSummary(f.row()).displayed_sequence.split(" ").length,9);
 s=await f.action(s,"book","history",{slot:1});assert.equal(s.outcome,"book");assert(s.survey);assert.equal(s.chosenHotel,s.cards[0].id);
 s=await f.action(s,"survey","survey",{values:{fit:55,novelty:71,annoyance:3}});assert(s.recognitionDue);
 s=await f.action(s,"recognition","finish",{answer:"same"});assert.equal(s.recognitionDue,false);
 assert.equal(f.row().chosen_source,"history");assert.equal(sessionSummary(f.row()).booked_first,1);
 assert.equal(f.db.prepare("SELECT COUNT(*) n FROM events WHERE event_type='rank_released'").first().n,9);f.db.close();
});
test("early exits are unassigned and unfinished sessions remain distinct from deliberate stop",async()=>{
 const f=fixture();let s=await f.start();assert.equal(sessionSummary(f.row()).outcome,"unfinished");s=await f.action(s,"stop");assert.equal(s.outcome,"stop");assert.equal(s.survey,false);assert.equal(f.row().arm,null);f.db.close();
});
test("pilot keeps the matched seventh listing and three new alternatives until the cap",async()=>{
 const f=fixture();let s=await f.start("pretest");for(let i=2;i<=10;i++){s=await f.action(s,"continue");assert.equal(s.cards.length,i);assert.equal(s.survey,false);}
 const seen=s.cards.slice(0,7).map(c=>c.id);assert(s.cards.slice(7).every(h=>!seen.includes(h.id)));assert.equal(new Set(s.cards.slice(7).map(c=>c.id)).size,3);
 assert.equal(f.row().critical_control,"button");s=await f.action(s,"continue");assert.equal(s.outcome,"cap");s=await f.action(s,"survey","survey",{skip:true});assert(s.recognitionDue);f.db.close();
});
test("first choice at slot 7 can be to switch; missing answers and spontaneous departure are distinct",async()=>{
 const f=fixture();let s=await f.start();s=await f.action(s,"continue");s=await f.action(s,"continue");assert.equal(f.row().critical_choice,null);
 s=await f.action(s,"switch");assert.equal(s.outcome,"switch");assert.equal(f.row().critical_choice,"switch");assert(s.survey);
 await f.action(s,"survey","survey",{skip:true});assert.equal(sessionSummary(f.row()).survey_skipped,1);f.db.close();
});
test("event retry is idempotent, invisible ranks are rejected, and exports require the owner",async()=>{
 const f=fixture();await f.start();
 const e={id:crypto.randomUUID(),type:"card_impression",slot:1,surface:"results",seq:1,page:crypto.randomUUID(),released:3,at:new Date().toISOString()};
 await f.data("events",{events:[e]});await f.data("events",{events:[e]});
 assert.equal(f.db.prepare("SELECT COUNT(*) n FROM events WHERE event_type='card_impression'").first().n,1);
 assert.equal((await f.send("events",{events:[{...e,slot:7}]})).status,400);
 assert.equal((await f.send("research/summary")).status,403);
 assert.equal((await f.send("research/export?table=events",undefined,{"oai-authenticated-user-id":"x","oai-authenticated-user-email":"other@example.test"})).status,403);
 const owner={"oai-authenticated-user-id":"owner","oai-authenticated-user-email":"owner@example.test"};
 for(const [table,expected] of [["sessions","critical_control"],["events","card_impression"],["stimuli","TURIM Lisboa Hotel"]]){
 const res=await f.send("research/export?table="+table,undefined,owner);assert.equal(res.status,200);assert((await res.text()).includes(expected));}
 f.db.close();
});
