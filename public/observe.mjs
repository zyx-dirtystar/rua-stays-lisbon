export function createTracker(scope,request){
  const pageViewId=crypto.randomUUID(),pendingKey=scope+":events",tabKey="rua:tab";
  const tabId=sessionStorage.getItem(tabKey)||crypto.randomUUID();
  sessionStorage.setItem(tabKey,tabId);
  let serial=Number(sessionStorage.getItem("rua:event-sequence")||0);
  let pending=[];
  try{pending=JSON.parse(sessionStorage.getItem(pendingKey)||"[]");}catch{}
  let frame=null,watcher=null,foregroundSince=null,scrollBucket=-1,sending=false;
  const cards=new Map();
  const foreground=()=>!document.hidden&&document.hasFocus();
  function context(extra={}){
    sessionStorage.setItem("rua:event-sequence",String(++serial));
    return {pageViewId,tabId,eventSeq:serial,at:new Date().toISOString(),page:frame?.page??"results",
      listId:frame?.listId,instance:frame?.instance,source:frame?.page,...extra};
  }
  function persist(){
    try{sessionStorage.setItem(pendingKey,JSON.stringify(pending));}catch{}
  }
  function track(type,extra={}){
    if(!frame)return;
    pending.push({id:crypto.randomUUID(),type,...context(extra)});
    persist();
    if(pending.length>=24)void flush();
  }
  async function flush(keepalive=false){
    if(!pending.length||(!keepalive&&sending))return;
    const batch=pending.slice(0,24);
    if(!keepalive)sending=true;
    try{
      await request("/api/study/events",{events:batch},{keepalive});
      const sent=new Set(batch.map(x=>x.id));
      pending=pending.filter(x=>!sent.has(x.id));
      persist();
    }catch{}finally{if(!keepalive)sending=false;}
  }
  function recordImpression(id,state){
    if(state.impressed)return;
    state.impressed=true;
    track("card_impression",{instance:id,visibleFraction:state.fraction});
  }
  function endDwell(id,state){
    if(state.started===null)return;
    clearTimeout(state.timer);
    const durationMs=Math.max(0,Math.round(performance.now()-state.started));
    if(durationMs>=frame.exposure.milliseconds)recordImpression(id,state);
    track("card_dwell",{instance:id,durationMs});
    state.started=null;
  }
  function outOfView(id,state){
    endDwell(id,state);
    if(state.inside){track("viewport_exit",{instance:id,visibleFraction:0});state.inside=false;}
  }
  function intersect(item){
    if(!frame||!foreground())return;
    const id=item.target.dataset.card;
    const state=cards.get(id);
    if(!state)return;
    const fraction=item.intersectionRatio;
    if(!(item.isIntersecting&&fraction>0)){outOfView(id,state);return;}
    if(!state.inside){state.inside=true;track("viewport_enter",{instance:id,visibleFraction:fraction});}
    if(fraction<frame.exposure.fraction){endDwell(id,state);return;}
    state.fraction=fraction;
    if(state.started!==null)return;
    state.started=performance.now();
    state.impressed=false;
    state.timer=setTimeout(()=>{
      if(frame&&state.started!==null&&foreground())recordImpression(id,state);
    },frame.exposure.milliseconds);
  }
  function pause(reason){
    watcher?.disconnect();
    watcher=null;
    for(const [id,state] of cards)outOfView(id,state);
    if(foregroundSince!==null){
      track("page_dwell",{action:reason,durationMs:Math.max(0,Math.round(performance.now()-foregroundSince))});
      foregroundSince=null;
    }
  }
  function resume(){
    if(!frame||!foreground()||foregroundSince!==null)return;
    foregroundSince=performance.now();
    if(frame.page!=="results")return;
    watcher=new IntersectionObserver(items=>items.forEach(intersect),{threshold:[0,0.0001,frame.exposure.fraction,1]});
    document.querySelectorAll("[data-card]").forEach(card=>watcher.observe(card));
  }
  function setView(next,newDocument=true){
    pause("list_change");
    cards.clear();
    frame=next;
    scrollBucket=-1;
    if(!frame)return;
    if(newDocument)track("page_open");
    for(const node of document.querySelectorAll("[data-card]")){
      const id=node.dataset.card;
      cards.set(id,{inside:false,started:null,impressed:false,timer:null,fraction:0});
      track("card_loaded",{instance:id});
    }
    resume();
  }
  function visibility(){
    if(!frame)return;
    if(foreground()&&foregroundSince===null){track("page_visible");resume();}
    if(!foreground()&&foregroundSince!==null){pause("background");track("page_hidden");void flush();}
  }
  document.addEventListener("visibilitychange",visibility);
  window.addEventListener("focus",visibility);
  window.addEventListener("blur",visibility);
  window.addEventListener("pagehide",()=>{
    if(!frame)return;
    pause("pagehide");track("page_exit");void flush(true);
  });
  window.addEventListener("pageshow",e=>{if(e.persisted){track("page_visible",{action:"history_restore"});resume();}});
  window.addEventListener("online",()=>flush());
  let queued=false;
  window.addEventListener("scroll",()=>{
    if(!frame||frame.page!=="results"||queued||!foreground())return;
    queued=true;
    requestAnimationFrame(()=>{
      queued=false;
      const extent=document.documentElement.scrollHeight-innerHeight;
      const scrollPercent=extent<=0?100:Math.max(0,Math.min(100,Math.floor((scrollY/extent)*20)*5));
      if(scrollPercent!==scrollBucket){scrollBucket=scrollPercent;track("scroll_depth",{scrollPercent});}
    });
  },{passive:true});
  setInterval(()=>flush(),1600);
  setInterval(()=>{if(frame&&foreground())track("heartbeat");},20000);
  return {track,setView,pause,context,flush};
}
