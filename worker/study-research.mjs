import { ARMS, STUDY_VERSION, INACTIVITY_MS, CRITICAL_RANK, HOTELS, ROOM } from "./experiment.mjs";
import { HttpIssue, isoNow, requireUuid, researcher, researcherDenied, sendJson } from "./study-store.mjs";

const sessionFields=["participant_id","session_id","experiment_version","consent_version","run_type","arm","focal_quality","retarget","consented_at","last_active_at",
  "status","activity_status","exit_reason","closed_at","initial_list_id","focal_hotel_id","planned_critical_hotel_id","focal_exposed_at","critical_reached_at","critical_exposed_at",
  "first_after_critical","first_after_critical_at","first_after_critical_hotel_id","first_after_critical_actual_rank","first_after_critical_event_id","continued_to_new",
  "final_list_id","final_instance_id","final_hotel_id","booked_focal"];
const rankingFields=["participant_id","session_id","experiment_version","run_type","arm","list_id","previous_list_id","reason","created_at","query_json","listing_instance_id","hotel_id","default_rank","actual_rank"];
const activityFields=["participant_id","session_id","experiment_version","run_type","arm","focal_quality","retarget","event_id","event_type","page_view_id","tab_id","event_seq",
  "client_at","received_at","occurred_at","page","action","source","list_id","listing_instance_id","hotel_id","default_rank","actual_rank","duration_ms","visible_fraction","scroll_percent"];
const withIdentity="s.participant_id,s.session_id,s.experiment_version,s.run_type,s.arm";
const listColumns="l.list_id,l.previous_list_id,l.reason,l.created_at,l.query_json,v.listing_instance_id,v.hotel_id,v.default_rank,v.actual_rank";
function sessionStatus(row,expires){
  const {outcome,...rest}=row;
  return {...rest,status:outcome||"unfinished",activity_status:outcome?"closed":row.last_active_at<expires?"timed_out":"active",
    exit_reason:outcome==="explicit_exit"?"button":outcome==="booked"?null:"unknown"};
}
function csvValue(value){
  if(value==null)return "";
  const str=String(value);
  const safe=typeof value==="string"&&/^[=+\-@\t\r\n]/.test(str)?"'"+str:str;
  return '"'+safe.replaceAll('"','""')+'"';
}
function streamCSV(table,fields,page){
  const bytes=new TextEncoder();
  let after=0, started=false;
  const stream=new ReadableStream({async pull(controller){
    if(!started){
      started=true;
      controller.enqueue(bytes.encode("\uFEFF"+fields.join(",")+"\r\n"));
      return;
    }
    try{
      const rows=await page(after,200);
      if(!rows.length){controller.close();return;}
      after=rows.at(-1).cursor;
      controller.enqueue(bytes.encode(rows.map(r=>fields.map(f=>csvValue(r[f])).join(",")).join("\r\n")+"\r\n"));
    }catch(error){controller.error(error);}
  }});
  return new Response(stream,{headers:{"Content-Type":"text/csv; charset=utf-8","Cache-Control":"private, no-store",
    "Content-Disposition":'attachment; filename="rua-v3-'+table+'-'+isoNow().slice(0,10)+'.csv"',"X-Content-Type-Options":"nosniff"}});
}
async function summary(db,run,expires){
  const rows=(await db.prepare(`SELECT arm,COUNT(*) AS sessions,
    SUM(critical_reached_at IS NOT NULL) AS reached,SUM(critical_exposed_at IS NOT NULL) AS exposed,
    SUM(critical_exposed_at IS NOT NULL AND first_after_critical IS NULL) AS first_missing,
    SUM(continued_to_new=1) AS continued,SUM(outcome='booked') AS booked,
    SUM(booked_focal=1) AS booked_focal,SUM(outcome='explicit_exit') AS exited,
    SUM(outcome IS NULL) AS unfinished,SUM(outcome IS NULL AND last_active_at<?) AS timed_out
    FROM study_session_metrics WHERE run_type=? GROUP BY arm`).bind(expires,run).all()).results;
  return {version:STUDY_VERSION,criticalRank:CRITICAL_RANK,run,metrics:ARMS.map(a=>({arm:a.id,...(rows.find(r=>r.arm===a.id)||{})}))};
}
async function latestSessions(db,run,expires){
  const rows=(await db.prepare("SELECT * FROM study_session_metrics WHERE run_type=? ORDER BY consented_at DESC LIMIT 100").bind(run).all()).results;
  return {items:rows.map(s=>sessionStatus(s,expires))};
}
async function timeline(db,sid,offset,expires){
  const row=await db.prepare("SELECT * FROM study_session_metrics WHERE session_id=?").bind(sid).first();
  if(!row)throw new HttpIssue(404,"Session not found.");
  const pageSize=150;
  const items=(await db.prepare("SELECT * FROM study_events WHERE session_id=? ORDER BY occurred_at,rowid LIMIT ? OFFSET ?").bind(sid,pageSize+1,offset).all()).results;
  const lists=(await db.prepare("SELECT "+listColumns+" FROM study_lists l LEFT JOIN study_list_entries v USING(list_id) WHERE l.session_id=? ORDER BY l.rowid,v.actual_rank").bind(sid).all()).results;
  return {session:sessionStatus(row,expires),events:items.slice(0,pageSize),lists,next:items.length>pageSize?offset+pageSize:null};
}
function exportRecords(db,table,run,sid,expires){
  const restriction=" AND (?='all' OR s.run_type=?) AND (? IS NULL OR s.session_id=?)";
  const args=[run,run,sid,sid];
  if(table==="sessions"){
    return streamCSV(table,sessionFields,async(after,limit)=>{
      const r=await db.prepare("SELECT s.rowid AS cursor,m.* FROM study_sessions s JOIN study_session_metrics m USING(session_id) WHERE s.rowid>?"+restriction+" ORDER BY s.rowid LIMIT ?").bind(after,...args,limit).all();
      return r.results.map(s=>sessionStatus(s,expires));
    });
  }
  if(table==="rankings"){
    // Give even an empty filtered list a row so every list version is attributable.
    return streamCSV(table,rankingFields,async(after,limit)=>(await db.prepare(
      "SELECT (l.rowid*32+COALESCE(v.actual_rank,0)) AS cursor,"+withIdentity+","+listColumns+" FROM study_lists l JOIN study_sessions s USING(session_id) LEFT JOIN study_list_entries v USING(list_id) WHERE (l.rowid*32+COALESCE(v.actual_rank,0))>?"+restriction+" ORDER BY l.rowid,v.actual_rank LIMIT ?").bind(after,...args,limit).all()).results);
  }
  if(table==="events"){
    return streamCSV(table,activityFields,async(after,limit)=>(await db.prepare(
      "SELECT e.rowid AS cursor,"+withIdentity+",s.focal_quality,s.retarget,e.* FROM study_events e JOIN study_sessions s USING(session_id) WHERE e.rowid>?"+restriction+" ORDER BY e.rowid LIMIT ?").bind(after,...args,limit).all()).results);
  }
  if(table==="stimuli"){
    const rows=Object.values(HOTELS).map((h,i)=>({...h,room_size:ROOM.size,cost_eur:ROOM.euros,terms:ROOM.includes.join(", "),cursor:i+1}));
    return streamCSV(table,["id","name","sourceRank","sourceHotel","stars","score","cleanliness","comfort","facilities","room_size","cost_eur","terms","photo"],async after=>rows.filter(r=>r.cursor>after));
  }
  throw new HttpIssue(400,"Choose a CSV table.");
}
export async function researchRoute(request,env,url){
  if(!await researcher(request,env))return researcherDenied(env);
  const db=env.DB, endpoint=url.pathname, marked=url.searchParams.get("run");
  const run=marked==="preview"?"preview":"participant";
  const expires=new Date(Date.now()-INACTIVITY_MS).toISOString();
  if(endpoint==="/api/research/summary")return sendJson(await summary(db,run,expires));
  if(endpoint==="/api/research/sessions")return sendJson(await latestSessions(db,run,expires));
  if(endpoint==="/api/research/timeline"){
    const sid=requireUuid(url.searchParams.get("session"));
    const offset=Math.max(0,Math.min(1_000_000,parseInt(url.searchParams.get("offset")||"0",10)||0));
    return sendJson(await timeline(db,sid,offset,expires));
  }
  if(endpoint==="/api/research/export"){
    const requested=url.searchParams.get("session");
    const sid=requested?requireUuid(requested):null;
    return exportRecords(db,url.searchParams.get("table"),marked==="all"||sid?"all":run,sid,expires);
  }
  throw new HttpIssue(404,"Report not found.");
}
