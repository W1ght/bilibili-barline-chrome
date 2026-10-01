import {test} from 'node:test'
import assert from 'node:assert/strict'
import {analyzeTempo,detectBarLines,alignEstimatedRows} from '../src/score-analysis.ts'
import {validateChapters,chapterAt} from '../src/score-chapters.ts'
import {excerptFrames,PracticePlayback} from '../src/practice-model.ts'
import {normalizeConfig} from '../src/config.ts'
import {scorePosition} from '../src/score-model.ts'

function pulses(bpm:number,duration=24){const p=60/bpm;return Array.from({length:duration*50},(_,i)=>{const time=i/50;const distance=Math.abs(time/p-Math.round(time/p))*p;return {time,strength:Math.exp(-distance*distance/.0002)}})}
test('音频节拍与可视小节共同确定100 BPM，避免半速误判',()=>{
  const r=analyzeTempo(pulses(100),0,24,[0,2.4,4.8,7.2,9.6,12,14.4,16.8,19.2,21.6])
  assert.ok(Math.abs(r.bpm-100)<1,JSON.stringify(r));assert.ok(r.confidence>.65);assert.ok(r.bars.length>=3)
})
test('静音及短片段不能伪造BPM',()=>{
  assert.throws(()=>analyzeTempo([{time:0,strength:0}],0,20));assert.throws(()=>analyzeTempo(pulses(120),0,3))
})
test('6/8以四分音符BPM计速，视觉每小节3个四分音符',()=>{
 const r=analyzeTempo(pulses(120),0,24,Array.from({length:16},(_,i)=>i*1.5),6,8)
 assert.ok(Math.abs(r.bpm-120)<1,JSON.stringify(r));assert.equal(r.denominator,8)
})
test('谱面小节线检测排除未跨越全部六根弦的符干',()=>{
 const w=200,h=100,p=new Uint8ClampedArray(w*h*4).fill(255),dark=(x:number,y:number)=>{const i=(y*w+x)*4;p[i]=p[i+1]=p[i+2]=30}
 for(const y of [30,38,46,54,62,70])for(let x=0;x<w;x++)dark(x,y)
 for(const x of [10,80,180])for(let y=30;y<=70;y++)dark(x,y)
 for(let y=35;y<=60;y++)dark(120,y)
 assert.equal(detectBarLines(p,w,h).length,3)
})
test('音频估算不会覆盖手动或光标时间轴',()=>{
 const r=analyzeTempo(pulses(100),0,24)
 const f={id:'x',time:0,width:10,height:10,image:'',anchors:[{time:0,x:.2,manual:true},{time:20,x:.8,manual:true}]};alignEstimatedRows([f],r);assert.equal(f.anchors[0].x,.2)
})
test('段落精确边界、颜色和重复时间校验',()=>{
 const c=validateChapters([{id:'a',time:1,name:'前奏',color:'#64748b'},{id:'b',time:5,name:'A1',color:'#0284c7'}])
 assert.equal(chapterAt(c,0),null);assert.equal(chapterAt(c,5)?.name,'A1');assert.throws(()=>validateChapters([...c,{...c[0],id:'c'}]));assert.throws(()=>validateChapters([{...c[0],color:'red'}]))
})
test('摘录保留原时间、图像和定位点，不按片段重新拉伸谱轴',()=>{
 const frames=[{id:'a',time:0,image:'original',width:10,height:10,anchors:[{time:2,x:.2},{time:8,x:.8}]},{id:'b',time:10,image:'next',width:10,height:10,anchors:[]}]
 const result=excerptFrames(frames,4,12,20);assert.equal(result.length,2);assert.equal(result[0].time,0);assert.equal(result[0].end,10);assert.equal(result[1].end,20);assert.deepEqual(result[0].anchors,frames[0].anchors);assert.equal(result[0].image,'original');assert.throws(()=>excerptFrames(frames,12,4,20))
})
test('摘录谱行无校准点时也沿用原始行终点，不能拉伸最后一行',()=>{
 const row={id:'a',time:10,end:30,image:'',width:10,height:10,anchors:[]};const clip=excerptFrames([row],14,18,40)[0]
 assert.equal(scorePosition(clip,clip.end!,16),scorePosition(row,row.end,16))
})
test('练习播放保持原音量与静音，结束恢复速度并暂停在原片段终点',async()=>{
 const old=(globalThis as any).window;(globalThis as any).window=globalThis
 let callback=()=>{},restored=0
 const v={currentTime:0,playbackRate:.75,volume:.37,muted:true,paused:true,ended:false,pause(){this.paused=true},async play(){this.paused=false},requestVideoFrameCallback(cb:()=>void){callback=cb;return 1},cancelVideoFrameCallback(){}}
 const p=new PracticePlayback(v as any,()=>{})
 try{await p.play(4,7,false,()=>()=>{restored++});assert.equal(v.currentTime,4);assert.equal(v.playbackRate,1);assert.equal(v.volume,.37);assert.equal(v.muted,true);v.currentTime=7.01;callback();assert.equal(v.currentTime,7);assert.equal(v.paused,true);assert.equal(v.playbackRate,.75);assert.equal(restored,1);assert.equal(v.volume,.37)}finally{p.stop();(globalThis as any).window=old}
})
test('小节校准证据持久化且修改BPM后失效',()=>{
 const input={segments:[{bpm:100,numerator:4,denominator:4,firstBeatTime:2}],tempoSource:'manual-bars',manualCalibration:{time:2,bpm:100,numerator:4,denominator:4}}
 assert.equal(normalizeConfig(input).tempoSource,'manual-bars');input.segments[0].bpm=120;assert.equal(normalizeConfig(input).tempoSource,undefined)
})
import {OnsetDetector} from '../src/score-audio.ts'
test('按音频采样检测起音，时间精确到毫秒级并得出正确BPM',()=>{
  const sr=48000,seconds=20,d=new OnsetDetector(sr),beat=60/128
  let seed=7;const noise=()=>((seed=(seed*16807)%2147483647)/2147483647-.5)*.01
  for(let block=0;block*2048<sr*seconds;block++){
    const out=new Float32Array(2048)
    for(let i=0;i<2048;i++){const t=(block*2048+i)/sr,since=t%beat;out[i]=noise()+(since<.03?Math.sin(2*Math.PI*2000*t)*Math.exp(-since*120):0)}
    d.push(out,3+block*2048/sr)
  }
  const strongest=[...d.onsets].sort((a,b)=>b.strength-a.strength).slice(0,30).map(o=>o.time-3)
  assert.ok(strongest.every(t=>{const e=t%beat;return Math.min(e,beat-e)<.008}),'onsets land on the clicks within 8 ms')
  const r=analyzeTempo(d.onsets,3,3+seconds)
  assert.ok(Math.abs(r.bpm-128)<1,String(r.bpm))
})
