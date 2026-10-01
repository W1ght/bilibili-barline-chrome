import {test} from 'node:test'
import assert from 'node:assert/strict'
import {autoAlignBars,applyBarAlignment,barBoundaries,barGridSegments} from '../src/bar-align.ts'
import {scorePosition} from '../src/score-model.ts'
import {buildTimeline,barStartTime} from '../src/config.ts'

// 4 bars per row, 2.4 s per bar (100 BPM 4/4); bar widths deliberately unequal.
const lines=[.02,.20,.55,.70,.98]
const row=(i:number,extra:any={})=>({id:'r'+i,time:i*9.6,image:'',width:1,height:1,anchors:[] as any[],barLines:lines,...extra})

test('按小节等时分配：宽窄不同的小节也按时间对齐',()=>{
  const frames=[0,1,2,3].map(i=>row(i))
  const r=autoAlignBars(frames,60)
  assert.equal(r.aligned,4);assert.ok(Math.abs(r.barDuration!-2.4)<1e-9)
  applyBarAlignment(frames,r)
  // Halfway through bar 2 of row 1 (time 9.6+2.4+1.2) sits halfway between x .20 and .55.
  assert.ok(Math.abs(scorePosition(frames[1],19.2,13.2)-.375)<1e-9)
  assert.ok(frames.every(f=>f.anchors.every(a=>a.source==='bar-estimate')))
  assert.equal(r.bars.length,16)
})

test('标准记谱开头没有小节线时补上第一小节',()=>{
  assert.deepEqual(barBoundaries([.3,.6,.9,.98])?.length,5)
  assert.equal(barBoundaries([.5]),null)
})

test('时长约为两倍的行（反复）和小节数不符的行保持原样并说明原因',()=>{
  const frames=[row(0),row(1),{...row(2),barLines:[.02,.4,.7,.98]},row(3),row(4)]
  frames[3].time=28.8;frames[4].time=48 // row 3 lasts 19.2 s: played twice
  const r=autoAlignBars(frames,70)
  assert.match(r.rows[2].reason!,/偏长/)
  assert.match(r.rows[3].reason!,/两倍/)
  assert.equal(r.rows[0].anchors!.length,5)
})

test('一行有光标或手动校准时，测出“提前显示”的时间并修正全部估算行',()=>{
  // Video shows each row 1.2 s (half a bar) before it is played.
  const frames=[0,1,2,3].map(i=>row(i))
  frames[2].anchors=[{time:19.2+1.2+2.4,x:.20,manual:true},{time:19.2+1.2+4.8,x:.55,manual:true}]
  const r=autoAlignBars(frames,60)
  assert.ok(r.leadMeasured);assert.ok(Math.abs(r.lead-1.2)<1e-9)
  assert.equal(r.rows[2].anchors,null,'calibrated row is left alone')
  assert.ok(Math.abs(r.rows[0].anchors![1].time-(1.2+2.4))<1e-9)
})

test('光标行不被覆盖',()=>{
  const frames=[row(0,{anchors:[{time:.5,x:.1},{time:9,x:.9}]}),row(1)]
  const r=autoAlignBars(frames,30);applyBarAlignment(frames,r)
  assert.deepEqual(frames[0].anchors.map(a=>a.x),[.1,.9])
})

test('小节网格转节拍器分段：变速处分段，空档自动补齐小节编号',()=>{
  const bars=[...Array.from({length:8},(_,i)=>10+i*2.4),...Array.from({length:8},(_,i)=>10+8*2.4+i*2)]
  const withGap=[...bars.slice(0,8),...bars.slice(10)] // two bars missing from the grid
  const segments=barGridSegments(withGap,4,4)
  assert.ok(segments.length>=2&&segments.length<=3,'tempo change splits; the mixed-tempo gap may get its own segment')
  assert.ok(Math.abs(segments[0].bpm-100)<.01);assert.ok(Math.abs(segments[segments.length-1].bpm-120)<.01)
  const cfg={segments,metronomeMuted:true,metronomeVolume:1} as any
  assert.equal(buildTimeline(cfg).length,segments.length)
  assert.ok(Math.abs(barStartTime(cfg,16)!-bars[15])<1e-3,'bar numbers stay continuous across the gap')
  assert.throws(()=>barGridSegments([1,2],4,4))
})
