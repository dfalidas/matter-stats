// Independent fresh process; only the orchestrator's owned local Data API.
import assert from "node:assert/strict";
import { createClient } from "@supabase/supabase-js";
assert.equal(process.env.DISPOSABLE_DB_ACK,"yes");
const url=process.env.STABILIZATION_TEST_SUPABASE_URL;
assert.ok(["127.0.0.1","localhost"].includes(new URL(url).hostname));
const client=createClient(url,process.env.STABILIZATION_TEST_SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}});
const config=JSON.parse(process.argv[2]);
if(config.admit) {
 process.send({ready:true});
 process.once("message",async()=>{try {
  const {data,error}=await client.rpc("admit_matter_request",config.admit);assert.equal(error,null);process.send({result:data});process.disconnect();
 } catch(error) {console.error(error);process.exitCode=1;process.disconnect();}});
} else {
 const {default:Module,createRequire}=await import("node:module");const path=await import("node:path");const {fileURLToPath}=await import("node:url");
 const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"../.."); const resolve=Module._resolveFilename;
 Module._resolveFilename=function(request,parent,isMain,options){if(request==="server-only")return path.join(root,"tests/fixtures/server-only.cjs");if(request.startsWith("@/"))return path.join(root,".test-build",`${request.slice(2)}.js`);return resolve.call(this,request,parent,isMain,options);};
 process.env.SUPABASE_URL=url;process.env.SUPABASE_SERVICE_ROLE_KEY=process.env.STABILIZATION_TEST_SUPABASE_SERVICE_ROLE_KEY;process.env.MATTER_API_TOKEN="synthetic-never-sent";
 const api=createRequire(import.meta.url)(path.join(root,".test-build/lib/matter-api.js"));
 const originalFetch=globalThis.fetch;let requests=0;
 globalThis.fetch=async(input,init)=>{if(new URL(String(input)).hostname!=="api.getmatter.com")return originalFetch(input,init);requests++;return Response.json({}, {status:config.status??429,headers:config.headers??{"Retry-After":"60"}});};
 let outcome;try {await api.getMatterAccount();outcome={ok:true};}catch(error){outcome={name:error.name,status:error.status,reason:error.reason};}
 console.log(JSON.stringify({requests,outcome}));
}
