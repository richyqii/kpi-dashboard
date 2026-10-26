/* One-page report generated locally from the active workbook; no document leaves the browser. */
(function () {
  const button = document.getElementById('summaryReport');
  const dialog = document.createElement('dialog');
  dialog.id = 'summaryReportDialog';
  dialog.setAttribute('aria-labelledby', 'summaryReportTitle');
  dialog.innerHTML = '<div class="report-toolbar"><h2 id="summaryReportTitle">Summary Report · PDF Preview</h2><a id="reportDownload" class="upload-button">Download PDF</a><button type="button" id="reportClose">Close</button></div><p id="reportScope"></p><div id="reportPages"></div><p id="reportError" role="alert" hidden></p>';
  document.body.append(dialog);
  const style = document.createElement('style');
  style.textContent = '#summaryReportDialog{margin:auto;overflow:auto}#reportDownload{background:#24558d;color:white;text-decoration:none}#reportDownload:hover{background:#173758}#summaryReportDialog{width:min(960px,94vw);max-height:94vh;padding:20px;border:1px solid #d7e2ef;border-radius:16px;background:#eef3f9;color:#102c4c}#summaryReportDialog::backdrop{background:#102c4c99}.report-toolbar{display:flex;align-items:center;gap:16px;flex-wrap:wrap}.report-toolbar h2{flex:1;font-size:20px;margin:0}.report-toolbar button{padding:10px 18px;border:1px solid #ccd8e6;border-radius:8px;background:white;cursor:pointer}#reportPages img{display:block;width:100%;max-width:794px;height:auto;margin:16px auto;background:white;box-shadow:0 3px 20px #1232}#reportScope{font-size:14px}';
  document.head.append(style);
  let url;
  dialog.querySelector('#reportClose').onclick = () => dialog.close();
  dialog.addEventListener('close', () => { if (url) URL.revokeObjectURL(url); url = null; button.focus(); });
  const percent = (n, total) => total ? (n / total * 100).toFixed(1) + '%' : '0.0%';

  function analyse(rows, from, to) {
    const selected = rows.filter(r => r.month >= from && r.month <= to);
    const pics = new Map(), companies = new Map(), servicesMap = new Map();
    for (const r of selected) {
      const status = KpiCore.effectiveStatus(r, to);
      const name = String(r.pic || 'Unassigned').trim();
      if (!['JIAWEN', 'UNASSIGNED'].includes(name.replace(/\s/g, '').toUpperCase())) {
        if (!pics.has(name)) pics.set(name, {name, total:0, completed:0, delayed:0, min:undefined, max:undefined});
        const p = pics.get(name); p.total++; p.completed += status === 'completed'; p.delayed += status === 'delay';
        if (p.min === undefined || r.month < p.min) p.min = r.month;
        if (p.max === undefined || r.month > p.max) p.max = r.month;
      }
      if (!companies.has(r.company)) companies.set(r.company, {name:r.company, total:0, delayed:0, services:new Set()});
      const c = companies.get(r.company); c.total++;
      if (status === 'delay') { c.delayed++; c.services.add(r.service); }
      if (!servicesMap.has(r.service)) servicesMap.set(r.service, {name:r.service, total:0, delayed:0, companies:new Set()});
      const s = servicesMap.get(r.service); s.total++;
      if (status === 'delay') { s.delayed++; s.companies.add(r.company); }
    }
    const risks = [...companies.values()].filter(c => c.delayed).map(c => ({...c, rate:c.delayed/c.total, risk:c.delayed/c.total >= .5 ? 'High' : c.delayed/c.total >= .25 ? 'Medium' : 'Low'})).sort((a,b) => b.rate-a.rate || b.delayed-a.delayed || a.name.localeCompare(b.name));
    const serviceRisks = [...servicesMap.values()].filter(s => s.delayed).map(s => ({...s, rate:s.delayed/s.total})).sort((a,b) => b.rate-a.rate || b.delayed-a.delayed || a.name.localeCompare(b.name));
    return {total:selected.length, companies:companies.size, delayed:risks.reduce((n,c)=>n+c.delayed,0), pics:[...pics.values()].sort((a,b)=>b.completed-a.completed || a.name.localeCompare(b.name)), risks, serviceRisks};
  }

  // JPEG pages embedded in a standards-compatible PDF preserve all font glyphs.
  function pdf(canvases) {
    const images = canvases.map(cv => Uint8Array.from(atob(cv.toDataURL('image/jpeg', .95).split(',')[1]), c=>c.charCodeAt(0)));
    const enc = new TextEncoder(), chunks = [], offsets = [0]; let size = 0;
    const append = data => { const b = typeof data === 'string' ? enc.encode(data) : data; chunks.push(b); size += b.length; };
    const object = (id, data) => { offsets[id]=size; append(id+' 0 obj\n'+data+'\nendobj\n'); };
    append('%PDF-1.4\n');
    object(1, '<< /Type /Catalog /Pages 2 0 R >>');
    const kids = canvases.map((cv,i) => (3+i*3)+' 0 R').join(' ');
    object(2, '<< /Type /Pages /Kids ['+kids+'] /Count '+canvases.length+' >>');
    canvases.forEach((cv, i) => {
      const pageId = 3+i*3, imgId = pageId+1, contentId = pageId+2;
      const jpeg = images[i];
      object(pageId, '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /XObject << /Report'+(i===0?'':'2')+' '+imgId+' 0 R >> >> /Contents '+contentId+' 0 R >>');
      offsets[imgId]=size; append(imgId+' 0 obj\n<< /Type /XObject /Subtype /Image /Width '+cv.width+' /Height '+cv.height+' /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length '+jpeg.length+' >>\nstream\n'); append(jpeg); append('\nendstream\nendobj\n');
      const name = i===0 ? '/Report' : '/Report2';
      const stream='q 595 0 0 842 0 0 cm '+name+' Do Q\n';
      object(contentId, '<< /Length '+stream.length+' >>\nstream\n'+stream+'\nendstream');
    });
    const count = canvases.length*3+2, xref=size;
    append('xref\n0 '+(count+1)+'\n0000000000 65535 f \n');
    for (let i=1;i<=count;i++) append(String(offsets[i]).padStart(10,'0')+' 00000 n \n');
    append('trailer\n<< /Size '+(count+1)+' /Root 1 0 R >>\nstartxref\n'+xref+'\n%%EOF');
    return new Blob(chunks,{type:'application/pdf'});
  }

  button.onclick = () => {
    const from=document.getElementById('fromDate').value, to=document.getElementById('toDate').value;
    const file=document.getElementById('currentFileName').textContent.replace(/^Current file:\s*/, '');
    const data=analyse(activeDashboardCompanyData,from,to);
    const canvas=document.createElement('canvas'); canvas.width=1190; canvas.height=1684;
    const ctx=canvas.getContext('2d'); ctx.scale(2,2);
    ctx.fillStyle='white'; ctx.fillRect(0,0,595,842);
    function text(value,x,y,size=10,color='#173758',bold=false,max=520) {
      ctx.font=(bold?'bold ':'')+size+'px Arial'; ctx.fillStyle=color;
      let s=String(value); while(ctx.measureText(s).width>max && s.length>1) s=s.slice(0,-2)+'…';
      ctx.fillText(s,x,y);
    }
    function line(y) {ctx.fillStyle='#e1e8f0';ctx.fillRect(32,y,531,1);}
    function band(title,y) {ctx.fillStyle='#edf3fa';ctx.fillRect(32,y-17,531,27);text(title,42,y,12,'#173758',true);}
    text('KPI SUMMARY REPORT',32,44,22,'#173758',true);
    text(monthLabel(from)+' – '+monthLabel(to)+' | All companies and services',32,66);
    text('Source: '+file,32,84,9);
    text('Generated '+new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Singapore',dateStyle:'medium',timeStyle:'short'}).format(new Date())+' (Singapore)',32,100,8,'#63758b');
    line(112);
    text(data.total+' tasks',32,138,15,'#173758',true);text(data.companies+' companies',200,138,15,'#173758',true);text(data.delayed+' delayed tasks',385,138,15,'#d64550',true);
    let cursor=173;
    // 1. PIC completion analysis
    band('1. PIC completion analysis',cursor);
    let hy=cursor+27;
    text('PIC',42,hy,9,'#63758b',true);text('Period (from - to)',180,hy,9,'#63758b',true);text('Tasks',355,hy,9,'#63758b',true);
    hy+=18;
    const visiblePics=data.pics.slice(0,8);
    if(!visiblePics.length) { text('No assigned PIC records in this month range.',42,hy); hy+=18; }
    else {
      visiblePics.forEach(p=>{const period=p.min!==undefined?monthLabel(p.min)+' - '+monthLabel(p.max):'-';text(p.name,42,hy,10,'#173758',true,125);text(period,180,hy,10,'#173758',false,155);text(p.completed,360,hy);line(hy+8);hy+=21;});
      hy+=4;
      const best=data.pics[0];
      text('Who did the most tasks: '+best.name+' ('+best.completed+' of '+best.total+' assigned), all services.',42,hy,9,'#12956d',true,520);
      hy+=22;
    }
    // 2. Companies requiring attention
    hy+=6;
    band('2. Companies requiring attention',hy);
    hy+=27;
    text('Company / affected services',42,hy,9,'#63758b',true);text('Delayed',355,hy,9);text('Percentage',415,hy,9);text('Risk',505,hy,9);
    hy+=20;
    if(!data.risks.length) { text('No delayed tasks in the selected month range.',42,hy,11,'#12956d'); hy+=22; }
    else {
      data.risks.slice(0,5).forEach(c=>{const color=c.risk==='High'?'#ca3147':c.risk==='Medium'?'#a96700':'#346886';text(c.name,42,hy,9,'#173758',true,300);text([...c.services].sort().join(', '),42,hy+11,8,'#63758b',false,300);text(c.delayed+' / '+c.total,355,hy,9);text(percent(c.delayed,c.total),415,hy,9);text(c.risk,505,hy,9,color,true);line(hy+17);hy+=30;});
      text(data.risks.length>5?'Top 5 of '+data.risks.length+' companies with delays shown.':'All '+data.risks.length+' companies with delays shown. Ranked by delayed percentage, then delayed quantity: High ≥50%; Medium ≥25% to <50%; Low >0% to <25%.',32,hy+2,8,'#63758b');
      hy+=16;
    }
    // 3. Service delay focus
    hy+=4;
    band('3. Service delay focus',hy);
    hy+=27;
    if(!data.serviceRisks.length) { text('No delayed tasks in the selected month range.',42,hy,11,'#12956d'); hy+=22; }
    else {
      const topService=data.serviceRisks[0];
      text('Service',42,hy,9,'#63758b',true);text('Delayed',300,hy,9);text('Percentage',375,hy,9);text('Focus',475,hy,9);hy+=17;
      data.serviceRisks.forEach((s,i)=>{const color=i===0?'#ca3147':s.rate>=.25?'#a96700':'#346886';text(s.name,42,hy,10,'#173758',true,240);text(s.delayed+' / '+s.total,300,hy,9);text(percent(s.delayed,s.total),375,hy,9);text(i===0?'Needs focus':s.rate>=.25?'Watch':'Low',475,hy,9,color,true);line(hy+12);hy+=17;});
      hy+=2;
      const affected=[...topService.companies].sort();
      text('Most focus needed: '+topService.name+' ('+percent(topService.delayed,topService.total)+' delayed). Affected companies: '+(affected.join(', ')),32,hy,9,'#173758',true,520);
      hy+=14;
      line(hy);
      text('Percentage = delayed tasks / total assigned tasks. Address the highest percentage service first.',32,hy+15,8,'#63758b');
      hy+=15;
    }
    line(hy+8);
    text('KPI Dashboard | Summary Report',32,hy+23,8,'#63758b');text('1 / 1',535,hy+23,8);
    if(url) URL.revokeObjectURL(url); url=URL.createObjectURL(pdf([canvas]));
    const link=dialog.querySelector('#reportDownload');link.href=url;link.download='KPI-Summary-'+from+'-to-'+to+'.pdf';
    dialog.querySelector('#reportPages').innerHTML='<img alt="KPI summary report: PIC completion analysis, company risk priorities and service delay focus" src="'+canvas.toDataURL('image/png')+'">';
    dialog.querySelector('#reportScope').textContent='One-page PDF • '+monthLabel(from)+' to '+monthLabel(to)+' • '+file;
    dialog.showModal();
  };
})();
