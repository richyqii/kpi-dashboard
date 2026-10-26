const {test,expect}=require('@playwright/test');
const baseline=require('../data/baseline.json');
test('service overview uses all saved tasks independently of every dashboard filter',async({page})=>{
 await page.route('**/api/current', route=>route.fulfill({json:{rows:baseline.rows,version:{id:'test-baseline',fileName:baseline.fileName,createdAt:baseline.createdAt}}}));await page.goto('/');await expect(page.locator('#excelUpload')).toBeEnabled();
 const snapshot=()=>page.locator('#serviceBreakdown').innerHTML();
 const original=await snapshot();
 await expect(page.locator('#serviceBreakdown .service-breakdown-row')).toHaveCount(4);
 await page.locator('#serviceTabs').selectOption('Accounting');expect(await snapshot()).toBe(original);
 await page.locator('#picTabs').selectOption({label:'Ling Yin'});expect(await snapshot()).toBe(original);
 await page.locator('#roleTabs').selectOption('Main Reviewer');expect(await snapshot()).toBe(original);
 await page.locator('#serviceTabs').selectOption('E-Invoice');
 const invoice=page.locator('#invoiceTypeTabs');await invoice.getByRole('button',{name:'Billed',exact:true}).click();expect(await snapshot()).toBe(original);
 await page.locator('#fromDate').fill('2026-03');await page.locator('#fromDate').dispatchEvent('change');
 await page.locator('#toDate').fill('2026-05');await page.locator('#toDate').dispatchEvent('change');expect(await snapshot()).toBe(original);
 await page.locator('#breakdownMetric').selectOption('delay');
 const delay=await snapshot();expect(delay).not.toBe(original);
 await page.locator('#clearFilters').click();expect(await snapshot()).toBe(delay);
 const current=baseline;
 for(const service of ['Accounting','Payroll','E-Invoice','SST']){
  const rows=current.rows.filter(r=>r.service===service);
  const expected=(rows.filter(r=>r.delay||r.waitApproval).length/rows.length*100).toFixed(1)+'%';
  await expect(page.locator('#serviceBreakdown .service-breakdown-row').filter({hasText:service}).locator('.service-breakdown-rate')).toHaveText(expected);
 }
});


