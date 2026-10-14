import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const before = JSON.parse(readFileSync(new URL('../docs/evidence/task-18-before.json',import.meta.url)));
const after = JSON.parse(readFileSync(new URL('../docs/evidence/task-18-after.json',import.meta.url)));
assert.equal(before.now,after.now);
assert.equal(before.timezone,after.timezone);
assert.equal(before.node,after.node);
assert.equal(before.measurements.length,28);
assert.equal(after.measurements.length,28);
console.log('| View | Sessions | Cap | HTTP requests before → after | Returned rows before → after | Response JSON bytes before → after | Client result JSON bytes before → after | Synthetic ms before → after |');
console.log('| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |');
for(let i=0;i<before.measurements.length;i++) {
  const a=before.measurements[i],b=after.measurements[i];
  for(const key of ['view','count','cap','outputSha256']) assert.equal(a[key],b[key],`${key}: ${a.view}/${a.count}/${a.cap}`);
  for(const key of ['requests','rows','responseBytes','payloadBytes']) assert.ok(b[key]<a[key],`${key} must decrease: ${a.view}`);
  console.log(`| ${a.view} | ${a.count} | ${a.cap} | ${a.requests} → ${b.requests} | ${a.rows} → ${b.rows} | ${a.responseBytes} → ${b.responseBytes} | ${a.payloadBytes} → ${b.payloadBytes} | ${a.elapsedMs} → ${b.elapsedMs} |`);
}
for(const big of after.measurements.filter(r=>r.count===10037 && r.view.startsWith('reports'))) {
  const small=after.measurements.find(r=>r.count===1200 && r.cap===big.cap && r.view===big.view);
  assert.ok(big.payloadBytes-small.payloadBytes<100,'same calendar period grows only integer digits');
}
console.error('PASS: 28 identical complete output hashes; fewer HTTP requests, rows, response bytes and client bytes in all cases; bounded report payload growth.');
