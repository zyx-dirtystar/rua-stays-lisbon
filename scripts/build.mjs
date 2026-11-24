import { readFile, writeFile, mkdir, cp, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root=fileURLToPath(new URL("../",import.meta.url)),dist=path.join(root,"dist");
const load=rel=>readFile(path.join(root,rel),"utf8");
const modules=["experiment","study-store","study-research","study-api"];
const code=await Promise.all(modules.map(async name=>(await load("worker/"+name+".mjs")).replace(/^import [^\n]+\n/gm,"").replace(/^export /gm,"")));
const types={".html":"text/html; charset=utf-8",".mjs":"text/javascript; charset=utf-8",".css":"text/css; charset=utf-8",
  ".svg":"image/svg+xml",".webp":"image/webp",".jpg":"image/jpeg",".txt":"text/plain; charset=utf-8"};
const assets={};
async function collect(base=""){
  for(const f of await readdir(path.join(root,"public",base),{withFileTypes:true})){
    const key=path.posix.join(base,f.name);
    if(f.isDirectory()){await collect(key);continue;}
    if(!Object.hasOwn(types,path.extname(key)))throw Error("Unsupported asset type: "+key);
    assets["/"+key]=[types[path.extname(key)],(await readFile(path.join(root,"public",key))).toString("base64")];
  }
}
await collect();
await mkdir(path.join(dist,"server"),{recursive:true});
await mkdir(path.join(dist,".openai"),{recursive:true});
await writeFile(path.join(dist,"server","index.js"),code.join("\n")+"\nconst SITE_ASSETS="+JSON.stringify(assets)+";\n"+await load("worker/handler.mjs"));
await cp(path.join(root,".openai","hosting.json"),path.join(dist,".openai","hosting.json"));
await cp(path.join(root,"drizzle"),path.join(dist,".openai","drizzle"),{recursive:true});
console.log("Built Rua Stays Worker and "+Object.keys(assets).length+" first-party assets.");
