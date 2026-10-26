const {test,expect}=require('@playwright/test');
const baseline=require('../data/baseline.json');
test('summary report previews and downloads a single PDF page from current data',async({page})=>{
 await page.route('**/api/current',route=>route.fulfill({json:{rows:baseline.rows,version:{id:'report-test',fileName:'Report source.xlsx',createdAt:baseline.createdAt}}}));
 await page.goto('/');await expect(page.locator('#excelUpload')).toBeEnabled();
 await page.locator('#summaryReport').click();
 await expect(page.locator('#summaryReportDialog')).toBeVisible();
 await expect(page.locator('#reportScope')).toContainText('Report source.xlsx');
 const pdf=await page.locator('#reportDownload').evaluate(async a=>await(await fetch(a.href)).text());
 expect(pdf.startsWith('%PDF-1.4')).toBeTruthy();expect(pdf).toContain('/Count 1');expect(pdf.match(/\/Type \/Page\b/g)).toHaveLength(1);expect(pdf).toContain('/DCTDecode');
 expect(await page.locator('#reportPreview').evaluate(img=>img.complete&&img.naturalWidth===1190)).toBeTruthy();
 require('fs').writeFileSync('.tools/summary-report-preview.png',Buffer.from((await page.locator('#reportPreview').getAttribute('src')).split(',')[1],'base64'));
 await page.screenshot({path:'.tools/summary-report-dialog.png'});
 await page.keyboard.press('Escape');await expect(page.locator('#summaryReportDialog')).not.toBeVisible();
 await page.locator('#fromDate').fill('2026-03');await page.locator('#fromDate').dispatchEvent('change');
 await page.locator('#summaryReport').click();await expect(page.locator('#reportScope')).toContainText('Mar 2026');
 await expect(page.locator('#reportDownload')).toHaveAttribute('download',/2026-03/);
});
