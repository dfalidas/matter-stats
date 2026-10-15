import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { createWriteStream } from 'node:fs';
import { sanitizedEnvironment } from './stabilization-db-orchestrator.mjs';
assert.ok(process.env.TASK21_PLAYWRIGHT_MODULE, 'Set TASK21_PLAYWRIGHT_MODULE to an installed Playwright module entry (no dependency installation by this script).');
const { chromium } = await import(pathToFileURL(path.resolve(process.env.TASK21_PLAYWRIGHT_MODULE)).href);
const syntheticEnv=sanitizedEnvironment({APP_ACCESS_PASSWORD:'synthetic-password',APP_CREDENTIAL_VERSION:'1',MATTER_API_TOKEN:'synthetic-unused-token',SUPABASE_URL:'http://127.0.0.1:54391',SUPABASE_SERVICE_ROLE_KEY:'synthetic-server-only',CRON_SECRET:'synthetic-unused-cron',APP_TIMEZONE:'Europe/Athens',NEXT_TELEMETRY_DISABLED:'1'});
await mkdir('work',{recursive:true});
const children=[];
for(const [name,args] of [['fixture',['scripts/task21-ui-fixture.mjs']],['app',['node_modules/next/dist/bin/next','start','--hostname','127.0.0.1','--port','3091']]]) {
 const log=createWriteStream(`work/task21-ui-${name}.log`);
 const child=spawn(process.execPath,args,{env:syntheticEnv,stdio:['ignore','pipe','pipe']});child.stdout.pipe(log);child.stderr.pipe(log);children.push(child);
}
const ready=async url=>{for(let n=0;n<100;n++){try{await fetch(url);return;}catch{await new Promise(resolve=>setTimeout(resolve,100));}}throw new Error('Synthetic UI startup unavailable');};
await Promise.all([ready('http://127.0.0.1:3091/login'),ready('http://127.0.0.1:54391')]);
import { mkdir, writeFile } from 'node:fs/promises';
const output='docs/evidence/task21';await mkdir(output,{recursive:true});
const browser=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
const context=await browser.newContext({timezoneId:'America/New_York'});
await context.addCookies([{name:'matter_stats_session',value:'task21-synthetic-session-cookie-only',url:'http://127.0.0.1:3091'}]);
const page=await context.newPage(),errors=[],consoleErrors=[],requests=[],failedResources=[];
page.on('response',res=>{if(res.status()>=400)failedResources.push({url:res.url(),status:res.status()});});
page.on('console',message=>{if(message.type()==='error')consoleErrors.push({message:message.text(),url:message.location().url});});
page.on('pageerror',error=>errors.push(error.message));
page.on('request',req=>{if(!req.url().startsWith('http://127.0.0.1:3091'))requests.push(req.url());});
const evidence=[];
try{
 for(const scenario of ['normal','partial','stale','unavailable']){
  await fetch(`http://127.0.0.1:54391/scenario?name=${scenario}`);
  for(const [size,width,height] of [['desktop',1440,1000],['mobile',390,844]]){
   await page.setViewportSize({width,height});
   for(const route of ['dashboard','settings']){
    await page.goto(`http://127.0.0.1:3091/${route}`,{waitUntil:'networkidle'});
    assert.equal(new URL(page.url()).pathname,`/${route}`);
    const text=await page.locator('body').innerText();
    assert.match(text,/Synchronization status/);assert.doesNotMatch(text,/Last successful sync|opaque-not-for-ui|synthetic-server-only/);
    assert.match(text,/Europe\/Athens/);
    if(scenario==='normal')assert.match(text,/Sessions completion is recent/);
    if(scenario==='partial')assert.match(text,/Partial ingestion; pending continuation/);
    if(scenario==='stale')assert.match(text,/Sessions completion is stale/);
    if(scenario==='unavailable')assert.match(text,/Sessions status unavailable/);
    const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth);
    assert.equal(overflow,false,`${scenario} ${size} ${route}: horizontal viewport overflow`);
    const path=`${output}/${scenario}-${route}-${size}.png`;
    await page.screenshot({path,fullPage:true});
    evidence.push({scenario,route,width,height,screenshot:path,timezone:'Europe/Athens',browserTimezone:'America/New_York',horizontalOverflow:false});
   }
  }
 }
 assert.deepEqual(errors,[]);assert.deepEqual(requests,[]);
 // The unchanged baseline has no favicon asset. Retain its observed 404 and
 // console message as a limitation; every application resource/error is checked.
 assert.ok(failedResources.every(r=>new URL(r.url).pathname==='/favicon.ico' && r.status===404),JSON.stringify(failedResources));
 console.log(JSON.stringify({consoleErrors,failedResources}));
 assert.ok(consoleErrors.every(error=>error.message==='Failed to load resource: the server responded with a status of 404 (Not Found)' && new URL(error.url).pathname==='/favicon.ico'),JSON.stringify(consoleErrors));
 await writeFile(`${output}/ui-validation.json`,JSON.stringify({syntheticOnly:true,productionData:false,pages:evidence,pageErrors:errors,consoleErrors,baselineResourceFailures:failedResources,externalBrowserRequests:requests},null,2)+'\n');
 console.log(`Verified and captured ${evidence.length} synthetic page/viewport states; no page errors, external browser requests or horizontal viewport overflow. Baseline favicon console messages: ${consoleErrors.length}.`);
}finally{await browser.close();for(const child of children)child.kill('SIGTERM');}
