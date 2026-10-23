const {test,expect}=require('@playwright/test');const fs=require('fs');const path=require('path');const X=require('xlsx');const {post,upload,resetBaseline}=require('./api-helpers.cjs');const filename='KPI Status 22.10.2026.xlsx';
test.beforeEach(async({page})=>{await resetBaseline(page.request);const h=await (await page.request.get('/api/versions')).json();for(const v of h.versions)if(v.id!==h.currentId)await page.request.delete('/api/versions/'+v.id,{headers:{Origin:'http://127.0.0.1:4173'},data:{confirmed:true}});});
test('new baseline, monthly deadlines, shared persistence and automatic expiry',async({page,browser})=>{
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.clock.install({time:new Date('2026-10-22T15:59:30Z')});await page.goto('/');await expect(page.locator('#excelUpload')).toBeEnabled();
  await expect(page.locator('#currentFileName')).toContainText(filename);
  await page.locator('#fromDate').fill('2026-01');await page.locator('#toDate').fill('2027-01');await page.locator('#toDate').dispatchEvent('change');
  await page.locator('#picTabs').selectOption('Iza');await page.locator('#serviceTabs').selectOption('Accounting');
  const current=await (await page.request.get('/api/current')).json();const subset=current.rows.filter(r=>r.pic==='IZA'&&r.service==='Accounting');
  expect(subset.some(r=>r.delay)).toBe(true);await expect(page.locator('#donutDelayLegend')).toHaveText('0');
  await expect(page.locator('#donutApprovalLegend')).toHaveText(String(subset.filter(r=>r.delay).length));
  const target=subset.find(r=>r.delay).month;await page.locator('#fromDate').fill(target);await page.locator('#toDate').fill(target);await page.locator('#toDate').dispatchEvent('change');await page.locator('#deadlineDate').fill('2026-10-22');await page.locator('#saveDeadline').click();await expect(page.locator('#deadlineMessage')).toContainText('Deadline saved');
  await expect(page.locator('#donutDelayLegend')).toHaveText('0');await page.clock.fastForward(61000);await expect(page.locator('#donutDelayLegend')).toHaveText(String(subset.filter(r=>r.delay&&r.month===target).length));
  const other=await browser.newPage();await other.clock.setFixedTime(new Date('2026-10-23T00:00:00Z'));await other.goto('http://127.0.0.1:4173');await expect(other.locator('#excelUpload')).toBeEnabled();await other.locator('#fromDate').fill(target);await other.locator('#toDate').fill(target);await other.locator('#toDate').dispatchEvent('change');await expect(other.locator('#deadlineDate')).toHaveValue('2026-10-22');await other.close();
  await page.locator('#fromDate').fill('2026-01');await page.locator('#toDate').fill('2026-12');await page.locator('#toDate').dispatchEvent('change');
  const overall=current.rows.filter(r=>r.month>='2026-01'&&r.month<='2026-12');await page.locator('#picTabs').selectOption('Yoong Shi');await expect(page.locator('#donutRate')).toHaveText((100*overall.filter(r=>r.completed||r.notApplicable).length/overall.length).toFixed(1)+'%');await page.locator('#picTabs').selectOption('All PICs');
  await expect(page.locator('#statusDonut')).toHaveAttribute('role','img');await page.locator('[data-status="na"]').click();await expect(page.locator('.gantt-row-label')).toHaveText(['Boss Completed']);
  await page.locator('#selectAllStatusButton').click();await expect(page.locator('.gantt-row-label')).toHaveCount(4);
  await page.screenshot({path:'.tools/new-status-desktop.png',fullPage:true});await page.setViewportSize({width:390,height:844});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);expect(errors).toEqual([]);
});
test('upload validation, cancellation, shared save and version switching still work',async({page})=>{
 await resetBaseline(page.request);await page.goto('/');await expect(page.locator('#excelUpload')).toBeEnabled();
 const w=X.readFile(path.join('data',filename),{cellStyles:true});w.Sheets[w.SheetNames[0]].D6.v='-';const bytes=X.write(w,{type:'buffer',bookType:'xlsx'});
 await page.locator('#excelUpload').setInputFiles({name:'updated-kpi.xlsx',mimeType:'application/octet-stream',buffer:bytes});await page.getByRole('button',{name:'Validate File',exact:true}).click();await expect(page.locator('#workflowTitle')).toHaveText('KPI Changes Detected');await page.getByRole('button',{name:'Cancel',exact:true}).click();expect((await (await page.request.get('/api/current')).json()).version.id).toBe('initial-baseline');
 const preview=await (await upload(page.request,'updated-kpi.xlsx',bytes)).json();expect(preview.changedRecords).toBeGreaterThan(0);const saved=await post(page.request,'/api/commit',{draftId:preview.id,approved:true});expect(saved.ok()).toBe(true);const history=await (await page.request.get('/api/versions')).json();expect(history.versions.some(v=>v.id===preview.id)).toBe(true);await resetBaseline(page.request);
 const invalid=await post(page.request,'/api/deadlines',{month:'2026-01',deadline:'2026-02-31'});expect(invalid.status()).toBe(422);
});
