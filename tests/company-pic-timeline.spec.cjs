const {test,expect}=require('@playwright/test');
const baseline=require('../data/baseline.json');
test('company timeline shows actual PIC/service monthly quantities and no keyword field',async({page})=>{
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/api/current',route=>route.fulfill({json:{rows:baseline.rows,version:{id:'test',fileName:baseline.fileName,createdAt:baseline.createdAt}}}));
 await page.goto('/');await expect(page.locator('#excelUpload')).toBeEnabled();
 await expect(page.locator('#companySearch')).toHaveCount(0);
 await expect(page.locator('#chart')).toContainText('Select a company');
 const companies=[...new Set(baseline.rows.filter(r=>r.completed).map(r=>r.company))];
 for(const company of companies.slice(0,3)){
  await page.locator('#companySelect').selectOption(company);
  const rows=baseline.rows.filter(r=>r.company===company&&r.completed);
  await expect(page.locator('#timelineTaskCount')).toHaveText(String(rows.length));
  await expect(page.locator('#timelinePicCount')).toHaveText(String(new Set(rows.map(r=>r.pic).filter(p=>p&&p!=='UNASSIGNED')).size));
  const cells=await page.locator('.company-timeline tbody tr').evaluateAll(nodes=>nodes.flatMap(tr=>[...tr.querySelectorAll('.timeline-cell')].map(cell=>({pic:tr.dataset.pic,service:tr.dataset.service,month:cell.dataset.month,count:Number(cell.dataset.count),text:cell.textContent}))));
  expect(cells.reduce((n,c)=>n+c.count,0)).toBe(rows.length);
  for(const cell of cells){expect(cell.count).toBe(rows.filter(r=>r.pic===cell.pic&&r.service===cell.service&&r.month===cell.month).length);if(cell.count)expect(cell.text).toBe(String(cell.count));}
 }
 const company=companies[0];await page.locator('#companySelect').selectOption(company);
 const initial=await page.locator('#chart').innerHTML();
 await page.locator('#serviceTabs').selectOption('Accounting');expect(await page.locator('#chart').innerHTML()).toBe(initial);
 await page.locator('#fromDate').fill('2026-03');await page.locator('#fromDate').dispatchEvent('change');
 await page.locator('#toDate').fill('2026-05');await page.locator('#toDate').dispatchEvent('change');
 const rows=baseline.rows.filter(r=>r.company===company&&r.completed&&r.month>='2026-03'&&r.month<='2026-05');
 await expect(page.locator('#timelineTaskCount')).toHaveText(String(rows.length));
 await page.setViewportSize({width:390,height:844});
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 expect(errors).toEqual([]);
});
