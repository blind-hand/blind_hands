'use strict';
const langButton = document.getElementById('language');
const overview = document.getElementById('overview-video');
const downloadDemo = document.getElementById('download-demo');
let lang = 'en';
const tr = (en, zh) => lang === 'en' ? en : zh;
const clockTime = s => `${String(Math.floor(s / 60)).padStart(2,'0')}:${String(Math.floor(s % 60)).padStart(2,'0')}`;
const chapters = [...document.querySelectorAll('.chapter')];
function highlightChapter(time) {
  let active=0;
  chapters.forEach((b,i)=>{if(time>=Number(b.dataset.time))active=i;});
  chapters.forEach((b,i)=>{b.classList.toggle('active',i===active);if(i===active)b.setAttribute('aria-current','true');else b.removeAttribute('aria-current');});
}
const blobs = new Map();
let mediaParts;
function mediaIndex() {
  if (!mediaParts) mediaParts=fetch('assets/media-parts.json',{credentials:'same-origin',cache:'no-store'})
    .then(r=>{if(!r.ok)throw new Error('Media index unavailable');return r.json();})
    .catch(error=>{mediaParts=null;throw error;});
  return mediaParts;
}

async function fetchVideoBytes(url,onProgress) {
  const parts = (await mediaIndex())[new URL(url,location.href).pathname.split('/').pop()];
  const urls = parts ? parts.map(part => `assets/${part}`) : [url];
  const progress=urls.map(()=>0);
  const report=(i,value)=>{progress[i]=value;onProgress(Math.floor(100*progress.reduce((a,b)=>a+b,0)/urls.length));};
  const buffers = await Promise.all(urls.map(async (path,i) => {
    const resource = new URL(path,location.href);
    resource.searchParams.set('playback','full-v4');
    for(let attempt=0;attempt<3;attempt++){
      const controller=new AbortController();
      const timeout=setTimeout(()=>controller.abort(),45000);
      try{
        const response=await fetch(resource.href,{credentials:'same-origin',cache:'no-store',signal:controller.signal});
        if(!response.ok)throw new Error(`Video request failed: ${response.status}`);
        const total=response.headers.get('content-encoding')?0:Number(response.headers.get('content-length'));
        const reader=response.body.getReader(); const chunks=[];let received=0;
        while(true){const {done,value}=await reader.read();if(done)break;chunks.push(value);received+=value.byteLength;if(total>0)report(i,Math.min(.99,received/total));}
        if(!received||(total>0&&received!==total))throw new Error('Incomplete video transfer');
        report(i,1);return new Blob(chunks);
      }catch(error){if(attempt===2)throw error;}finally{clearTimeout(timeout);}
    }
  }));
  return new Blob(buffers,{type:'video/mp4'});
}

// Static hosting may ignore Range. A complete Blob makes native seeking local.
function localVideo(url,onProgress) {
  if (!blobs.has(url)) {
    const entry={progress:0,listeners:new Set(),promise:null};
    entry.promise = fetchVideoBytes(url,value=>{entry.progress=value;entry.listeners.forEach(fn=>fn(value));})
      .then(blob => {
        if (!blob.size) throw new Error('Empty video');
        entry.local=URL.createObjectURL(new Blob([blob], { type: 'video/mp4' }));
        // Keep a long browsing session bounded; never revoke a player's source.
        for(const [key,cached] of blobs){
          if(blobs.size<=6)break;
          if(key!==url&&cached.local&&![...document.querySelectorAll('video')].some(v=>v.src===cached.local)){
            URL.revokeObjectURL(cached.local);blobs.delete(key);
          }
        }
        return entry.local;
      })
      .catch(error => { blobs.delete(url); throw error; });
    blobs.set(url, entry);
  }
  const entry=blobs.get(url);entry.listeners.add(onProgress);onProgress(entry.progress);
  return entry.promise.finally(()=>entry.listeners.delete(onProgress));
}
const players = new Map();
class VideoPlayer {
  constructor(video) {
    this.video = video;
    this.url = video.querySelector('source').getAttribute('src');
    this.version = 0;
    this.pending = null;
    this.ready = false;
    this.loading = false;
    this.failed = false;
    this.progress=0;this.intent=0;this.requestedTime=null;this.resumeIntent=false;
    this.duration=Number(video.dataset.duration)||(video.id==='overview-video'?120:{success:8,failure:12,retry:30}[video.dataset.video]);
    this.label = video.getAttribute('aria-label');
    video.querySelector('source').remove();
    video.controls = false;
    video.muted=true;
    this.box = document.createElement('div');
    this.box.className = 'seekable-player';
    video.replaceWith(this.box);
    this.stage = document.createElement('div');
    this.stage.className = 'video-stage';
    this.box.append(this.stage);
    this.stage.append(video);
    this.start = document.createElement('button');
    this.start.className = 'video-start';
    this.start.addEventListener('click', () => this.playAt());
    this.stage.append(this.start);
    this.transport = document.createElement('div');
    this.transport.className = 'video-transport';
    this.timeline=document.createElement('div');this.timeline.className='video-timeline';
    this.range=document.createElement('input');this.range.type='range';this.range.min='0';this.range.max=this.duration;this.range.step='.1';this.range.value='0';
    this.range.addEventListener('input',()=>this.playAt(Number(this.range.value),this.ready?!video.paused:true));
    this.time=document.createElement('span');this.time.className='video-time';this.timeline.append(this.range,this.time);
    this.toggle=document.createElement('button');this.toggle.className='video-toggle';
    const togglePlayback=()=>{if(this.ready&&!video.paused)video.pause();else this.playAt();};
    this.toggle.addEventListener('click',togglePlayback);
    video.addEventListener('click',togglePlayback);
    this.back = document.createElement('button');
    this.back.textContent = '−5 s';
    this.forward = document.createElement('button');
    this.forward.textContent = '+5 s';
    this.back.addEventListener('click',()=>this.playAt((this.requestedTime??video.currentTime)-5,this.ready?!video.paused:true));
    this.forward.addEventListener('click',()=>this.playAt((this.requestedTime??video.currentTime)+5,this.ready?!video.paused:true));
    this.rate = document.createElement('select');
    [0.5,1,1.5,2].forEach(value => {
      const option = document.createElement('option');
      option.value = value; option.textContent = `${value}×`;
      this.rate.append(option);
    });
    this.rate.value = '1';
    this.rate.addEventListener('change', () => { video.playbackRate = Number(this.rate.value); });
    this.fullscreen=document.createElement('button');this.fullscreen.className='video-fullscreen';this.fullscreen.textContent='⛶';
    this.fullscreen.addEventListener('click',async()=>{
      try{
        if(document.fullscreenElement===this.box)await document.exitFullscreen();
        else if(this.box.requestFullscreen)await this.box.requestFullscreen();
        else if(video.webkitEnterFullscreen)video.webkitEnterFullscreen();
      }catch{this.status.textContent=tr('Fullscreen is unavailable in this browser.','当前浏览器暂不支持全屏。');}
    });
    document.addEventListener('fullscreenchange',()=>this.translate());
    this.transport.append(this.timeline,this.toggle,this.back, this.forward, this.rate,this.fullscreen);
    this.audio=document.createElement('button');this.audio.className='video-audio';
    this.audio.addEventListener('click',()=>{video.muted=!video.muted;this.translate();});
    this.transport.append(this.audio);
    this.box.append(this.transport);
    this.status = document.createElement('span');
    this.status.className = 'video-status';
    this.status.setAttribute('role','status');
    this.box.append(this.status);
    video.addEventListener('play', () => {
      players.forEach(player => { if (player.video !== video) player.video.pause(); });
      this.translate();
    });
    video.addEventListener('pause',()=>this.translate());
    video.addEventListener('ended',()=>this.translate());
    video.addEventListener('timeupdate',()=>this.updateTimeline());
    this.translate();
    this.updateTimeline();
  }
  updateTimeline(){
    const time=this.requestedTime??(this.ready?this.video.currentTime:0);
    this.range.value=time;this.time.textContent=`${clockTime(time)} / ${clockTime(this.duration)}`;
    this.range.setAttribute('aria-valuetext',this.time.textContent);
    if(this.video===overview)highlightChapter(time);
  }
  translate() {
    const names = this.video.id === 'overview-video'
      ? ['Blind Hands two-minute research overview','Blind Hands 两分钟研究总览']
      : {success:['Successful removal','成功取盖'],failure:['Unsuccessful attempt','未能取盖'],retry:['Repeated attempts','反复尝试后取盖']}[this.video.dataset.video];
    if(names){this.label=tr(...names);this.video.setAttribute('aria-label',this.label);}
    if(this.video.dataset.labelEn){this.label=tr(this.video.dataset.labelEn,this.video.dataset.labelZh);this.video.setAttribute('aria-label',this.label);}
    this.audio.hidden=this.video.dataset.audio!=='true';
    this.audio.textContent=this.video.muted?tr('Sound on','开启声音'):tr('Mute','静音');
    this.audio.setAttribute('aria-label',this.audio.textContent+': '+this.label);
    this.start.textContent = this.loading ? tr(`Loading video ${this.progress}%`,`正在载入视频 ${this.progress}%`) : this.failed ? tr('Retry video','重新载入视频') : tr('▷ Play video','▷ 播放视频');
    this.start.setAttribute('aria-label', this.start.textContent + ': ' + this.label);
    this.back.setAttribute('aria-label', tr('Back 5 seconds','后退 5 秒') + ': ' + this.label);
    this.forward.setAttribute('aria-label', tr('Forward 5 seconds','快进 5 秒') + ': ' + this.label);
    this.rate.setAttribute('aria-label', tr('Playback speed','播放速度') + ': ' + this.label);
    this.range.setAttribute('aria-label',tr('Video timeline','视频进度')+': '+this.label);
    this.toggle.textContent=this.ready&&!this.video.paused?tr('Pause','暂停'):tr('Play','播放');
    this.toggle.setAttribute('aria-label',this.toggle.textContent+': '+this.label);
    this.fullscreen.setAttribute('aria-label',(document.fullscreenElement===this.box?tr('Exit fullscreen','退出全屏'):tr('Fullscreen','全屏'))+': '+this.label);
    this.status.textContent = this.failed ? tr('Video could not load. Please retry.','视频未能载入，请重试。') : this.loading ? tr(`Loading ${this.progress}% · Will open at ${clockTime(this.requestedTime??0)}`,`已载入 ${this.progress}% · 即将跳转至 ${clockTime(this.requestedTime??0)}`) : '';
  }
  setSource(url, poster, duration=this.duration) {
    this.version++;
    this.intent++;
    this.video.pause();
    this.video.removeAttribute('src');this.video.load();
    this.url = url;
    this.video.poster = poster;
    this.ready = false; this.pending = null; this.loading = false; this.failed = false;
    this.progress=0;
    this.duration=duration;this.range.max=duration;this.requestedTime=0;this.resumeIntent=false;
    this.video.controls = false; this.start.hidden = false; this.start.disabled = false;
    this.box.removeAttribute('aria-busy');
    this.translate();
    this.updateTimeline();
  }
  ensureReady() {
    if (this.ready) return Promise.resolve(true);
    if (this.pending) return this.pending;
    const version = this.version;
    this.loading = true; this.failed = false; this.start.disabled = true;
    this.box.setAttribute('aria-busy','true'); this.translate();
    this.pending = (async () => {
      try {
        const local = await localVideo(this.url,progress=>{if(version===this.version){this.progress=progress;this.translate();}});
        if (version !== this.version) return false;
        await new Promise((resolve,reject) => {
          const clear = () => { clearTimeout(timeout); this.video.removeEventListener('loadedmetadata',ok); this.video.removeEventListener('error',bad); };
          const ok = () => { clear(); resolve(); };
          const bad = () => { clear(); reject(new Error(this.video.error?.message || 'Video metadata unavailable')); };
          const timeout=setTimeout(bad,15000);
          this.video.addEventListener('loadedmetadata',ok,{once:true});
          this.video.addEventListener('error',bad,{once:true});
          this.video.src = local;
          this.video.load();
        });
        if (version !== this.version) return false;
        this.ready = true;
        this.video.controls = false; this.start.hidden = true;
        this.duration=this.video.duration;this.range.max=this.duration;
        this.video.playbackRate = Number(this.rate.value);
        return true;
      } catch (error) {
        console.warn('Video loading failed:', error.message);
        if (version === this.version) this.failed = true;
        return false;
      } finally {
        if (version === this.version) {
          this.loading = false; this.pending = null; this.start.disabled = false;
          this.box.removeAttribute('aria-busy'); this.translate();
        }
      }
    })();
    return this.pending;
  }
  seek(time) {
    if (!this.ready || !Number.isFinite(this.video.duration)) return;
    this.video.currentTime = Math.max(0, Math.min(time, this.video.duration - 0.04));
  }
  async playAt(time, resume=true) {
    const version = this.version;
    const intent=++this.intent;
    this.requestedTime=Math.max(0,Math.min(time??this.requestedTime??this.video.currentTime,this.duration-.04));
    this.resumeIntent=resume;this.updateTimeline();this.translate();
    if (!(await this.ensureReady()) || version !== this.version || intent!==this.intent) return;
    this.seek(this.requestedTime);this.requestedTime=null;
    if(resume){try{await this.video.play();}catch{this.status.textContent=tr('Ready at the selected time. Press Play to continue.','已跳转到所选时间，点击播放即可继续。');}}
    this.updateTimeline();
  }
}
document.querySelectorAll('video').forEach(video => players.set(video,new VideoPlayer(video)));
langButton.addEventListener('click', () => {
  const player = players.get(overview);
  const currentTime = player.requestedTime??overview.currentTime??0;
  const playing = player.loading?player.resumeIntent:!overview.paused;
  const wasLoaded = player.ready || player.loading;
  lang = lang === 'en' ? 'zh' : 'en';
  document.documentElement.lang = lang;
  langButton.innerHTML = (lang === 'en' ? '中文' : 'EN') + ' <span aria-hidden="true">⇄</span>';
  langButton.setAttribute('aria-label', tr('Switch to Chinese','切换为英文'));
  const fileLang = lang === 'zh' ? 'cn' : 'en';
  player.setSource(`assets/demo-${fileLang}.mp4?v=20260916`, `assets/demo-${fileLang}.jpg?v=20260916`);
  downloadDemo.href = `assets/demo-${fileLang}.mp4?v=20260916`;
  players.forEach(p => p.translate());
  if (wasLoaded) player.playAt(currentTime,playing);
});
chapters.forEach(button => {button.addEventListener('click', () => players.get(overview).playAt(Number(button.dataset.time)));button.disabled=false;});
function revealDefinitions() {
  if (location.hash === '#metric-definitions') {
    const definitions = document.getElementById('metric-definitions');
    definitions.open = true;
    definitions.scrollIntoView({block:'start',behavior:'auto'});
  }
}
document.querySelector('a[href="#metric-definitions"]').addEventListener('click', () => {
  document.getElementById('metric-definitions').open = true;
});
window.addEventListener('hashchange',revealDefinitions);
revealDefinitions();
