import {test} from 'node:test'
import assert from 'node:assert/strict'
import {inkMask,compareInk,ScoreSegmenter,fitCursorAnchors,mergeScanned,defaultSegmentOptions} from '../src/score-segment.ts'

const W=200,H=40
type Note={x:number;y:number;color?:[number,number,number]}
function picture(notes:Note[],{cursor=null as number|null,staff=true,fill=255}={}){
  const p=new Uint8ClampedArray(W*H*4).fill(fill)
  const put=(x:number,y:number,c:[number,number,number])=>{const i=(y*W+x)*4;p[i]=c[0];p[i+1]=c[1];p[i+2]=c[2]}
  if(staff)for(const y of [10,15,20,25,30])for(let x=0;x<W;x++)put(x,y,[60,60,60])
  for(const n of notes)for(let dx=0;dx<5;dx++)for(let dy=0;dy<4;dy++)put(n.x+dx,n.y+dy,n.color??[20,20,20])
  if(cursor!==null)for(let y=0;y<H;y++){put(Math.round(cursor*(W-1)),y,[0,170,230]);put(Math.round(cursor*(W-1))+1,y,[0,170,230])}
  return p
}
const row=(seed:number)=>Array.from({length:14},(_,i)=>({x:8+i*13+(seed*5+i*3)%7,y:[11,16,21,26][(i*seed+i)%4]}))
const A=row(1),B=row(2)
const sample=(time:number,notes:Note[],cursor:number|null=null,opts={})=>({time,cursor,mask:inkMask(picture(notes,{cursor,...opts}),W,H,cursor)})

function run(samples:ReturnType<typeof sample>[]){
  let shots=0
  const seg=new ScoreSegmenter(()=>++shots)
  const events=samples.map(s=>seg.push(s))
  return {seg,events,shots:()=>shots}
}

test('墨迹掩码去掉谱线与光标列，深色彩色音符仍算墨迹，浅色高亮不算',()=>{
  const plain=inkMask(picture([]),W,H)
  assert.equal(plain.count,0,'staff lines removed')
  const red=inkMask(picture([{x:50,y:11,color:[210,30,30]}]),W,H)
  assert.equal(red.count,20)
  const tint=inkMask(picture([{x:50,y:12,color:[255,240,150]}]),W,H)
  assert.equal(tint.count,0)
  const withCursor=inkMask(picture([],{cursor:.5}),W,H,.5)
  assert.equal(withCursor.count,0)
  const darkTheme=inkMask(picture([{x:50,y:12,color:[240,240,240]}],{staff:false,fill:15}),W,H)
  assert.equal(darkTheme.count,20)
})

test('换行经过淡入淡出只保留两行，起点取开始变化的时刻，过渡帧不截图',()=>{
  const samples=[]
  for(let t=0;t<5;t+=.1)samples.push(sample(t,A))
  for(let t=5;t<5.3;t+=.1)samples.push(sample(t,[...A.slice(0,5),...B.slice(5)]))
  for(let t=5.3;t<10;t+=.1)samples.push(sample(t,B))
  const {seg,shots}=run(samples)
  const rows=seg.finish()
  assert.equal(rows.length,2)
  assert.equal(shots(),2)
  assert.ok(Math.abs(rows[1].time-5)<.06,String(rows[1].time))
  assert.ok(Math.abs(rows[0].end!-5)<.06)
})

test('单帧闪烁与已演奏音符变色都不会产生新行',()=>{
  const samples=[]
  for(let t=0;t<3;t+=.1)samples.push(sample(t,t>1&&t<1.15?B:A))
  for(let t=3;t<6;t+=.1)samples.push(sample(t,A.map((n,i)=>i<(t-3)*4?{...n,color:[220,40,40] as [number,number,number]}:n)))
  const {seg,shots}=run(samples)
  assert.equal(seg.finish().length,1);assert.equal(shots(),1)
})

test('逐个显现的音符视为同一行并更新为更完整的截图',()=>{
  const samples=[]
  for(let t=0;t<6;t+=.1)samples.push(sample(t,A.slice(0,2+Math.floor(t*2))))
  const {seg,events}=run(samples)
  assert.equal(seg.finish().length,1)
  assert.ok(events.filter(e=>e==='grow').length>=2)
})

test('非谱面画面结束一行；短暂中断后同一行继续',()=>{
  const blank=(t:number)=>({time:t,cursor:null,mask:inkMask(picture([],{staff:false}),W,H)})
  const samples=[]
  for(let t=0;t<3;t+=.1)samples.push(sample(t,A))
  for(let t=3;t<4;t+=.1)samples.push(blank(t))
  for(let t=4;t<6;t+=.1)samples.push(sample(t,A))
  for(let t=6;t<20;t+=.1)samples.push(blank(t))
  for(let t=20;t<22;t+=.1)samples.push(sample(t,A))
  const rows=run(samples).seg.finish()
  assert.equal(rows.length,2,'interruption <3s reopens, long gap starts a new row')
  assert.ok(Math.abs(rows[0].end!-6)<.06)
  assert.ok(Math.abs(rows[1].time-20)<.06)
})

test('同一谱面上光标回到左侧（反复记号）拆为两行并共用截图',()=>{
  const samples=[]
  for(let t=0;t<8;t+=.1){const x=t<4?.05+t/4*.9:.05+(t-4)/4*.9;samples.push(sample(t,A,x))}
  const {seg,shots}=run(samples),rows=seg.finish()
  assert.equal(rows.length,2);assert.equal(shots(),1);assert.equal(rows[0].shot,rows[1].shot)
  assert.ok(Math.abs(rows[1].time-4)<.15)
  const anchors=fitCursorAnchors(rows[0].cursor)
  assert.ok(anchors.length>=5);assert.ok(anchors.every((a,i)=>i===0||a.x>anchors[i-1].x))
})

test('已有谱行作为种子时，从中间续抄不会重复这一行',()=>{
  const seg=new ScoreSegmenter(()=>1);seg.seed(sample(0,A).mask)
  for(let t=0;t<2;t+=.1)seg.push(sample(t,A))
  for(let t=2;t<4;t+=.1)seg.push(sample(t,B))
  const rows=seg.finish();assert.equal(rows.length,1);assert.ok(Math.abs(rows[0].time-2)<.06)
})

test('光标拟合剔除离群点并保证从左到右',()=>{
  const pts=Array.from({length:40},(_,i)=>({time:i*.1,x:.1+i*.02+(i%3-1)*.004}))
  pts[7].x=.95;pts[20].x=.02
  const a=fitCursorAnchors(pts)
  assert.ok(a.length>=10)
  assert.ok(a.every((p,i)=>i===0||(p.x>a[i-1].x&&p.time>a[i-1].time)))
  assert.ok(a.every(p=>p.x<.9))
  assert.deepEqual(fitCursorAnchors(pts.slice(0,3)),[])
  assert.deepEqual(fitCursorAnchors(pts.map(p=>({...p,x:.5}))),[],'stationary colour is not a cursor')
})

test('只替换重抄范围，范围外谱行保留并裁掉重叠终点',()=>{
  const f=(time:number,end?:number)=>({id:String(time),time,...(end!==undefined?{end}:{}),image:'',width:1,height:1,anchors:[]})
  const out=mergeScanned([f(0,12),f(10),f(20),f(30)],[f(11),f(15)],10,25)
  assert.deepEqual(out.map(r=>r.time),[0,11,15,30])
  assert.equal(out[0].end,11)
})

test('比较对1像素抖动容忍',()=>{
  const a=inkMask(picture(A),W,H),b=inkMask(picture(A.map(n=>({...n,x:n.x+1}))),W,H)
  const d=compareInk(a,b);assert.ok(d.removed<.05&&d.added<.05,JSON.stringify(d))
  assert.ok(compareInk(a,inkMask(picture(B),W,H)).removed>defaultSegmentOptions.threshold)
})
