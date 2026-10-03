import {test} from 'node:test'
import assert from 'node:assert/strict'
import {inkMask} from '../src/score-segment.ts'
import {ScrollTracker,estimateShift,detectSystems,detectCursorBox} from '../src/score-scroll.ts'

// 一张长谱：每 60px 一行（系统），每行一个五线谱和不同位置的音符。
const W=240,PAGE=600,VIEW=150,GAP=60
function page(){
  const p=new Uint8ClampedArray(W*PAGE*4).fill(250)
  const put=(x:number,y:number,v=20)=>{if(y<0||y>=PAGE)return;const i=(y*W+x)*4;p[i]=p[i+1]=p[i+2]=v}
  for(let s=0;s*GAP+40<PAGE;s++){
    const top=s*GAP+22
    for(let l=0;l<5;l++)for(let x=6;x<W-6;x++)put(x,top+l*4,60)
    for(let n=0;n<14;n++){const x=12+n*16+(s*7+n*5)%9,y=top-4+((s*3+n*7)%6)*4;for(let dx=0;dx<5;dx++)for(let dy=0;dy<4;dy++)put(x+dx,y+dy)}
  }
  return p
}
const PAGE_PIXELS=page()
/** 视窗从整页 offset 处开始；光标框画在第 system 行的 x 处。 */
function frame(offset:number,cursor:{system:number;x:number}|null){
  const f=PAGE_PIXELS.slice(offset*W*4,(offset+VIEW)*W*4)
  if(cursor){
    const cx=Math.round(cursor.x*(W-1)),top=cursor.system*GAP+14-offset
    for(let y=Math.max(0,top);y<Math.min(VIEW,top+34);y++)for(let x=cx-3;x<=cx+3;x++){const i=(y*W+x)*4;if(f[i]>200){f[i]=200;f[i+1]=220;f[i+2]=245}}
  }
  return f
}

test('竖直位移估计：内容上移为正，等间距谱行不混淆',()=>{
  const a=inkMask(frame(0,null),W,VIEW),b=inkMask(frame(36,null),W,VIEW)
  const s=estimateShift(a,b)!
  assert.equal(s.dy,36);assert.ok(s.error<.1)
  assert.equal(estimateShift(b,a)!.dy,-36)
})

test('按谱线切行，只有完整可见的行标记为 full',()=>{
  const bands=detectSystems(frame(36,null),W,VIEW)
  // 视窗 36–186：第 1、2 行完整（谱表在画面 46–62、106–122），第 0 行谱表被切。
  const full=bands.filter(b=>b.full)
  assert.equal(full.length,2)
  assert.ok(full[0].top*VIEW<46&&full[0].bottom*VIEW>62)
})

test('浅色光标框只覆盖一行也能检测到，并给出纵向位置',()=>{
  const box=detectCursorBox(frame(0,{system:1,x:.5}),W,VIEW)!
  assert.ok(Math.abs(box.x-.5)<.03)
  assert.ok(Math.abs(box.y*(VIEW-1)-(GAP+14+17))<4)
  assert.equal(detectCursorBox(frame(0,null),W,VIEW),null)
})

test('不规则滚动：按光标经过的行切分，滚动不产生新行，反复记号回到上面的行再出现一次',()=>{
  let now=0,offset=0
  const tracker=new ScrollTracker(()=>({bands:detectSystems(frame(offset,null),W,VIEW),crop:b=>Math.round(offset+b.top*VIEW)}))
  // 光标路径：第 0 行 → 第 1 行（中途滚动 20px）→ 第 2 行（中途滚动 36px）→ 反复回到第 1 行
  // → 第 3 行（换行的同时滚动 50px）
  const script:[number,number,number][]=[[2,0,0],[1,1,0],[1,1,20],[2,2,20],[.5,2,56],[2,1,56],[2,3,106]]  // [时长, 光标所在行, 画面 offset]
  let n=0,last=-1
  for(const [dur,system,off] of script){
    offset=off
    if(system!==last)n=0
    last=system
    for(let k=0;k<Math.round(dur*15);k++,n++){
      const rgba=frame(offset,{system,x:Math.min(.95,.05+n*.03)})
      tracker.push({time:now,mask:inkMask(rgba,W,VIEW),box:detectCursorBox(rgba,W,VIEW)})
      now=Math.round(now*15+1)/15
    }
  }
  assert.ok(tracker.scrolling)
  assert.equal(tracker.scrolls,3)
  const rows=tracker.rows()
  // 每行的截图是同一张整页上的位置：0 行、1 行、2 行、1 行（反复）、3 行
  const centers=rows.map(r=>Math.round((r.shot as number)/GAP))
  assert.deepEqual(centers,[0,1,2,1,3])
  assert.ok(rows.every(r=>r.cursor.length>=10))
  // 换行时间就是光标进入新行的时刻（误差不超过两帧）。
  const expected=[0,2,4,6.5,8.5]
  rows.forEach((r,i)=>assert.ok(Math.abs(r.time-expected[i])<=2/15+1e-9,`row ${i} ${r.time}`))
})

test('翻页但不滚动的普通谱面不会进入滚动模式',()=>{
  let offset=0
  const tracker=new ScrollTracker(()=>({bands:detectSystems(frame(offset,null),W,VIEW),crop:()=>offset}))
  const other=new Uint8ClampedArray(frame(0,null).length).fill(250)
  for(let t=0;t<60;t++){
    const rgba=t<30?frame(0,null):other.map((v,i)=>i%4===3?255:PAGE_PIXELS[(i+W*4*300)%PAGE_PIXELS.length])
    tracker.push({time:t/15,mask:inkMask(rgba,W,VIEW),box:null})
  }
  assert.equal(tracker.scrolling,false)
})
