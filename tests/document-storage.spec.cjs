const {test,expect}=require('@playwright/test');
const fs=require('node:fs'),crypto=require('node:crypto'),X=require('xlsx');
test('original workbook is retained across commit and selection, then removed with history',async({request},info)=>{
 const origin=info.project.use.baseURL;
 const post=(url,data)=>request.post(url,{headers:{Origin:origin},data});
 const before=await(await request.get('/api/current')).json();
 const workbook=X.readFile('data/KPI Status 22.10.2026.xlsx');
 X.utils.book_append_sheet(workbook,X.utils.aoa_to_sheet(Array.from({length:12},(_,i)=>['Extra original content '+i,'x'.repeat(30000)])),'Retain original content');
 const bytes=X.write(workbook,{type:'buffer',bookType:'xlsx',compression:false});
 expect(bytes.length).toBeGreaterThan(250000);
 const preview=await request.post('/api/preview',{headers:{Origin:origin,'Content-Type':'application/octet-stream','X-File-Name':'retained-original.xlsx','X-Baseline-Id':before.version.id},data:bytes});
 expect(preview.ok(),await preview.text()).toBe(true);const draft=await preview.json();
 expect((await request.get(`/api/versions/${draft.id}/document`)).status()).toBe(404);
 const commit=await post('/api/commit',{draftId:draft.id,approved:true,useUploadedFile:true});expect(commit.ok(),await commit.text()).toBe(true);
 const document=await request.get(`/api/versions/${draft.id}/document`);expect(document.ok()).toBe(true);expect(await document.body()).toEqual(bytes);
 const manifest=await(await request.get('/api/sync-manifest')).json();
 expect(manifest.currentId).toBe(draft.id);expect(manifest.versions.find(v=>v.id===draft.id).sha256).toBe(crypto.createHash('sha256').update(bytes).digest('hex'));
 const rejected=await request.delete(`/api/versions/${draft.id}`,{headers:{Origin:origin},data:{confirmed:true}});expect(rejected.status()).toBe(409);
 expect((await request.get(`/api/versions/${draft.id}/document`)).ok()).toBe(true);
 expect((await post('/api/use-version',{versionId:before.version.id,expectedVersionId:draft.id})).ok()).toBe(true);
 const removed=await request.delete(`/api/versions/${draft.id}`,{headers:{Origin:origin},data:{confirmed:true}});expect(removed.ok()).toBe(true);
 expect((await request.get(`/api/versions/${draft.id}/document`)).status()).toBe(404);
 expect((await(await request.get('/api/sync-manifest')).json()).versions.some(v=>v.id===draft.id)).toBe(false);
});

