import http from "node:http";
import path from "node:path";
import { mkdir } from "node:fs/promises";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import { fileURLToPath } from "node:url";
import { localDB } from "./database.mjs";
import worker from "../dist/server/index.js";

const work=fileURLToPath(new URL("../work/",import.meta.url));
await mkdir(work,{recursive:true});
const cli=process.argv.slice(2), flag=(key,fallback)=>cli.includes(key)?cli[cli.indexOf(key)+1]:fallback;
const port=Number(flag("--port","4329"));
if(!Number.isInteger(port)||port<1||port>65535)throw Error("Choose a valid --port.");
const hosted=process.env.RUA_PUBLIC_ORIGIN;
const token=process.env.RESEARCH_ADMIN_TOKEN;
if(hosted){
  const origin=new URL(hosted);
  if(origin.protocol!=="https:"||origin.origin!==hosted||typeof token!=="string"||token.length<24)
    throw Error("Set RUA_PUBLIC_ORIGIN to the exact HTTPS origin and RESEARCH_ADMIN_TOKEN to a strong secret.");
}
const localhost="http://127.0.0.1:"+port;
const origins=hosted?[hosted]:[localhost,"http://localhost:"+port];
const env={DB:localDB(flag("--db",path.join(work,"rua-v3.sqlite"))),
  RESEARCH_OWNER_EMAIL:hosted?undefined:"local-researcher@localhost", RESEARCH_ADMIN_TOKEN:hosted?token:undefined};
const app=http.createServer(async(req,res)=>{
  try{
    const origin=origins.find(value=>new URL(value).host===req.headers.host);
    if(!origin||!req.url?.startsWith("/")||req.url.startsWith("//")){res.writeHead(400).end("Unknown host");return;}
    if(req.headers.origin&&req.headers.origin!==origin){res.writeHead(403).end();return;}
    const headers=new Headers();
    for(const [k,v] of Object.entries(req.headers)){
      if(v&&!k.startsWith("oai-"))headers.set(k,Array.isArray(v)?v.join(", "):String(v));
    }
    if(!hosted){
      headers.set("oai-authenticated-user-email",env.RESEARCH_OWNER_EMAIL);
      headers.set("oai-authenticated-user-id","local-owner");
    }
    const chunks=[];
    let size=0;
    for await(const chunk of req){
      size+=chunk.length;
      if(size>48_000){res.writeHead(413).end();return;}
      chunks.push(chunk);
    }
    const request=new Request(origin+req.url,{method:req.method,headers,body:chunks.length?Buffer.concat(chunks):undefined});
    const reply=await worker.fetch(request,env);
    res.writeHead(reply.status,Object.fromEntries(reply.headers));
    if(reply.body)await pipeline(Readable.fromWeb(reply.body),res);
    else res.end();
  }catch(error){
    if(!res.headersSent)res.writeHead(500);
    if(!res.destroyed)res.end();
    if(error?.code!=="ERR_STREAM_PREMATURE_CLOSE")console.error("HTTP request error:",error.message);
  }
});
app.listen(port,"127.0.0.1",()=>console.log("Rua Stays: "+(hosted||localhost)+"/ | Research: "+(hosted||localhost)+"/research"));
for(const signal of ["SIGINT","SIGTERM"])process.on(signal,()=>app.close(()=>{env.DB.close();process.exit(0);}));

