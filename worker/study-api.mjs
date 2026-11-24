import { HttpIssue, parseInput, requestKey, keyedSession, researcher, startStudy, currentStudy, refreshList, insertEvents, finishStudy, sendJson } from "./study-store.mjs";
import { researchRoute } from "./study-research.mjs";

export async function studyApi(request,env){
  try{
    const method=request.method,url=new URL(request.url),path=url.pathname;
    if(!env.DB)throw new HttpIssue(503,"Study data is unavailable.");
    if(method==="GET"&&path.startsWith("/api/research/"))return await researchRoute(request,env,url);
    if(method==="POST"){
      const origin=request.headers.get("Origin");
      if(origin && origin!==url.origin)throw new HttpIssue(403,"This request must come from Rua Stays.");
      if(Number(request.headers.get("Content-Length"))>48_000)throw new HttpIssue(413,"Request is too large.");
    }
    const key=await requestKey(request);
    if(method==="POST"&&path==="/api/study/start"){
      const input=await parseInput(request);
      return sendJson(await startStudy(env.DB,key,input,input.preview===true&&await researcher(request,env)));
    }
    const session=await keyedSession(env.DB,key);
    if(!session)throw new HttpIssue(404,"No study session is associated with this browser.");
    if(method==="GET"&&path==="/api/study/session")return sendJson(await currentStudy(env.DB,session,url.searchParams.get("list")));
    if(method==="POST"&&path==="/api/study/list")return sendJson(await refreshList(env.DB,session,await parseInput(request)));
    if(method==="POST"&&path==="/api/study/events")return sendJson(await insertEvents(env.DB,session,await parseInput(request)));
    if(method==="POST"&&path==="/api/study/finish")return sendJson(await finishStudy(env.DB,session,await parseInput(request)));
    throw new HttpIssue(404,"Unknown study request.");
  }catch(e){
    if(!(e instanceof HttpIssue))console.error("Study request failed:",e);
    return sendJson({error:e instanceof HttpIssue?e.message:"Could not save your session. Please try again."},e instanceof HttpIssue?e.status:503);
  }
}
