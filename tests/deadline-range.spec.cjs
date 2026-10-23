const {test,expect}=require('@playwright/test');
const baseline=require('../data/baseline.json');
test('all summary companies appear and a single range control saves inclusive deadlines',async({page,browser})=>{
 const errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto('/');await expect(page.locator('#excelUpload')).toBeEnabled();
 await expect(page.locator('#picTabs')).toHaveValue('All PICs');await expect(page.locator('#serviceTabs')).toHaveValue('All Services');
 await expect(page.locator('#fromDate')).toHaveValue('2026-01');await expect(page.locator('#toDate')).toHaveValue('2026-12');await expect(page.locator('#donutAssignedLegend')).toHaveText('600');await expect(page.locator('#donutRate')).toHaveText('67.5%');
 await expect(page.locator('#deadlineMonth')).toHaveCount(0);await expect(page.locator('.monthly-deadline-controls')).toHaveCount(0);await expect(page.locator('#saveDeadline')).toHaveCount(1);
 for(const service of ['Accounting','Payroll','E-Invoice','SST']){await page.locator('#serviceTabs').selectOption(service);const rows=baseline.rows.filter(r=>r.service===service);await expect(page.locator('#donutAssignedLegend')).toHaveText(String(rows.length));await expect(page.locator('#companyBoxList .company-box')).toHaveCount(new Set(rows.map(r=>r.company)).size+1);}
 await page.locator('#clearFilters').click();await expect(page.locator('#donutAssignedLegend')).toHaveText('600');
 await page.locator('#fromDate').fill('2026-03');await page.locator('#toDate').fill('2026-05');await page.locator('#toDate').dispatchEvent('change');await page.locator('#deadlineDate').fill('2020-01-01');await page.locator('#saveDeadline').click();await expect(page.locator('#deadlineMessage')).toContainText('Deadline saved for 2026-03 to 2026-05');
 const data=await(await page.request.get('/api/current')).json();for(const month of ['2026-03','2026-04','2026-05'])expect(data.deadlines[month]).toBe('2020-01-01');expect(data.deadlines['2026-02']).not.toBe('2020-01-01');
 const rows=baseline.rows.filter(r=>r.month>='2026-03'&&r.month<='2026-05');await expect(page.locator('#donutAssignedLegend')).toHaveText(String(rows.length));await expect(page.locator('#donutDelayLegend')).toHaveText(String(rows.filter(r=>r.delay).length));
 await page.locator('#deadlineDate').fill('2099-12-31');await page.locator('#saveDeadline').click();await expect(page.locator('#deadlineMessage')).toContainText('Deadline saved');await expect(page.locator('#donutDelayLegend')).toHaveText('0');
 const other=await browser.newPage();await other.goto('http://127.0.0.1:4173');await expect(other.locator('#excelUpload')).toBeEnabled();await other.locator('#fromDate').fill('2026-03');await other.locator('#toDate').fill('2026-05');await other.locator('#toDate').dispatchEvent('change');await expect(other.locator('#deadlineDate')).toHaveValue('2099-12-31');await other.close();
 await page.setViewportSize({width:1440,height:1000});await page.screenshot({path:'.tools/range-deadline.png',fullPage:true});await page.setViewportSize({width:390,height:844});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);expect(errors).toEqual([]);
});
