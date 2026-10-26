const {test,expect}=require('@playwright/test');const baseline=require('../data/baseline.json');
test('service-only timeline includes every company and reconciles PIC totals',async({page})=>{
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/api/current',route=>route.fulfill({json:{rows:baseline.rows,version:{id:'test',fileName:baseline.fileName,createdAt:baseline.createdAt}}}));
 await page.goto('/');await expect(page.locator('#excelUpload')).toBeEnabled();await expect(page.locator('#companySelect')).toHaveCount(0);await expect(page.locator('#companySearch')).toHaveCount(0);
 const verify=async(service,from='2026-01',to='2026-12')=>{
  const scoped=baseline.rows.filter(r=>(service==='All Services'||r.service===service)&&r.month>=from&&r.month<=to),done=scoped.filter(r=>r.completed);
  await expect(page.locator('#timelineTaskCount')).toHaveText(String(done.length));
  const cells=await page.locator('.company-timeline tbody tr').evaluateAll(trs=>trs.flatMap(tr=>[...tr.querySelectorAll('.timeline-cell')].map(c=>({company:tr.dataset.company,pic:tr.dataset.pic,service:tr.dataset.service,month:c.dataset.month,count:Number(c.dataset.count)}))));
  expect([...new Set(cells.map(c=>c.company))].sort()).toEqual([...new Set(scoped.map(r=>r.company))].sort());
  for(const c of cells)expect(c.count).toBe(done.filter(r=>r.company===c.company&&r.pic===c.pic&&r.service===c.service&&r.month===c.month).length);
  const totals=await page.locator('#timelinePicTotals tbody tr').evaluateAll(trs=>trs.map(tr=>({pic:tr.dataset.pic,count:Number(tr.querySelector('td').textContent)})));
  expect(totals.reduce((n,r)=>n+r.count,0)).toBe(done.length);
  for(const item of totals)expect(item.count).toBe(done.filter(r=>r.pic===item.pic).length);
 };
 for(const service of ['All Services','Accounting','Payroll','E-Invoice','SST']){await page.locator('#timelineServiceSelect').selectOption(service);await verify(service);}
 await page.locator('#fromDate').fill('2026-03');await page.locator('#fromDate').dispatchEvent('change');await page.locator('#toDate').fill('2026-05');await page.locator('#toDate').dispatchEvent('change');await verify('SST','2026-03','2026-05');
 await page.setViewportSize({width:390,height:844});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);expect(errors).toEqual([]);
});
