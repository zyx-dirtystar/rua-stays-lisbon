import { VERSION, CONSENT, protocols, profiles, identities, initialLayout, assignArm, ranks, servedCount, publicState, sessionSummary } from "./design.mjs";
const json=(body,code=200)=>new Response(JSON.stringify(body),{status:code,headers:{"Content-Type":"application/json; charset=utf-8","Cache-Control":"private, no-store","X-Content-Type-Options":"nosniff"}});
class Problem extends Error{constructor(status,message){super(message);this.status=status;}}
function validate(ok,message){if(!ok)throw new Problem(400,message);}
const now=()=>new Date().toISOString();
const uuid=/^[a-f0-9-]{36}$/i;
const surfaces=new Set(["results","history","details","checkout","task","survey","finish","page"]);
const controls=new Set(["background","image","title","details","ratings","room","reserve","confirm","back","close","help","history","history_item","continue","stop","switch","survey_submit","survey_skip","recognition_submit","recognition_skip","resume","terms","choice_cancel","finish","trip","photo","consent","view_results"]);
const passive=new Set(["ui_click","card_impression","card_dwell","detail_open","detail_dwell","ratings_open","history_open","checkout_open","dialog_close","page_hidden","page_visible","page_open","scroll_depth","page_exit","booking_cancel"]);
const bounded=(v,lo,hi)=>Number.isInteger(v)&&v>=lo&&v<=hi?v:null;
const fields="session_id,event_id,event_type,received_at,client_at,client_seq,page_id,slot,hotel_id,surface,control,duration_ms,progress,last_released";
async function sessionId(request){
  const token=(request.headers.get("Authorization")||"").replace(/^Bearer /,"");
  if(!/^[a-f0-9]{64}$/.test(token))throw new Problem(401,"Please start or resume this search in its original tab.");
  const digest=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(token));
  return Array.from(new Uint8Array(digest),x=>x.toString(16).padStart(2,"0")).join("");
}
async function bodyOf(request){
  if(Number(request.headers.get("Content-Length"))>48000)throw new Problem(413,"This event batch is too large.");
  const s=await request.text();validate(s.length<=48000,"This event batch is too large.");
  try{return JSON.parse(s);}catch{throw new Problem(400,"Invalid request.");}
}
function eventInsert(db,vals,commandGuard){
  const params=vals.map(x=>x??null);
  return commandGuard?db.prepare("INSERT OR IGNORE INTO events ("+fields+") SELECT "+params.map(()=>"?").join(",")+" WHERE EXISTS (SELECT 1 FROM sessions WHERE session_id=? AND last_command=?)").bind(...params,vals[0],commandGuard):db.prepare("INSERT OR IGNORE INTO events ("+fields+") VALUES ("+params.map(()=>"?").join(",")+")").bind(...params);
}
const fetchSession=(db,id)=>db.prepare("SELECT * FROM sessions WHERE session_id=?").bind(id).first();
function commandEvent(db,s,key,label,slot,id,surface,at,guard,control=null){
  return eventInsert(db,[s.session_id,"srv-"+key+"-"+label+"-"+(slot||0),label,at,null,null,null,slot,id,surface,control,null,null,servedCount(s)],guard);
}
async function begin(db,id,input){
  validate(Object.hasOwn(protocols,input.protocol)&&input.consent===CONSENT,"Please read the study information before starting.");
  const stamp=now(),level=protocols[input.protocol].levels[0],variant=JSON.stringify(initialLayout(input.protocol));
  const runType=input.preview===true?"preview":"participant";
  // Only the winning initial insert supplies the layout. A retried start reuses the original layout.
  const marker=crypto.randomUUID(),s={protocol:input.protocol,arm:null,layout:variant,released:level,session_id:id};
  const q=db.prepare("INSERT OR IGNORE INTO sessions (session_id,protocol,version,run_type,consent_version,layout,released,started_at,last_active_at,last_command) VALUES (?,?,?,?,?,?,?,?,?,?)").bind(id,input.protocol,VERSION,runType,CONSENT,variant,level,stamp,stamp,marker);
  const logs=[commandEvent(db,s,marker,"consent_start",null,null,"task",stamp,marker)];
  ranks(s).slice(0,level).forEach((h,i)=>logs.push(commandEvent(db,s,marker,"rank_released",i+1,h.id,"results",stamp,marker)));
  await db.batch([q,...logs]);
  return json(publicState(await fetchSession(db,id)));
}
async function events(db,s,body){
  validate(Array.isArray(body.events)&&body.events.length>0&&body.events.length<=40,"Invalid event batch.");
  const stamp=now(),order=ranks(s);
  const statements=body.events.map(e=>{
    validate(e&&uuid.test(e.id)&&passive.has(e.type)&&surfaces.has(e.surface),"Unknown event.");
    const slot=e.slot==null?null:bounded(e.slot,1,servedCount(s));
    validate(e.slot==null||slot,"Unknown listing.");
    const at=typeof e.at==="string"&&/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(e.at)?e.at:null;
    return eventInsert(db,[s.session_id,e.id,e.type,stamp,at,bounded(e.seq,1,1000000),uuid.test(e.page)?e.page:null,slot,slot?order[slot-1]?.id:null,e.surface,controls.has(e.control)?e.control:null,bounded(e.ms,0,86400000),bounded(e.pct,0,100),bounded(e.released,1,servedCount(s))]);
  });
  statements.push(db.prepare("UPDATE sessions SET last_active_at=MAX(last_active_at,?) WHERE session_id=?").bind(stamp,s.session_id));
  await db.batch(statements);
  return json({saved:true});
}
function surveyValues(input){
  if(input.skip===true)return {survey_skipped:1};
  const v=input.values||{};
  validate(bounded(v.fit,0,100)!==null&&bounded(v.novelty,0,100)!==null&&bounded(v.annoyance,1,7)!==null,"Please answer each question or skip.");
  return {fit:v.fit,novelty:v.novelty,annoyance:v.annoyance,survey_skipped:0};
}
async function command(db,s,input){
  validate(uuid.test(input.id)&&Number.isInteger(input.revision),"Invalid action.");
  if(s.last_command===input.id||s.revision!==input.revision)return json(publicState(s));
  const p=protocols[s.protocol],stamp=now(),order=ranks(s);
  const next={...s},changes={},logs=[];let slot=s.released,hotel=order[slot-1]?.id,surface=input.surface;
  validate(surfaces.has(surface),"Unknown entry point.");
  if(input.action==="survey"){
    validate(s.survey_pending,"This questionnaire is already complete.");
    changes.beliefs=JSON.stringify(surveyValues(input));changes.survey_pending=0;
  }else if(input.action==="recognition"){
    validate(s.arm&&s.outcome&&!s.survey_pending&&s.recognition===null,"Recognition is unavailable.");
    validate(["same","similar","new","unsure","skipped"].includes(input.answer),"Please select an answer.");
    changes.recognition=input.answer;
  }else{
    validate(!s.outcome&&!s.survey_pending,"This search has already advanced.");
    validate(["continue","book","stop","switch"].includes(input.action),"Unknown search action.");
    if(input.action==="book"){
      slot=bounded(input.slot,1,s.released);validate(slot&&order[slot-1],"Unknown hotel.");hotel=order[slot-1].id;
      validate(["history","results"].includes(surface),"Unknown booking entry.");
      Object.assign(changes,{chosen_hotel:hotel,chosen_slot:slot,chosen_source:surface});
    }
    if(s.arm&&s.released===p.critical&&s.critical_choice===null){
      Object.assign(changes,{critical_choice:input.action,critical_choice_at:stamp,critical_choice_slot:slot,critical_source:surface,critical_control:input.action==='continue'?(input.method==='scroll'?'scroll':'button'):input.action});
    }
    if(input.action==="continue"&&s.released<p.max){
      changes.released=p.levels.find(n=>n>s.released);
      if(changes.released===p.critical&&!s.arm){
        changes.arm=assignArm(s.protocol);changes.assigned_at=stamp;
      }
    }else{
      Object.assign(changes,{outcome:input.action==="continue"?"cap":input.action,finished_at:stamp,survey_pending:s.arm&&s.beliefs===null?1:0});
    }
  }
  Object.assign(changes,{revision:s.revision+1,last_command:input.id,last_active_at:stamp});Object.assign(next,changes);
  const keys=Object.keys(changes);
  const write=db.prepare("UPDATE sessions SET "+keys.map(k=>k+"=?").join(",")+" WHERE session_id=? AND revision=?").bind(...keys.map(k=>changes[k]),s.session_id,s.revision);
  logs.push(commandEvent(db,next,input.id,"action_"+input.action,slot,hotel,surface,stamp,input.id,input.action==="continue"?(input.method==="scroll"?"scroll":"button"):null));
  if(changes.arm)logs.push(commandEvent(db,next,input.id,"randomized",p.critical,null,"results",stamp,input.id));
  // Record availability independently of viewport exposure.
  const from=servedCount(s);
  const through=servedCount(next);
  const sequence=ranks(next);for(let k=from+1;k<=through;k++)logs.push(commandEvent(db,next,input.id,"rank_released",k,sequence[k-1].id,"results",stamp,input.id));
  if(changes.outcome)logs.push(commandEvent(db,next,input.id,"outcome_"+changes.outcome,slot,hotel,surface,stamp,input.id));
  await db.batch([write,...logs]);
  return json(publicState(await fetchSession(db,s.session_id)));
}
const sessionHeaders=["session_id","version","run_type","protocol","consent_version","arm","critical_slot","first_hotel","old_high_or_matched","new_high_or_matched","old_low","new_low","critical_hotel","assigned_at","last_released","critical_first_choice","critical_choice_at","critical_choice_slot","critical_source","critical_control","outcome","chosen_hotel","chosen_slot","chosen_source","booked_first","booked_previously_shown_target","started_at","last_active_at","finished_at","fit","novelty","annoyance","survey_skipped","recognition","displayed_sequence"];
const eventHeaders=["session_id","version","protocol","run_type","arm","event_id","event_type","slot","hotel_id","surface","control","client_seq","page_id","client_at","received_at","duration_ms","progress","last_released"];
function csvCell(value){const s=String(value??"");return '"'+s.replaceAll('"','""')+'"';}
function csvResponse(type,header,getPage){
  const enc=new TextEncoder();let first=true,offset=0;
  const stream=new ReadableStream({async pull(controller){
    if(first){first=false;controller.enqueue(enc.encode("\uFEFF"+header.join(",")+"\r\n"));}
    const rows=await getPage(offset,250);
    if(rows.length)controller.enqueue(enc.encode(rows.map(r=>header.map(k=>csvCell(r[k])).join(",")).join("\r\n")+"\r\n"));
    offset+=rows.length;if(rows.length<250)controller.close();
  }});
  return new Response(stream,{headers:{"Content-Type":"text/csv; charset=utf-8","Content-Disposition":'attachment; filename="rua-'+type+'-'+now().slice(0,10)+'.csv"',"Cache-Control":"private, no-store","X-Content-Type-Options":"nosniff"}});
}
async function research(request,db,env,url){
  const email=request.headers.get("oai-authenticated-user-email")||"";
  if(!env.RESEARCH_OWNER_EMAIL||!request.headers.get("oai-authenticated-user-id")||email.toLowerCase()!==env.RESEARCH_OWNER_EMAIL.trim().toLowerCase())return json({error:"Researcher access is required. Open this page with the site owner account."},403);
  if(url.pathname==="/api/research/summary"){
    const counts=await db.prepare("SELECT protocol,run_type,COALESCE(arm,'unassigned') arm,COUNT(*) sessions,SUM(arm IS NOT NULL) assigned,SUM(outcome='book') booked,SUM(outcome='stop') stopped,SUM(outcome='switch') switched,SUM(outcome='cap') capped,SUM(outcome IS NULL) unfinished,SUM(critical_choice='continue') continued,SUM(arm IS NOT NULL AND critical_choice IS NULL) critical_missing FROM sessions GROUP BY protocol,run_type,arm ORDER BY protocol,run_type,arm").all();
    return json({counts:counts.results,version:VERSION});
  }
  if(url.pathname!=="/api/research/export")return json({error:"Unknown report."},404);
  const table=url.searchParams.get("table");
  if(table==="sessions")return csvResponse(table,sessionHeaders,async(o,n)=>(await db.prepare("SELECT * FROM sessions ORDER BY rowid LIMIT ? OFFSET ?").bind(n,o).all()).results.map(sessionSummary));
  if(table==="events")return csvResponse(table,eventHeaders,async(o,n)=>(await db.prepare("SELECT s.version,s.protocol,s.run_type,s.arm,e.* FROM events e JOIN sessions s USING(session_id) ORDER BY e.rowid LIMIT ? OFFSET ?").bind(n,o).all()).results);
  if(table==="stimuli"){
    const rows=Object.entries(profiles).map(([profile,[stars,score,clean,comfort,facilities,booking_rank,source]])=>({profile,stars,score,clean,comfort,facilities,booking_rank,source,price_eur:100,location:"Parque Eduardo VII area",terms:"Double room; private bathroom; free cancellation",identity:profile.startsWith("m")?Object.keys(identities)[3+Number(profile.slice(1))]:"See per-session layout; aliases and photos are rotated"}));
    return csvResponse(table,Object.keys(rows[0]),async(o,n)=>rows.slice(o,o+n));
  }
  throw new Problem(400,"Choose a valid export.");
}
export async function api(request,env){
  try{
    const url=new URL(request.url),db=env.DB;if(!db)return json({error:"Data recording is unavailable. Please try again later."},503);
    if(url.pathname.startsWith("/api/research/")&&request.method==="GET")return await research(request,db,env,url);
    const id=await sessionId(request);
    if(request.method==="POST"&&url.pathname==="/api/start")return await begin(db,id,await bodyOf(request));
    const s=await fetchSession(db,id);if(!s)return json({error:"This search has not started yet."},404);
    if(request.method==="GET"&&url.pathname==="/api/session")return json(publicState(s));
    if(request.method==="POST"&&url.pathname==="/api/events")return await events(db,s,await bodyOf(request));
    if(request.method==="POST"&&url.pathname==="/api/action")return await command(db,s,await bodyOf(request));
    return json({error:"Unknown route."},404);
  }catch(err){return json({error:err instanceof Problem?err.message:"Could not save progress. Please retry."},err instanceof Problem?err.status:503);}
}
