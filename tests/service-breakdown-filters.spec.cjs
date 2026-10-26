const {test,expect}=require('@playwright/test');const baseline=require('../data/baseline.json');
test('service completion percentage combines PIC and boss completions only in service overview',async({page})=>{
 await page.route('**/api/current',route=>route.fulfill({json:{rows:baseline.rows,version:{id:'test',fileName:baseline.fileName,createdAt:baseline.createdAt}}}));await page.goto('/');await expect(page.locator('#excelUpload')).toBeEnabled();
 const timeline=await page.locator('#timelineTaskCount').textContent();
 for(const metric of ['completed','delay']){
  await page.locator('#breakdownMetric').selectOption(metric);
  for(const service of ['Accounting','Payroll','E-Invoice','SST']){
   const rows=baseline.rows.filter(r=>r.service===service),count=rows.filter(r=>metric==='completed'?(r.completed||r.notApplicable):(r.delay||r.waitApproval)).length;
   await expect(page.locator('#serviceBreakdown .service-breakdown-row').filter({hasText:service}).locator('.service-breakdown-rate')).toHaveText((count/rows.length*100).toFixed(1)+'%');
  }
 }
 expect(await page.locator('#timelineTaskCount').textContent()).toBe(timeline);
 await page.locator('#breakdownMetric').selectOption('completed');const before=await page.locator('#serviceBreakdown').innerHTML();
 await page.locator('#fromDate').fill('2026-03');await page.locator('#fromDate').dispatchEvent('change');await page.locator('#toDate').fill('2026-05');await page.locator('#toDate').dispatchEvent('change');expect(await page.locator('#serviceBreakdown').innerHTML()).toBe(before);
});
