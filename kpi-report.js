/* One-page report generated locally from the active workbook; no document leaves the browser. */
(function () {
  const button = document.getElementById('summaryReport');
  const dialog = document.createElement('dialog');
  dialog.id = 'summaryReportDialog';
  dialog.setAttribute('aria-labelledby', 'summaryReportTitle');
  dialog.innerHTML = '<div class="report-toolbar"><h2 id="summaryReportTitle">Summary Report · PDF Preview</h2><a id="reportDownload" class="upload-button">Download PDF</a><button type="button" id="reportClose">Close</button></div><p id="reportScope"></p><img id="reportPreview" alt="One-page KPI summary report: PIC completion analysis and company risk priorities"><p id="reportError" role="alert" hidden></p>';
  document.body.append(dialog);
  const style = document.createElement('style');
  style.textContent = '#summaryReportDialog{margin:auto;overflow:auto}#reportDownload{background:#24558d;color:white;text-decoration:none}#reportDownload:hover{background:#173758}#summaryReportDialog{width:min(960px,94vw);max-height:94vh;padding:20px;border:1px solid #d7e2ef;border-radius:16px;background:#eef3f9;color:#102c4c}#summaryReportDialog::backdrop{background:#102c4c99}.report-toolbar{display:flex;align-items:center;gap:16px;flex-wrap:wrap}.report-toolbar h2{flex:1;font-size:20px;margin:0}.report-toolbar button{padding:10px 18px;border:1px solid #ccd8e6;border-radius:8px;background:white;cursor:pointer}#reportPreview{display:block;width:100%;max-width:794px;height:auto;margin:16px auto;background:white;box-shadow:0 3px 20px #1232}#reportScope{font-size:14px}';
  document.head.append(style);
  let url;
  dialog.querySelector('#reportClose').onclick = () => dialog.close();
  dialog.addEventListener('close', () => { if (url) URL.revokeObjectURL(url); url = null; button.focus(); });
  const percent = (n, total) => total ? (n / total * 100).toFixed(1) + '%' : '0.0%';

  function analyse(rows, from, to) {
    const selected = rows.filter(r => r.month >= from && r.month <= to);
    const pics = new Map(), companies = new Map();
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
    }
    const risks = [...companies.values()].filter(c => c.delayed).map(c => ({...c, rate:c.delayed/c.total, risk:c.delayed/c.total >= .5 ? 'High' : c.delayed/c.total >= .25 ? 'Medium' : 'Low'})).sort((a,b) => b.rate-a.rate || b.delayed-a.delayed || a.name.localeCompare(b.name));
    return {total:selected.length, companies:companies.size, delayed:risks.reduce((n,c)=>n+c.delayed,0), pics:[...pics.values()].sort((a,b)=>b.completed-a.completed || a.name.localeCompare(b.name)), risks};
  }

  // A single JPEG page embedded in a standards-compatible PDF preserves all font glyphs.
  function pdf(canvas) {
    const jpeg = Uint8Array.from(atob(canvas.toDataURL('image/jpeg', .95).split(',')[1]), c=>c.charCodeAt(0));
    const enc = new TextEncoder(), chunks = [], offsets = [0]; let size = 0;
    const append = data => { const b = typeof data === 'string' ? enc.encode(data) : data; chunks.push(b); size += b.length; };
    const object = (id, data) => { offsets[id]=size; append(id+' 0 obj\n'+data+'\nendobj\n'); };
    append('%PDF-1.4\n');
    object(1, '<< /Type /Catalog /Pages 2 0 R >>');
    object(2, '<< /Type /Pages /Kids [3 0 R] /Count 1 >>');
    object(3, '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /XObject << /Report 4 0 R >> >> /Contents 5 0 R >>');
    offsets[4]=size; append('4 0 obj\n<< /Type /XObject /Subtype /Image /Width '+canvas.width+' /Height '+canvas.height+' /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length '+jpeg.length+' >>\nstream\n'); append(jpeg); append('\nendstream\nendobj\n');
    const stream='q 595 0 0 842 0 0 cm /Report Do Q\n';
    object(5, '<< /Length '+stream.length+' >>\nstream\n'+stream+'endstream');
    const xref=size; append('xref\n0 6\n0000000000 65535 f \n');
    for (let i=1;i<=5;i++) append(String(offsets[i]).padStart(10,'0')+' 00000 n \n');
    append('trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n'+xref+'\n%%EOF');
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
    band('1. PIC completion analysis',173);
    text('PIC',42,204,9,'#63758b',true);text('Period (from - to)',180,204,9,'#63758b',true);text('Tasks',355,204,9,'#63758b',true);
    const visiblePics=data.pics.slice(0,8);
    visiblePics.forEach((p,i)=>{const y=228+i*23;const period=p.min!==undefined?monthLabel(p.min)+' - '+monthLabel(p.max):'-';text(p.name,42,y,10,'#173758',true,125);text(period,180,y,10,'#173758',false,155);text(p.completed,360,y);line(y+8);});
    if(!visiblePics.length) text('No assigned PIC records in this month range.',42,228);
    else {
      const best=data.pics[0];
      text('Who did the most tasks: '+best.name+' ('+best.completed+' of '+best.total+' assigned), all services.',42,418,9,'#12956d',true,520);
    }
    band('2. Companies requiring attention',478);
    text('Company / affected services',42,508,9,'#63758b',true);text('Delayed',355,508,9);text('Share',425,508,9);text('Risk',505,508,9);
    data.risks.slice(0,6).forEach((c,i)=>{const y=535+i*32;const color=c.risk==='High'?'#ca3147':c.risk==='Medium'?'#a96700':'#346886';text(c.name,42,y,9,'#173758',true,300);text([...c.services].sort().join(', '),42,y+12,8,'#63758b',false,300);text(c.delayed+' / '+c.total,355,y,9);text(percent(c.delayed,c.total),425,y,9);text(c.risk,505,y,9,color,true);line(y+19);});
    if(!data.risks.length) text('No delayed tasks in the selected month range.',42,535,11,'#12956d');
    text(data.risks.length>6?'Top 6 of '+data.risks.length+' companies with delays shown.':'All '+data.risks.length+' companies with delays shown.',32,744,8,'#63758b');
    text('Risk by delayed share: High ≥50%; Medium ≥25% to <50%; Low >0% to <25%.',32,761,8,'#63758b');
    text('Ranked by delayed share, then delayed quantity. High-risk companies need priority follow-up.',32,774,8,'#63758b');
    text('Delays follow the dashboard selected To month cutoff. Review high-risk companies first.',32,787,8,'#63758b');
    line(803);text('KPI Dashboard | Summary Report',32,821,8,'#63758b');text('1 / 1',535,821,8);
    if(url) URL.revokeObjectURL(url); url=URL.createObjectURL(pdf(canvas));
    const link=dialog.querySelector('#reportDownload');link.href=url;link.download='KPI-Summary-'+from+'-to-'+to+'.pdf';
    dialog.querySelector('#reportPreview').src=canvas.toDataURL('image/png');
    dialog.querySelector('#reportScope').textContent='One-page PDF • '+monthLabel(from)+' to '+monthLabel(to)+' • '+file;
    dialog.showModal();
  };
})();
