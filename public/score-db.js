// Score storage. Row images live in their own records ("img:<key>:<frameId>"),
// so a save that only changes settings, anchors or panel geometry carries no
// image data: the page sends `keepImage:true` for images already stored.
let scoreDb;
function openScoreDb() {
  if (!scoreDb) scoreDb = new Promise((resolve,reject) => {
    const request=indexedDB.open('barline-scores',1);
    request.onupgradeneeded=()=>request.result.createObjectStore('scores');
    request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);
  });
  return scoreDb;
}
const imagePrefix=key=>'img:'+key+':';
const imageRange=key=>IDBKeyRange.bound(imagePrefix(key),imagePrefix(key)+'￿');
function done(tx,resolve,reject,result){
  tx.oncomplete=()=>resolve(result());tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error||new Error('保存被中断'));
}
async function getScore(key){
  const db=await openScoreDb();
  return new Promise((resolve,reject)=>{
    const tx=db.transaction('scores','readonly'),store=tx.objectStore('scores');let value=null;
    const req=store.get(key);
    req.onsuccess=()=>{
      value=req.result??null;
      if(!value?.imagesSeparate||!Array.isArray(value.frames))return;
      value.frames.forEach((frame,i)=>{const r=store.get(imagePrefix(key)+frame.id);r.onsuccess=()=>{value.frames[i]={...frame,image:r.result??''}}});
    };
    done(tx,resolve,reject,()=>{if(value?.imagesSeparate){value={...value,frames:value.frames.filter(f=>f.image)};delete value.imagesSeparate}return value});
  });
}
async function putScore(key,value){
  const ids=value.frames.map(f=>f.id);
  if(ids.some(id=>typeof id!=='string'||!/^[\w-]{1,64}$/.test(id))||new Set(ids).size!==ids.length)throw new Error('谱面编号无效');
  const db=await openScoreDb();
  return new Promise((resolve,reject)=>{
    const tx=db.transaction('scores','readwrite'),store=tx.objectStore('scores'),prefix=imagePrefix(key);
    const wanted=new Set(ids),kept=value.frames.filter(f=>f.keepImage).map(f=>f.id),found=new Set();
    for(const f of value.frames)if(typeof f.image==='string'&&!f.keepImage)store.put(f.image,prefix+f.id);
    const cursor=store.openKeyCursor(imageRange(key));
    cursor.onsuccess=()=>{
      const c=cursor.result;
      if(c){const id=String(c.key).slice(prefix.length);if(wanted.has(id))found.add(id);else store.delete(c.key);c.continue();return;}
      const missing=kept.filter(id=>!found.has(id));
      if(missing.length){tx.abort();return;}
      store.put({...value,imagesSeparate:true,frames:value.frames.map(({image,keepImage,...rest})=>rest)},key);
    };
    tx.oncomplete=()=>resolve(null);tx.onerror=()=>reject(tx.error);
    tx.onabort=()=>reject(tx.error||new Error('missing-images'));
  });
}
async function deleteScore(key){
  const db=await openScoreDb();
  return new Promise((resolve,reject)=>{
    const tx=db.transaction('scores','readwrite'),store=tx.objectStore('scores');
    store.delete(key);store.delete(imageRange(key));done(tx,resolve,reject,()=>null);
  });
}
async function listPractice(){
  const db=await openScoreDb();
  return new Promise((resolve,reject)=>{
    const out=[],tx=db.transaction('scores','readonly'),request=tx.objectStore('scores').openCursor(IDBKeyRange.bound('practice:','practice:￿'));
    request.onsuccess=()=>{const cursor=request.result;if(!cursor)return;const {frames,config,...meta}=cursor.value;out.push(meta);cursor.continue()};
    done(tx,resolve,reject,()=>out.sort((a,b)=>b.createdAt-a.createdAt));
  });
}
chrome.runtime.onMessage.addListener((message,sender,reply)=>{
  if(sender.id!==chrome.runtime.id||!/^barline-score-(get|put|delete|print|list)$/.test(message?.type||''))return;
  if(typeof message.key!=='string'||message.key.length>180){reply({ok:false,error:'无效的视频编号'});return;}
  const action=message.type.slice('barline-score-'.length);
  if(action==='print'){
    chrome.tabs.create({url:chrome.runtime.getURL('score-print.html')+'?key='+encodeURIComponent(message.key)}).then(()=>reply({ok:true})).catch(e=>reply({ok:false,error:e.message}));return true;
  }
  if(action==='put'&&(!message.value||!Array.isArray(message.value.frames)||message.value.frames.length>160)){
    reply({ok:false,error:'谱面数据无效或超过160张限制'});return;
  }
  const work=action==='list'?listPractice():action==='get'?getScore(message.key):action==='put'?putScore(message.key,message.value):deleteScore(message.key);
  work.then(value=>reply({ok:true,value})).catch(e=>reply({ok:false,error:e?.message||String(e)}));return true;
});
