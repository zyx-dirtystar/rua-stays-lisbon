import { consentPage, resultsPage, hotelPage, checkoutPage, terminalPage, errorPage } from "./views.mjs";
import { createTracker } from "./observe.mjs";

const content=document.querySelector("#content"), notice=document.querySelector("#notice");
const exitButton=document.querySelector('[data-control="exit_search"]');
const queryStart=new URLSearchParams(location.search), isPreview=queryStart.get("preview")==="1";
const launch=/^[a-z0-9_-]{1,72}$/i.test(queryStart.get("test")||"")?queryStart.get("test"):"default";
const previewArm=queryStart.get("arm")||null;
const scope="rua-v3:"+(isPreview?"preview:"+launch:"participant");
const tokenKey=scope+":study-key";
if(isPreview){
  const jump=document.createElement("a");
  jump.href="/research";jump.textContent="Research dashboard";
  document.querySelector(".site-footer .frame").append(jump);
}
history.scrollRestoration="manual";
let key=localStorage.getItem(tokenKey), state=null, page="consent", instance=null, busy=false, tracking=false, messageTimer, listAttempt=null;
let routeURL=location.href.split("#")[0];

async function request(url,data,flags={}){
  const options={method:data===undefined?"GET":"POST",headers:{"X-Study-Key":key||""},credentials:"same-origin",cache:"no-store",...flags};
  if(data!==undefined){options.headers["Content-Type"]="application/json";options.body=JSON.stringify(data);}
  let res;
  try{res=await fetch(url,options);}catch{throw Error("Connection lost. Try again when you’re back online.");}
  let payload;
  try{payload=await res.json();}catch{payload={};}
  if(!res.ok){
    const error=Error(payload.error||(res.status===401?"Researcher access is required for this preview.":"Could not load the search. Please try again."));
    error.status=res.status;throw error;
  }
  return payload;
}
const tracker=createTracker(scope,request);
function toast(text){
  notice.textContent=text;notice.hidden=false;
  clearTimeout(messageTimer);
  messageTimer=setTimeout(()=>{notice.hidden=true;},6500);
}
function navigation(path,includeList=true){
  const qs=new URLSearchParams();
  if(isPreview){qs.set("preview","1");qs.set("test",launch);if(previewArm)qs.set("arm",previewArm);}
  if(includeList&&state?.list.id)qs.set("list",state.list.id);
  return path+(qs.size?"?"+qs:"");
}
function currentEntry(){
  return state?.list.entries.find(e=>e.id===instance);
}
function rememberPosition(){
  if(page==="results"&&state)sessionStorage.setItem(scope+":scroll:"+state.list.id,String(Math.round(window.scrollY)));
}
function alignPage(restore){
  requestAnimationFrame(()=>{
    const id=location.hash.slice(1);
    if(id&&document.getElementById(id)){
      document.getElementById(id).scrollIntoView({block:"start",behavior:"instant"});
      return;
    }
    const position=restore&&page==="results"?Number(sessionStorage.getItem(scope+":scroll:"+state.list.id)||0):0;
    window.scrollTo({top:position,behavior:"instant"});
  });
}
function roomSelectionKey(){
  return scope+":selection:"+state.list.id+":"+instance;
}
function paint(next,{restore=false,historyMode="none",newDocument=true}={}){
  rememberPosition();
  const wasTracking=tracking;
  state=next;
  const path=location.pathname, parts=path.split("/");
  instance=/^p(0[1-9]|1[0-3])$/.test(parts[2]||"")?parts[2]:null;
  if(!state){
    page="consent";content.innerHTML=consentPage();exitButton.hidden=true;
    tracker.setView(null);tracking=false;return;
  }
  if(state.session.outcome){
    page=state.session.outcome==="booked"?"confirmed":"ended";
    const target=navigation("/"+page);
    if(location.pathname!=="/"+page)history.replaceState(null,"",target);
  }else if(instance&&path.startsWith("/hotel/"))page="property";
  else if(instance&&path.startsWith("/booking/"))page="booking";
  else if(instance&&path.startsWith("/review/"))page="review";
  else{
    page="results";instance=null;
    const target=navigation("/search")+(historyMode==="none"?location.hash:"");
    if(historyMode==="push")history.pushState(null,"",target);
    if(historyMode==="replace"||path!=="/search")history.replaceState(null,"",target);
  }
  const entry=currentEntry();
  const isFinal=page==="confirmed"||page==="ended";
  exitButton.hidden=isFinal;
  if(isFinal){instance=state.booking?.instance??null;content.innerHTML=terminalPage(state);}
  else if(page==="results"){content.innerHTML=resultsPage(state,navigation);}
  else if(!entry){content.innerHTML=errorPage("This room is unavailable in your selected results.",navigation);}
  else if(page==="property"){
    content.innerHTML=hotelPage(state,entry,navigation);
    const f=document.querySelector("#room-pick");
    const selection=sessionStorage.getItem(roomSelectionKey())||"0";
    f.elements.quantity.value=selection;
    f.querySelector('[type="submit"]').disabled=selection!=="1";
  }else content.innerHTML=checkoutPage(state,entry,navigation,page==="review");
  tracker.setView({page,listId:state.list.id,instance,exposure:state.exposure},newDocument||!wasTracking);
  tracking=true;
  if(page==="booking"&&entry)tracker.track("booking_enter",{action:"guest_details"});
  if(page==="review"&&entry)tracker.track("booking_review",{action:"review"});
  if(!newDocument&&page==="results")tracker.track("list_applied");
  document.title=(page==="results"?"Stays near Parque Eduardo VII":entry?.hotel.name||"Rua Stays")+" · Lisbon";
  routeURL=location.href.split("#")[0];
  alignPage(restore);
}
async function begin(){
  if(busy)return;
  busy=true;
  try{
    if(!key){
      key=Array.from(crypto.getRandomValues(new Uint8Array(32)),x=>x.toString(16).padStart(2,"0")).join("");
      localStorage.setItem(tokenKey,key);
    }
    const next=await request("/api/study/start",{consent:"rua-stays-consent-v3",preview:isPreview,previewArm});
    paint(next,{historyMode:"replace"});
  }catch(e){toast(e.message);}finally{busy=false;}
}
async function boot(){
  if(!key){paint(null);return;}
  try{
    const id=new URLSearchParams(location.search).get("list");
    const next=await request("/api/study/session"+(id?"?list="+encodeURIComponent(id):""));
    paint(next,{restore:true});
  }catch(e){
    if(e.status===404&&location.pathname==="/"){paint(null);return;}
    if(e.status===404&&new URLSearchParams(location.search).has("list")){
      history.replaceState(null,"",navigation("/search",false));
      await boot();
      return;
    }
    content.innerHTML=errorPage(e.message,navigation);
  }
}
async function updateList(reason,updates){
  if(busy||!state||page!=="results")return;
  busy=true;
  const payload={previousId:state.list.id,reason,query:{...state.list.query,...updates}};
  const signature=JSON.stringify(payload);
  if(!listAttempt||listAttempt.signature!==signature)listAttempt={signature,id:crypto.randomUUID()};
  tracker.track({search_edit:"search_submit",filter:"filter_apply",sort:"sort_change"}[reason],{action:reason});
  try{
    const next=await request("/api/study/list",{id:listAttempt.id,...payload});
    listAttempt=null;
    paint(next,{historyMode:"push",newDocument:false});
  }catch(e){toast(e.message);}finally{busy=false;}
}
async function finish(action){
  if(busy||!state)return;
  busy=true;
  const payload={id:crypto.randomUUID(),action,listId:state.list.id,instance,rate:state.room.id,context:tracker.context()};
  try{
    const next=await request("/api/study/finish",payload);
    paint(next);
    void tracker.flush();
  }catch(e){toast(e.message);}finally{busy=false;}
}
function controlClick(event){
  if(event.type==="auxclick"&&event.button!==1)return;
  const control=event.target.closest?.("[data-control]"), action=control?.dataset.control;
  if(!action)return;
  const from=control.closest("[data-instance]")?.dataset.instance||instance;
  tracker.track("click",{action,instance:from});
  if(["hotel_name","hotel_image","hotel_rating","hotel_availability"].includes(action)){
    rememberPosition();
    tracker.track("hotel_open",{action,instance:from});
    return;
  }
  if(action==="rate_details"&&!control.parentElement.open)tracker.track("rate_open",{action,instance:from});
  if(["return_to_results","booking_back"].includes(action))tracker.track(action,{action,instance:from});
  if(action==="exit_search"){void finish("exit");return;}
  if(action==="confirm_booking"){void finish("confirm");return;}
  if(action==="filter_clear")void updateList("filter",{stars:[],maxTotal:0,minScore:0,freeCancellation:false});
  if(action==="search_reset")void updateList("search_edit",{checkIn:"2026-12-02",checkOut:"2026-12-03",adults:2,rooms:1,stars:[],maxTotal:0,minScore:0,freeCancellation:false,sort:"recommended"});
}
document.addEventListener("click",controlClick,true);
document.addEventListener("auxclick",controlClick,true);
document.addEventListener("submit",event=>{
  const form=event.target;
  if(!["consent","trip-search","filters","room-pick","guest-details"].includes(form.id))return;
  event.preventDefault();
  if(form.id==="consent"){void begin();return;}
  if(form.id==="trip-search"){
    const d=new FormData(form);
    void updateList("search_edit",{checkIn:d.get("checkIn"),checkOut:d.get("checkOut"),adults:Number(d.get("adults")),rooms:Number(d.get("rooms"))});
  }
  if(form.id==="filters"){
    const d=new FormData(form);
    void updateList("filter",{stars:d.getAll("stars").map(Number),maxTotal:Number(d.get("maxTotal")||0),minScore:Number(d.get("minScore")),freeCancellation:d.has("freeCancellation")});
  }
  if(form.id==="room-pick"&&form.elements.quantity.value==="1")location.assign(navigation("/booking/"+instance));
  if(form.id==="guest-details")location.assign(navigation("/review/"+instance));
});
document.addEventListener("change",event=>{
  if(event.target.id==="sort"){void updateList("sort",{sort:event.target.value});return;}
  if(event.target.matches("#room-pick [name=quantity]")){
    const chosen=event.target.value==="1";
    sessionStorage.setItem(roomSelectionKey(),event.target.value);
    document.querySelector('#room-pick [type="submit"]').disabled=!chosen;
    tracker.track("room_select",{action:chosen?"select_one":"remove_room"});
  }
});
window.addEventListener("popstate",()=>{if(location.href.split("#")[0]!==routeURL)void boot();});
window.addEventListener("pagehide",rememberPosition);
window.addEventListener("scroll",rememberPosition,{passive:true});
void boot();
