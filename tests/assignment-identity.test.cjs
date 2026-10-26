const {test}=require('node:test');
const assert=require('node:assert/strict');
const C=require('../public/kpi-core');
const row=(pic,month='2026-01')=>({service:'SST',company:'Example',task:'SST review',role:'Main',pic,month,completed:1,total:1});
test('reassigned generated IDs cannot collide when the original PIC returns',()=>{
 const first=C.compare(null,[row('A')]).rows;
 const moved=C.compare(first,[row('B')]).rows;
 for(const input of [[row('A'),row('B')],[row('B'),row('A')]]) {
  const next=C.compare(moved,input);
  assert.equal(new Set(next.rows.map(r=>r.assignmentId)).size,2);
  assert.equal(C.compare(next.rows,input).changedRecords,0);
  assert.equal(C.compare(next.rows,next.rows).changedRecords,0);
 }
});
test('legacy generated ID conflicts are repaired without changing data or source rows',()=>{
 const id='task:'+C.identityKey(row('A'));
 const saved=[{...row('A'),assignmentId:id},{...row('B'),assignmentId:id},{...row('B','2026-02'),assignmentId:id}];
 const original=JSON.stringify(saved);
 const result=C.compare(saved,[row('A'),row('B'),row('B','2026-02')]);
 assert.equal(result.changedRecords,0);
 assert.equal(result.rows.length,3);
 assert.equal(new Set(result.rows.map(r=>r.assignmentId)).size,2);
 assert.equal(JSON.stringify(saved),original);
 assert.equal(C.compare(result.rows,result.rows).changedRecords,0);
 assert.deepEqual(C.compare([...saved].reverse(),[row('A'),row('B'),row('B','2026-02')]).rows,result.rows);
});
test('explicit ID conflicts and duplicate months remain invalid',()=>{
 assert.throws(()=>C.compare(null,[{...row('A'),explicitId:'1'},{...row('B'),explicitId:'1'}]),/conflicting/);
 assert.throws(()=>C.compare(null,[row('A'),row('A')]),/Duplicate month/);
});
