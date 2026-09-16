'use strict';
// One shared player; original downloads are available even without JavaScript.
const archiveCards=[...document.querySelectorAll('[data-recording]')];
const archiveFilters=[...document.querySelectorAll('[data-archive-filter]')];
const archiveDialog=document.getElementById('archive-dialog');
const archiveVideo=document.getElementById('archive-video');
const archivePlayer=players.get(archiveVideo);
const archivePageSize=9;
let archiveFilter='all', archivePage=0, archiveSelection=null, archiveItems=null, archiveRequest=null, archiveOpener=null;
const archiveEsc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function archiveMatchingCards(){return archiveCards.filter(c=>archiveFilter==='all'?c.dataset.group!=='edited':c.dataset.group===archiveFilter);}
function archiveRenderPage(){
  const selected=archiveMatchingCards();
  const pageCount=Math.ceil(selected.length/archivePageSize);
  archivePage=Math.min(archivePage,Math.max(0,pageCount-1));
  const visible=new Set(selected.slice(archivePage*archivePageSize,(archivePage+1)*archivePageSize));
  archiveCards.forEach(c=>c.hidden=!visible.has(c));
  archiveFilters.forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.archiveFilter===archiveFilter)));
  document.getElementById('archive-count').textContent=tr(`${archivePage*archivePageSize+1}–${Math.min((archivePage+1)*archivePageSize,selected.length)} of ${selected.length} ${archiveFilter==='edited'?'edited demos':'full recordings'}`,`显示 ${archivePage*archivePageSize+1}–${Math.min((archivePage+1)*archivePageSize,selected.length)} / ${selected.length} 段${archiveFilter==='edited'?'演示剪辑':'完整录像'}`);
  document.querySelector('.archive-pagination').hidden=pageCount<=1;
  document.getElementById('archive-prev').disabled=archivePage===0;
  document.getElementById('archive-next').disabled=archivePage>=pageCount-1;
  document.getElementById('archive-page').textContent=`${archivePage+1} / ${pageCount}`;
}
function archiveUpdateDetails(){
  if(!archiveSelection)return;
  const item=archiveSelection, isOriginal=item.kind==='original';
  archiveVideo.dataset.labelEn=`${item.id} · ${item.title.en}`;
  archiveVideo.dataset.labelZh=`${item.id} · ${item.title.zh}`;
  archiveVideo.dataset.audio=String(item.has_audio);
  archivePlayer.translate();
  document.getElementById('archive-dialog-kind').textContent=isOriginal?tr('FULL RECORDING · 1× ORIGINAL TIMELINE','完整录像 · 1 倍速原始时间线'):tr('EDITED RESEARCH DEMO','研究演示剪辑');
  document.getElementById('archive-dialog-title').textContent=(isOriginal?`${item.id} · `:'')+item.title[lang];
  const description=isOriginal
    ?tr(`${clockTime(item.duration_s)} · Full-length anonymous copy. Audio and identifying container metadata removed; video content retained.`,`${clockTime(item.duration_s)} · 完整时长匿名预览，已移除现场音轨与文件身份元数据，保留视频内容。`)
    :tr(`${clockTime(item.duration_s)} · Current website edit. Source recordings and timing are listed below.`,`${clockTime(item.duration_s)} · 当前网页演示剪辑。下方列有对应的源录像及剪辑时间。`);
  document.getElementById('archive-dialog-description').textContent=description;
  const download=document.getElementById('archive-original-link');download.href=item.original_url;download.download=item.original_filename;
  download.textContent=(isOriginal?tr('Download review copy','下载审阅副本'):tr('Download video','下载视频'))+` · ${(item.bytes/1e6).toFixed(1)} MB ↓`;
  const sourceLinks=item.provenance?.source_ids.map(id=>`<a href="${archiveEsc(archiveItems.find(x=>x.id===id).preview_url)}" data-open-recording="${id}">${id}</a>`).join(' ')||'';
  const segmentText=item.provenance?.segments?.map(s=>`${s.source_in}–${s.source_out} s (${s.speed}×)`).join('; ')||'';
  document.getElementById('archive-recording-details').innerHTML=`<dl><dt>${tr('File','文件')}</dt><dd><code>${archiveEsc(item.original_filename)}</code></dd><dt>SHA-256</dt><dd><code>${item.sha256}</code></dd>${isOriginal?`<dt>${tr('Video format','视频格式')}</dt><dd>${item.width} × ${item.height} · ${item.codec.toUpperCase()} · ${item.duration_s.toFixed(2)} s</dd><dt>${tr('Model / condition','模型 / 条件')}</dt><dd>${tr('Not assigned','尚未标注')}</dd>`:`<dt>${tr('Source recordings','源录像')}</dt><dd>${sourceLinks}</dd>${segmentText?`<dt>${tr('Source time ranges','原片时间范围')}</dt><dd>${segmentText}</dd>`:''}${item.provenance?.timeline_url?`<dt>${tr('Edit timeline','剪辑时间线')}</dt><dd><a href="${item.provenance.timeline_url}" download>JSON ↓</a></dd>`:''}`}</dl>`;
  const ids=archiveMatchingCards().map(c=>c.dataset.recording),index=ids.indexOf(item.id);
  document.getElementById('archive-recording-prev').disabled=index<=0;
  document.getElementById('archive-recording-next').disabled=index<0||index===ids.length-1;
  document.querySelector('.archive-close').setAttribute('aria-label',tr('Close video','关闭视频'));
}
async function archiveOpen(id,opener){
  if(!archiveItems){
    archiveRequest??=fetch('archive/manifest.json').then(r=>{if(!r.ok)throw new Error('Archive index unavailable');return r.json();}).then(m=>archiveItems=[...m.originals,...m.edits]).catch(e=>{archiveRequest=null;throw e;});
    try{await archiveRequest;}catch{
      document.getElementById('archive-count').textContent=tr('The preview index could not load. Original downloads remain available; click Preview to retry.','预览目录暂时无法载入，仍可下载审阅副本；再次点击预览即可重试。');return;
    }
  }
  const item=archiveItems.find(x=>x.id===id);if(!item)return;
  if(!archiveDialog.open){archiveOpener=opener;archiveDialog.showModal();}
  archiveSelection=item;
  archiveUpdateDetails();
  archivePlayer.setSource(item.preview_url,item.poster_url,item.duration_s);
  archiveVideo.muted=true;
  archiveDialog.scrollTop=0;
  archivePlayer.playAt(0);
}
document.addEventListener('click',event=>{
  const link=event.target.closest('[data-open-recording]');if(!link)return;
  if(event.ctrlKey||event.metaKey||event.shiftKey||event.altKey)return;
  event.preventDefault();archiveOpen(link.dataset.openRecording,link);
});
archiveFilters.forEach(button=>button.addEventListener('click',()=>{archiveFilter=button.dataset.archiveFilter;archivePage=0;archiveRenderPage();}));
function archiveChangePage(delta){archivePage+=delta;archiveRenderPage();document.querySelector('.archive-tools').scrollIntoView({block:'start'});}
document.getElementById('archive-prev').addEventListener('click',()=>archiveChangePage(-1));
document.getElementById('archive-next').addEventListener('click',()=>archiveChangePage(1));
function archiveStep(delta){const ids=archiveMatchingCards().map(c=>c.dataset.recording);const id=ids[ids.indexOf(archiveSelection.id)+delta];if(id)archiveOpen(id);}
document.getElementById('archive-recording-prev').addEventListener('click',()=>archiveStep(-1));
document.getElementById('archive-recording-next').addEventListener('click',()=>archiveStep(1));
document.querySelector('.archive-close').addEventListener('click',()=>archiveDialog.close());
archiveDialog.addEventListener('close',()=>{archiveVideo.pause();archivePlayer.intent++;archivePlayer.resumeIntent=false;archiveOpener?.focus();});
archiveDialog.addEventListener('click',event=>{if(event.target===archiveDialog){const rect=archiveDialog.getBoundingClientRect();if(event.clientX<rect.left||event.clientX>rect.right||event.clientY<rect.top||event.clientY>rect.bottom)archiveDialog.close();}});
langButton.addEventListener('click',()=>{archiveRenderPage();archiveUpdateDetails();});
archiveRenderPage();
