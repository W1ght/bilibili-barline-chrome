const $=id=>document.getElementById(id);
const clock=t=>{const d=Math.round(Math.max(0,t)*10);return Math.floor(d/600)+':'+((d%600)/10).toFixed(1).padStart(4,'0')};
$('print').onclick=()=>window.print();
$('captions').onchange=e=>document.body.classList.toggle('no-captions',!e.target.checked);
$('compact').onchange=e=>document.body.classList.toggle('compact',e.target.checked);
const key=new URL(location.href).searchParams.get('key');
chrome.runtime.sendMessage({type:'barline-score-get',key}).then(result=>{
  if(!result?.ok||!result.value)throw new Error(result?.error||'未找到谱面');
  const value=result.value,frames=(value.frames||[]).filter(f=>/^data:image\/(png|jpeg|webp);base64,/.test(f.image));
  const chapters=Array.isArray(value.chapters)?value.chapters.filter(c=>Number.isFinite(c.time)&&/^#[0-9a-f]{6}$/i.test(c.color)):[];
  const title=value.title||'音乐谱面';document.title=title;$('title').textContent=title;
  const count=document.createTextNode(frames.length+' 行');
  $('meta').append(count);
  if(Number.isFinite(value.start)&&Number.isFinite(value.end))$('meta').append(' · 片段 '+clock(value.start)+'–'+clock(value.end));
  const link=value.url||(/^\/video\/[\w]+/.test(String(key).split(':')[0])?'https://www.bilibili.com'+String(key).split(':')[0]:'');
  if(link){$('meta').append(' · ');const a=document.createElement('a');a.href=link;a.textContent=link;$('meta').append(a)}
  for(const c of chapters){const s=document.createElement('span');s.style.setProperty('--c',c.color);s.textContent=c.name+' '+clock(c.time);$('legend').append(s)}
  if(!frames.length){$('score').innerHTML='<p class="empty">没有可打印的谱图</p>';return}
  const ends=frames.map((frame,i)=>frame.end??frames[i+1]?.time);
  const ids=new Set(frames.map(f=>f.id)),repeats=frames.filter(f=>f.repeatOf&&ids.has(f.repeatOf)).length;
  // 反复演奏的行合并到首次出现处：按首次出现的顺序就是谱面的书写顺序。
  const render=merge=>{
    $('score').textContent='';
    const shown=merge?frames.map((frame,i)=>({frame,plays:[i]})).filter(r=>!(r.frame.repeatOf&&ids.has(r.frame.repeatOf))):frames.map((frame,i)=>({frame,plays:[i]}));
    if(merge)frames.forEach((f,i)=>{const row=f.repeatOf&&shown.find(r=>r.frame.id===f.repeatOf);if(row)row.plays.push(i)});
    count.textContent=merge&&repeats?shown.length+' 行（演奏 '+frames.length+' 行，已合并 '+repeats+' 行重复）':frames.length+' 行';
    shown.forEach(({frame,plays},k)=>{
      const figure=document.createElement('figure'),caption=document.createElement('figcaption'),img=document.createElement('img');
      const no=document.createElement('b');no.textContent='第 '+(k+1)+' 行';caption.append(no,plays.map(i=>clock(frames[i].time)+(Number.isFinite(ends[i])?'–'+clock(ends[i]):'')).join(' / '));
      if(plays.length>1){const tag=document.createElement('em');tag.textContent='演奏 '+plays.length+' 次';caption.append(tag)}
      const tags=new Set();
      for(const i of plays)for(const c of chapters.filter(c=>c.time>=frames[i].time&&(!Number.isFinite(ends[i])||c.time<ends[i])))if(!tags.has(c.name)){tags.add(c.name);const tag=document.createElement('i');tag.style.setProperty('--c',c.color);tag.textContent=c.name;caption.append(tag)}
      img.src=frame.image;img.alt='第 '+(k+1)+' 行';figure.append(caption,img);$('score').append(figure);
    });
  };
  $('merge').closest('label').hidden=!repeats;
  $('merge').onchange=e=>render(e.target.checked);
  render(true);
}).catch(error=>{$('title').textContent=error.message});