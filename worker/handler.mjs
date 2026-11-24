const pagePath=/^\/(hotel|booking|review)\/p(0[1-9]|1[0-3])$/;
const studyPages=new Set(["/","/search","/confirmed","/ended"]);
const safeHeaders={
  "X-Content-Type-Options":"nosniff","X-Frame-Options":"DENY","Referrer-Policy":"same-origin",
  "Content-Security-Policy":"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
};
export default {async fetch(request,env){
  const url=new URL(request.url),p=url.pathname.replace(/\/$/,"")||"/";
  if(p.startsWith("/api/"))return studyApi(request,env);
  if(!["GET","HEAD"].includes(request.method))return new Response(null,{status:405,headers:{Allow:"GET, HEAD"}});
  if(p==="/research"||p==="/research.html"){
    if(!await researcher(request,env))return researcherDenied(env);
  }
  const route=p==="/research"?"/research.html":studyPages.has(p)||pagePath.test(p)?"/index.html":p;
  const asset=Object.hasOwn(SITE_ASSETS,route)?SITE_ASSETS[route]:null;
  if(!asset)return new Response("Page not found",{status:404,headers:safeHeaders});
  const [type,encoded]=asset,bytes=request.method==="HEAD"?null:Uint8Array.from(atob(encoded),c=>c.charCodeAt(0));
  return new Response(bytes,{headers:{...safeHeaders,"Content-Type":type,
    "Cache-Control":p.startsWith("/photos/")?"public, max-age=86400":"private, no-cache"}});
}};
