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
  const parts=[frames.length+' 行'];
  if(Number.isFinite(value.start)&&Number.isFinite(value.end))parts.push('片段 '+clock(value.start)+'–'+clock(value.end));
  $('meta').textContent=parts.join(' · ');
  const link=value.url||(/^\/video\/[\w]+/.test(String(key).split(':')[0])?'https://www.bilibili.com'+String(key).split(':')[0]:'');
  if(link){$('meta').append(' · ');const a=document.createElement('a');a.href=link;a.textContent=link;$('meta').append(a)}
  for(const c of chapters){const s=document.createElement('span');s.style.setProperty('--c',c.color);s.textContent=c.name+' '+clock(c.time);$('legend').append(s)}
  if(!frames.length){$('score').innerHTML='<p class="empty">没有可打印的谱图</p>';return}
  frames.forEach((frame,i)=>{
    const end=frame.end??frames[i+1]?.time;
    const figure=document.createElement('figure'),caption=document.createElement('figcaption'),img=document.createElement('img');
    const no=document.createElement('b');no.textContent='第 '+(i+1)+' 行';caption.append(no,clock(frame.time)+(Number.isFinite(end)?'–'+clock(end):''));
    for(const c of chapters.filter(c=>c.time>=frame.time&&(!Number.isFinite(end)||c.time<end))){const tag=document.createElement('i');tag.style.setProperty('--c',c.color);tag.textContent=c.name;caption.append(tag)}
    img.src=frame.image;img.alt='第 '+(i+1)+' 行';figure.append(caption,img);$('score').append(figure);
  });
}).catch(error=>{$('title').textContent=error.message});