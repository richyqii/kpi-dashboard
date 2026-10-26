const {test,expect}=require('@playwright/test');const baseline=require('../data/baseline.json');
test('delayed companies service selection updates totals, months and percentage independently',async({page})=>{
 const errors=[];page.on('pageerror',e=>errors.push(e.message));await page.route('**/api/current',route=>route.fulfill({json:{rows:baseline.rows,version:{id:'test',fileName:baseline.fileName,createdAt:baseline.createdAt}}}));
 await page.goto('/');await expect(page.locator('#excelUpload')).toBeEnabled();await page.locator('#overallDelayLimit').selectOption('all');
 const timeline=await page.locator('#chart').innerHTML();
 for(const service of ['All Services','Accounting','Payroll','E-Invoice','SST']){
  await page.locator('#overallDelayService').selectOption(service);
  const rows=baseline.rows.filter(r=>service==='All Services'||r.service===service),delayed=rows.filter(r=>r.delay||r.waitApproval);
  await expect(page.locator('#overallDelayLabel')).toHaveText((delayed.length/rows.length*100).toFixed(1)+'% delayed');
  const companies=await page.locator('#picDelayedCompanies tr').evaluateAll(trs=>trs.map(tr=>[...tr.querySelectorAll('td')].map(td=>td.textContent)));
  expect(companies.reduce((n,row)=>n+Number(row[3]),0)).toBe(delayed.length);
  for(const row of companies){expect(Number(row[3])).toBe(delayed.filter(r=>r.company===row[0]).length);if(service!=='All Services')expect(row[1]).toBe(service);}
  expect(await page.locator('#chart').innerHTML()).toBe(timeline);
 }
 await page.locator('#overallDelayLimit').selectOption('5');expect(await page.locator('#picDelayedCompanies tr').count()).toBeLessThanOrEqual(5);expect(errors).toEqual([]);
});
