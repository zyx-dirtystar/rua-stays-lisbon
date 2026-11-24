import { html } from "./views.mjs";

const $=selector=>document.querySelector(selector);
const armLabels={
  high_retarget:"高质量 × 重复", high_no_retarget:"高质量 × 新中档",
  low_retarget:"低质量 × 重复", low_no_retarget:"低质量 × 新中档",
};
const statuses={booked:"已模拟预订",explicit_exit:"主动退出",unfinished:"未完成"};
const activity={closed:"已结束",active:"近期有活动",timed_out:"超时未返回"};
const firstLabels={card_impression:"继续浏览新酒店",hotel_open:"打开酒店",room_select:"选择房间",booking_enter:"进入预订",booking_confirm:"确认预订",explicit_exit:"退出搜索"};
const label=(dict,key)=>dict[key]||key||"—";
const clock=v=>v?v.replace("T"," ").replace("Z"," UTC"):"—";
const onOff=v=>v===null||v===undefined?"—":v?"是":"否";
const headers=(fields)=>"<thead><tr>"+fields.map(h=>"<th scope=\"col\">"+html(h)+"</th>").join("")+"</tr></thead>";
const line=(values)=>"<tr>"+values.map(v=>"<td>"+html(v??"—")+"</td>").join("")+"</tr>";
function table(fields,rows){return '<div class="table-scroll"><table class="data-table">'+headers(fields)+"<tbody>"+rows+"</tbody></table></div>";}
function answer(button,text){return '<button type="button" class="secondary" id="'+button+'">'+text+'</button>';}
function exportLink(kind,query,text){return '<a class="secondary" href="/api/research/export?table='+kind+'&amp;'+query+'">'+text+'</a>';}
async function fetchData(url){
  const response=await fetch(url,{cache:"no-store",credentials:"same-origin"});
  if(!response.ok)throw Error("研究数据暂时无法读取。");
  return response.json();
}
function renderLaunches(){
  $("#launches").innerHTML='<button type="button" class="primary" data-arm="">随机预览</button>'+
    Object.entries(armLabels).map(([id,name])=>'<button type="button" class="secondary" data-arm="'+id+'">'+name+'</button>').join("");
}
function listRecent(items){
  if(!items.length)return "<p>这个样本暂无会话。</p>";
  const rows=items.map(s=>{
    const cell='<button type="button" class="text-button" data-session="'+html(s.session_id)+'" aria-label="查看会话 '+html(s.session_id)+'">'+html(s.session_id.slice(0,8))+'</button>';
    return "<tr><td>"+cell+"</td>"+line([label(armLabels,s.arm),clock(s.consented_at),label(statuses,s.status),label(activity,s.activity_status),s.final_hotel_id]).slice(4);
  }).join("");
  return table(["会话","分组","开始时间","结果","活动状态","最终酒店"],rows);
}
let requestNumber=0, timelineNumber=0, selected=null;
async function refresh(){
  const job=++requestNumber, run=$("#run").value;
  try{
    const [summary,recent]=await Promise.all([fetchData("/api/research/summary?run="+run),fetchData("/api/research/sessions?run="+run)]);
    if(job!==requestNumber)return;
    $("#version").textContent=summary.version;
    $("#summary").innerHTML=table(["分组","已分配","到达第 7 位","实际曝光","后续缺失","继续到新酒店","预订","订回焦点","主动退出","未完成","已超时"],
      summary.metrics.map(x=>line([label(armLabels,x.arm),x.sessions||0,x.reached||0,x.exposed||0,x.first_missing||0,x.continued||0,x.booked||0,x.booked_focal||0,x.exited||0,x.unfinished||0,x.timed_out||0])).join(""));
    const suffix="run="+run;
    $("#exports").innerHTML=exportLink("sessions",suffix,"会话与分组 CSV")+exportLink("rankings",suffix,"列表排名 CSV")+
      exportLink("events",suffix,"行为事件 CSV")+exportLink("stimuli",suffix,"刺激映射 CSV");
    $("#sessions").innerHTML=listRecent(recent.items);
    if(selected)void showTimeline(selected,0,false);
  }catch(error){if(job===requestNumber)$("#summary").textContent=error.message;}
}
function facts(record){
  return '<dl class="fact-grid">'+[
    ["组别",label(armLabels,record.arm)],["初始酒店",record.focal_hotel_id],["默认第 7 位",record.planned_critical_hotel_id],
    ["第 7 位曝光",clock(record.critical_exposed_at)],["第一次后续行为",label(firstLabels,record.first_after_critical)],
    ["继续到新酒店",onOff(record.continued_to_new)],["结果",label(statuses,record.status)],["活动状态",label(activity,record.activity_status)],
    ["最终酒店",record.final_hotel_id],["订回初始焦点",onOff(record.booked_focal)],
  ].map(([k,v])=>'<div><dt>'+html(k)+'</dt><dd>'+html(v||"—")+'</dd></div>').join("")+'</dl>';
}
function rankings(lists){
  const map=new Map();
  for(const r of lists){if(!map.has(r.list_id))map.set(r.list_id,[]);map.get(r.list_id).push(r);}
  const rows=[...map.entries()].map(([id,items])=>{
    const base=items[0], actual7=items.find(x=>x.actual_rank===7), default7=items.find(x=>x.default_rank===7);
    const sequence=items.filter(x=>x.hotel_id).map(x=>x.actual_rank+" "+x.hotel_id+" ["+x.listing_instance_id+"]").join(" · ");
    const q=JSON.parse(base.query_json);
    return line([id.slice(0,8),base.reason,base.previous_list_id?.slice(0,8),q.sort,default7?.actual_rank,actual7?.hotel_id,sequence||"空列表"]);
  }).join("");
  return table(["列表","产生原因","上一个列表","排序","默认第 7 位现位置","实际第 7 位","实际序列"],rows);
}
const eventRow=e=>line([clock(e.occurred_at),e.event_type,e.page,e.action,e.hotel_id,e.listing_instance_id,e.default_rank,e.actual_rank,e.list_id?.slice(0,8),e.duration_ms,e.tab_id?.slice(0,8)]);
async function showTimeline(id,offset=0,scroll=true){
  const job=++timelineNumber;
  selected=id;
  try{
    const data=await fetchData("/api/research/timeline?session="+id+"&offset="+offset);
    if(job!==timelineNumber)return;
    const host=$("#timeline");host.hidden=false;
    if(!offset){
      const suffix="session="+data.session.session_id;
      host.innerHTML='<h2>会话 '+html(data.session.session_id.slice(0,8))+'</h2>'+facts(data.session)+
        '<div class="research-toolbar">'+exportLink("sessions",suffix,"导出这个会话")+exportLink("rankings",suffix,"导出排名")+exportLink("events",suffix,"导出事件")+'</div>'+
        '<h2>排名历史</h2>'+rankings(data.lists)+'<h2>行为时间线</h2><div class="timeline-rows">'+
        table(["时间","事件","页面","行为","酒店","展示实例","默认位","实际位","列表","毫秒","标签页"],data.events.map(eventRow).join(""))+'</div><div id="timeline-more"></div>';
      if(scroll)host.scrollIntoView({block:"start"});
    }else $(".timeline-rows tbody").insertAdjacentHTML("beforeend",data.events.map(eventRow).join(""));
    $("#timeline-more").innerHTML=data.next===null?"":answer("more","载入后续事件");
    if(data.next!==null)$("#more").onclick=()=>showTimeline(id,data.next,false);
  }catch(error){const host=$("#timeline");host.hidden=false;host.textContent=error.message;}
}
document.addEventListener("click",event=>{
  const preview=event.target.closest("[data-arm]");
  if(preview){
    const q=new URLSearchParams({preview:"1",test:crypto.randomUUID()});
    if(preview.dataset.arm)q.set("arm",preview.dataset.arm);
    location.assign("/?"+q);
  }
  const row=event.target.closest("[data-session]");
  if(row)void showTimeline(row.dataset.session);
});
$("#run").addEventListener("change",()=>{selected=null;timelineNumber++; $("#timeline").hidden=true;void refresh();});
$("#refresh").addEventListener("click",refresh);
renderLaunches();
void refresh();
