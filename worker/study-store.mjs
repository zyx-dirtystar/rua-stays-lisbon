import { STUDY_VERSION, STUDY_CONSENT, ARMS, TRIP, ROOM, EXPOSURE_RULE, randomArm, initialOrder, normalizeQuery, configuredRows, priceFor, nightsFor, publicHotel } from "./experiment.mjs";

export class HttpIssue extends Error {
  constructor(status,message){super(message);this.status=status;}
}
export const sendJson=(value,status=200)=>new Response(JSON.stringify(value),{
  status,headers:{"Content-Type":"application/json; charset=utf-8","Cache-Control":"private, no-store","X-Content-Type-Options":"nosniff"},
});
export const isoNow=()=>new Date().toISOString();
export const uuidPattern=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const browserKeyPattern=/^[a-f0-9]{64}$/;
const encoder = new TextEncoder();
async function hashKey(value){
  const digest=await crypto.subtle.digest("SHA-256",encoder.encode(value));
  return [...new Uint8Array(digest)].map(n=>n.toString(16).padStart(2,"0")).join("");
}
export async function researcher(request,env){
  const owner=env.RESEARCH_OWNER_EMAIL?.trim().toLowerCase();
  const identified=request.headers.get("oai-authenticated-user-email")?.toLowerCase();
  if(owner && identified===owner && request.headers.get("oai-authenticated-user-id"))return true;
  const token=env.RESEARCH_ADMIN_TOKEN, auth=request.headers.get("Authorization");
  if(typeof token!=="string"||token.length<24||!auth?.startsWith("Basic "))return false;
  try{
    const [given,expected]=await Promise.all([hashKey(atob(auth.slice(6))),hashKey("researcher:"+token)]);
    return crypto.subtle.timingSafeEqual
      ? crypto.subtle.timingSafeEqual(encoder.encode(given),encoder.encode(expected))
      : equalHash(given,expected);
  }catch{return false;}
}
function equalHash(a,b){
  let diff=0;
  for(let i=0;i<a.length;i++)diff|=a.charCodeAt(i)^b.charCodeAt(i);
  return diff===0;
}
export function researcherDenied(env){
  if(env.RESEARCH_ADMIN_TOKEN)return new Response("Researcher authentication required.",{
    status:401,headers:{"WWW-Authenticate":'Basic realm="Rua Stays research", charset="UTF-8"',"Cache-Control":"private, no-store"},
  });
  return sendJson({error:"Researcher access is required."},403);
}
export async function parseInput(request){
  const raw=await request.text();
  if(raw.length>48_000)throw new HttpIssue(413,"Request is too large.");
  let data;
  try{data=JSON.parse(raw);}catch{throw new HttpIssue(400,"Invalid request body.");}
  if(!data||typeof data!=="object"||Array.isArray(data))throw new HttpIssue(400,"Invalid request body.");
  return data;
}
export async function requestKey(request){
  const key=request.headers.get("X-Study-Key")||"";
  if(!browserKeyPattern.test(key))throw new HttpIssue(401,"Start with the study information page.");
  return hashKey(key);
}
export function requireUuid(value){
  if(!uuidPattern.test(value||""))throw new HttpIssue(400,"Invalid ID.");
  return value;
}
export function keyedSession(db,key){
  return db.prepare("SELECT * FROM study_sessions WHERE browser_key_hash=?").bind(key).first();
}
async function ownedList(db,sid,requested){
  if(requested)requireUuid(requested);
  const statement=requested
    ? db.prepare("SELECT * FROM study_lists WHERE list_id=? AND session_id=?").bind(requested,sid)
    : db.prepare("SELECT * FROM study_lists WHERE session_id=? ORDER BY rowid DESC LIMIT 1").bind(sid);
  const record=await statement.first();
  if(!record)throw new HttpIssue(404,"This results list is unavailable in your session.");
  return record;
}
async function listState(db,session,listId){
  const l=await ownedList(db,session.session_id,listId);
  const query=JSON.parse(l.query_json);
  const entries=(await db.prepare("SELECT * FROM study_list_entries WHERE list_id=? ORDER BY actual_rank").bind(l.list_id).all()).results;
  return {
    session:{id:session.session_id,outcome:session.outcome},
    list:{id:l.list_id,previousId:l.previous_list_id,query,nights:nightsFor(query),total:priceFor(query),
      entries:entries.map(e=>({id:e.listing_instance_id,defaultRank:e.default_rank,rank:e.actual_rank,hotel:publicHotel(e.hotel_id)}))},
    booking:session.outcome==="booked"?{listId:session.final_list_id,instance:session.final_instance_id,hotel:publicHotel(session.final_hotel_id),at:session.closed_at}:null,
    exposure:EXPOSURE_RULE,room:ROOM,
  };
}
function listRowWrites(db,id,sid,entries){
  return entries.map(e=>db.prepare("INSERT INTO study_list_entries (list_id,listing_instance_id,hotel_id,default_rank,actual_rank) SELECT ?,?,?,?,? WHERE EXISTS (SELECT 1 FROM study_lists WHERE list_id=? AND session_id=?)")
    .bind(id,e.listing_instance_id,e.hotel_id,e.default_rank,e.actual_rank,id,sid));
}
export async function startStudy(db,key,input,allowPreview){
  if(input.consent!==STUDY_CONSENT)throw new HttpIssue(400,"Consent is required.");
  if(input.preview===true&&!allowPreview)throw new HttpIssue(403,"Researcher access is required for previews.");
  const previous=await keyedSession(db,key);
  if(previous)return listState(db,previous);
  const forced=allowPreview&&input.preview===true?ARMS.find(a=>a.id===input.previewArm):null;
  const arm=forced||randomArm(), order=initialOrder(arm), sid=crypto.randomUUID(), list=crypto.randomUUID(), at=isoNow();
  const entries=configuredRows(order,TRIP);
  await db.batch([
    db.prepare("INSERT OR IGNORE INTO study_sessions (session_id,browser_key_hash,participant_id,experiment_version,consent_version,run_type,arm,focal_quality,retarget,initial_order,consented_at,last_active_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)")
      .bind(sid,key,crypto.randomUUID(),STUDY_VERSION,STUDY_CONSENT,input.preview===true?"preview":"participant",arm.id,arm.focal_quality,arm.retarget,JSON.stringify(order),at,at),
    db.prepare("INSERT INTO study_lists (list_id,session_id,reason,created_at,query_json) SELECT ?,?,?,?,? WHERE EXISTS (SELECT 1 FROM study_sessions WHERE session_id=?)")
      .bind(list,sid,"initial",at,JSON.stringify(TRIP),sid),
    ...listRowWrites(db,list,sid,entries),
    db.prepare("INSERT INTO study_events (session_id,event_id,event_type,received_at,occurred_at,page,action,list_id) SELECT ?,?,?,?,?,?,?,? WHERE EXISTS (SELECT 1 FROM study_sessions WHERE session_id=?)")
      .bind(sid,crypto.randomUUID(),"consent_complete",at,at,"consent","agree",list,sid),
  ]);
  return listState(db,await keyedSession(db,key));
}
export async function currentStudy(db,s,list){
  return listState(db,s,s.outcome?s.final_list_id:list);
}
export async function refreshList(db,s,input){
  if(s.outcome)throw new HttpIssue(409,"This search is finished.");
  const id=requireUuid(input.id), base=await ownedList(db,s.session_id,requireUuid(input.previousId));
  const tracked=await db.prepare("SELECT session_id FROM study_lists WHERE list_id=?").bind(id).first();
  if(tracked?.session_id===s.session_id)return listState(db,s,id);
  if(tracked)throw new HttpIssue(409,"This list ID is in use.");
  if(!["search_edit","filter","sort"].includes(input.reason))throw new HttpIssue(400,"Choose a list operation.");
  let query;
  try{query=normalizeQuery(input.query);}catch(e){throw new HttpIssue(400,e.message);}
  const at=isoNow(), entries=configuredRows(JSON.parse(s.initial_order),query);
  try{
    await db.batch([
      db.prepare("INSERT INTO study_lists (list_id,session_id,previous_list_id,reason,created_at,query_json) SELECT ?,?,?,?,?,? WHERE EXISTS (SELECT 1 FROM study_sessions WHERE session_id=? AND outcome IS NULL)")
        .bind(id,s.session_id,base.list_id,input.reason,at,JSON.stringify(query),s.session_id),
      ...listRowWrites(db,id,s.session_id,entries),
      db.prepare("UPDATE study_sessions SET last_active_at=MAX(last_active_at,?) WHERE session_id=?").bind(at,s.session_id),
    ]);
  }catch(error){
    const existing=await db.prepare("SELECT session_id FROM study_lists WHERE list_id=?").bind(id).first();
    if(existing?.session_id!==s.session_id)throw error;
  }
  const latest=await keyedSession(db,s.browser_key_hash);
  if(latest.outcome)return listState(db,latest,latest.final_list_id||base.list_id);
  return listState(db,latest,id);
}
const eventTypes=new Set([
  "page_open","page_hidden","page_visible","page_exit","page_dwell","heartbeat",
  "card_loaded","viewport_enter","viewport_exit","card_impression","card_dwell","scroll_depth",
  "click","hotel_open","room_select","rate_open","booking_enter","booking_review","booking_back","return_to_results",
  "search_submit","filter_apply","sort_change","list_applied",
]);
const propertyEvents=new Set([
  "card_loaded","viewport_enter","viewport_exit","card_impression","card_dwell","hotel_open","room_select",
  "rate_open","booking_enter","booking_review","booking_back",
]);
const pages=new Set(["consent","results","property","booking","review","confirmed","ended"]);
const sources=new Set(["results","property","booking","review","browser","confirmed","ended"]);
const eventColumns="session_id,event_id,event_type,page_view_id,tab_id,event_seq,client_at,received_at,occurred_at,page,action,source,list_id,listing_instance_id,hotel_id,default_rank,actual_rank,duration_ms,visible_fraction,scroll_percent";
const binds=Array(20).fill("?").join(",");
const numeric=(v,min,max)=>typeof v==="number"&&Number.isFinite(v)&&v>=min&&v<=max?v:null;
const clientUuid=v=>typeof v==="string"&&uuidPattern.test(v)?v:null;
const clientCode=v=>typeof v==="string"&&/^[a-z][a-z0-9_]{0,48}$/.test(v)?v:null;
const clientTime=v=>typeof v==="string"&&/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(v)&&Number.isFinite(Date.parse(v))?v:null;
function valuesForEvent(s,e,entry,list,at,reported,confirmed=false){
  // Keep the reported browser clock for auditing even when server time is used for ordering.
  const bounded=reported&&reported>=s.consented_at&&Date.parse(reported)<=Date.parse(at)+60_000?reported:null;
  const sequence=numeric(e.eventSeq,1,1_000_000);
  return [s.session_id,e.id,e.type,clientUuid(e.pageViewId),clientUuid(e.tabId),sequence&&Math.floor(sequence),
    reported,at,bounded||at,pages.has(e.page)?e.page:(confirmed?"review":"results"),
    clientCode(e.action),sources.has(e.source)?e.source:null,list,entry?.listing_instance_id??null,
    entry?.hotel_id??null,entry?.default_rank??null,entry?.actual_rank??null,
    numeric(e.durationMs,0,86_400_000),numeric(e.visibleFraction,0,1),numeric(e.scrollPercent,0,100)];
}
export async function insertEvents(db,s,input){
  if(!Array.isArray(input.events)||!input.events.length||input.events.length>32)throw new HttpIssue(400,"Send 1–32 events.");
  const at=isoNow(), commands=[];
  const listIds=[...new Set(input.events.map(e=>clientUuid(e?.listId)).filter(Boolean))];
  const owned=new Map();
  if(listIds.length){
    const rows=(await db.prepare("SELECT l.list_id,v.listing_instance_id,v.hotel_id,v.default_rank,v.actual_rank FROM study_lists l LEFT JOIN study_list_entries v USING (list_id) WHERE l.session_id=? AND l.list_id IN ("+listIds.map(()=>"?").join(",")+")").bind(s.session_id,...listIds).all()).results;
    for(const row of rows){
      if(!owned.has(row.list_id))owned.set(row.list_id,new Map());
      if(row.listing_instance_id)owned.get(row.list_id).set(row.listing_instance_id,row);
    }
  }
  for(const e of input.events){
    if(!e||!clientUuid(e.id)||!eventTypes.has(e.type))continue;
    const list=owned.has(e.listId)?e.listId:null;
    const entry=list?owned.get(list).get(e.instance):null;
    if(propertyEvents.has(e.type)&&!entry)continue;
    commands.push(db.prepare("INSERT OR IGNORE INTO study_events ("+eventColumns+") VALUES ("+binds+")")
      .bind(...valuesForEvent(s,e,entry,list,at,clientTime(e.at))));
  }
  if(commands.length){
    commands.push(db.prepare("UPDATE study_sessions SET last_active_at=MAX(last_active_at,?) WHERE session_id=?").bind(at,s.session_id));
    await db.batch(commands);
  }
  return {accepted:true};
}
export async function finishStudy(db,s,input){
  const id=requireUuid(input.id), action=input.action;
  if(!["exit","confirm"].includes(action))throw new HttpIssue(400,"Invalid final action.");
  if(s.outcome)return listState(db,s,s.final_list_id||null);
  const l=await ownedList(db,s.session_id,input.listId), at=isoNow(), ending=action==="confirm"?"booked":"explicit_exit";
  const entry=action==="confirm"?await db.prepare("SELECT * FROM study_list_entries WHERE list_id=? AND listing_instance_id=?")
    .bind(l.list_id,String(input.instance||"")).first():null;
  if(action==="confirm"&&(!entry||input.rate!==ROOM.id))throw new HttpIssue(400,"Select an available room before confirming.");
  const context=input.context&&typeof input.context==="object"?input.context:{};
  const event={...context,id,type:action==="confirm"?"booking_confirm":"explicit_exit",action:action==="confirm"?"confirm_booking":"exit_search"};
  await db.batch([
    db.prepare("UPDATE study_sessions SET outcome=?,closed_at=?,last_active_at=MAX(last_active_at,?),final_list_id=?,final_instance_id=?,final_hotel_id=?,final_action_id=? WHERE session_id=? AND outcome IS NULL")
      .bind(ending,at,at,l.list_id,entry?.listing_instance_id??null,entry?.hotel_id??null,id,s.session_id),
    db.prepare("INSERT OR IGNORE INTO study_events ("+eventColumns+") SELECT "+binds+" WHERE EXISTS (SELECT 1 FROM study_sessions WHERE session_id=? AND final_action_id=?)")
      .bind(...valuesForEvent(s,event,entry,l.list_id,at,clientTime(context.at),true),s.session_id,id),
  ]);
  const saved=await keyedSession(db,s.browser_key_hash);
  return listState(db,saved,saved.final_list_id||l.list_id);
}
