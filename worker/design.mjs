export const VERSION = "lisbon-2026-11-v2";
export const CONSENT = "lisbon-web-1";
export const protocols = {
  vertical: { critical: 7, max: 13, levels: [3, 6, 7, 9, 11, 13], label: "高低质量 · 第 7 位" },
  pretest:  { critical: 7, max: 10, levels: [1,2,3,4,5,6,7,8,9,10], label: "相近酒店 · 第 7 位" }
};
const names = ["Pátio do Sol", "Casa da Brisa", "Vila do Cedro", "Pátio da Lua", "Casa Olival", "Jardim do Cobre", "Largo da Lapa", "Vila Calçada", "Casa da Vela", "Casa do Arco", "Jardim Aurora", "Pátio do Norte", "Largo das Flores", "Vila do Prado"];
export const identities = Object.fromEntries(names.map((name,i) => {
  const id = "s" + String(i+1).padStart(2,"0");
  return [id,{id,name,photo:"/photos/room-"+String(i+1).padStart(2,"0")+".webp"}];
}));
// Order: stars, overall, cleanliness, comfort, facilities. Only these cues vary with quality.
export const profiles = {
  high: [4,9.1,9.5,9.6,9.2,19,"TURIM Lisboa Hotel"],
  low: [3,8.1,8.6,8.3,8.0,11,"SANA Rex Hotel"],
  even: [3,9.0,9.0,9.0,9.0,null,"Matched pilot profile"],
  m1: [4,8.7,9.1,9.0,8.8,2,"SANA Metropolitan Hotel"],
  m2: [4,8.4,8.8,8.8,8.4,3,"Eurostars Lisboa Parque"],
  m3: [4,8.7,9.1,9.1,8.9,4,"SANA Malhoa Hotel"],
  m4: [4,8.6,8.9,9.0,8.7,7,"HF Fénix Lisboa"],
  m5: [3,8.6,9.0,8.9,8.7,9,"Dorma Liberdade"],
  m6: [3,8.4,8.8,8.7,8.4,10,"America Diamonds Hotel"],
  m7: [3,8.7,9.0,8.9,8.6,12,"Ibis Styles Lisboa Centro Marquês de Pombal"],
  m8: [4,8.7,9.0,9.0,8.7,15,"TURIM Saldanha Hotel"],
  m9: [3,8.7,9.1,9.2,8.9,16,"Holiday Inn Express & Suites Lisbon – Príncipe Real"],
  m10: [3,8.8,9.2,9.1,8.8,18,"Hotel Avenida Park"]
};
function uniform(n) {
  const limit=0x100000000 - 0x100000000 % n, v=new Uint32Array(1);
  do { crypto.getRandomValues(v); } while (v[0]>=limit);
  return v[0]%n;
}
function shuffle(values) {
  const a=values.slice();
  for(let i=a.length-1;i>0;i--){const j=uniform(i+1); [a[i],a[j]]=[a[j],a[i]];}
  return a;
}
export function initialLayout(protocol) {
  const pool=Object.keys(identities), focal=shuffle(pool.slice(0,4));
  // Assignment of photos/aliases to high, low, seen and unseen is independent of later treatment.
  return {focal,highFirst:uniform(2)===0,middle:pool.slice(4), protocol};
}
export function assignArm(protocol){
  const arms=protocol==="pretest"?["old_matched","new_matched"]:["old_high","new_high","old_low","new_low"];
  return arms[uniform(arms.length)];
}
export function ranks(session) {
  const layout=typeof session.layout==="string"?JSON.parse(session.layout):session.layout;
  const [ho,hn,lo,ln]=layout.focal;
  const mid=layout.middle.map((id,i)=>({id,profile:"m"+(i+1)}));
  const elt=(id,profile)=>({id,profile});
  if(session.protocol==="pretest"){
    const equal=id=>elt(id,"even");
    return [equal(ho),...mid.slice(0,5).map(m=>equal(m.id)),session.arm?equal(session.arm==="old_matched"?ho:hn):null,...mid.slice(5,8).map(m=>equal(m.id))];
  }
  const high=elt(ho,"high"),low=elt(lo,"low");
  const treatments={old_high:high,new_high:elt(hn,"high"),old_low:low,new_low:elt(ln,"low")};
  return [layout.highFirst?high:low,mid[0],layout.highFirst?low:high,...mid.slice(1,4),treatments[session.arm]||null,...mid.slice(4)];
}
export function servedCount(s) {
  return s.released;
}
export function publicState(s) {
  const visible = servedCount(s);
  const cards=ranks(s).slice(0,visible).map(({id,profile},i)=>{
    const [stars,score,clean,comfort,facilities]=profiles[profile];
    return {...identities[id],slot:i+1,stars,score,clean,comfort,facilities};
  });
  return {id:s.session_id.slice(0,10),protocol:s.protocol,revision:s.revision,cards,hasMore:s.released<protocols[s.protocol].max,outcome:s.outcome,chosenHotel:s.chosen_hotel,chosenSlot:s.chosen_slot,survey:!!s.survey_pending,recognitionDue:!!(s.outcome && s.arm && !s.survey_pending && s.recognition===null)};
}
export function sessionSummary(s) {
  const design=typeof s.layout==="string"?JSON.parse(s.layout):s.layout, ordered=ranks(s), visible=servedCount(s);
  const c=protocols[s.protocol].critical, target=ordered[c-1], reference=s.arm?.endsWith("low")?design.focal[2]:design.focal[0];
  return {session_id:s.session_id,version:s.version,run_type:s.run_type,protocol:s.protocol,consent_version:s.consent_version,arm:s.arm,critical_slot:c,first_hotel:ordered[0].id,old_high_or_matched:design.focal[0],new_high_or_matched:design.focal[1],old_low:s.protocol==="vertical"?design.focal[2]:null,new_low:s.protocol==="vertical"?design.focal[3]:null,critical_hotel:target?.id,assigned_at:s.assigned_at,last_released:visible,critical_first_choice:s.critical_choice,critical_choice_at:s.critical_choice_at,critical_choice_slot:s.critical_choice_slot,critical_source:s.critical_source,critical_control:s.critical_control,outcome:s.outcome||"unfinished",chosen_hotel:s.chosen_hotel,chosen_slot:s.chosen_slot,chosen_source:s.chosen_source,booked_first:s.outcome==="book"?Number(s.chosen_hotel===ordered[0].id):null,booked_previously_shown_target:s.outcome==="book"&&s.arm?Number(s.chosen_hotel===reference):null,started_at:s.started_at,last_active_at:s.last_active_at,finished_at:s.finished_at,...(s.beliefs?JSON.parse(s.beliefs):{}),recognition:s.recognition,displayed_sequence:ordered.slice(0,visible).map(x=>x.id).join(" ")};
}
