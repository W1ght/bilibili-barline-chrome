import {test} from 'node:test'
import assert from 'node:assert/strict'
import {bpmFromMarkers} from '../src/beat-markers.ts'
import {nextBeatAt,segmentBarDuration} from '../src/config.ts'
test('4/4 按完整小节计算，10到12.4秒得到100BPM',()=>{
  const bpm=bpmFromMarkers(10,12.4,4,4)
  assert.equal(bpm,100)
  const segment={bpm,numerator:4,denominator:4,firstBeatTime:10}
  const cfg={segments:[segment],metronomeMuted:false,metronomeVolume:1}
  assert.ok(Math.abs(nextBeatAt(cfg,10)!.time-10.6)<1e-9)
  assert.ok(Math.abs(segmentBarDuration(segment)-2.4)<1e-9)
})
test('3/4 和6/8的小节长度按分子分母计算',()=>{
  assert.equal(bpmFromMarkers(0,1.8,4,3),100)
  assert.equal(bpmFromMarkers(3,4.5,8,6),120)
})
test('非法时间、拍号或过快过慢标记不覆盖配置',()=>{
  for(const [a,b] of [[1,1],[2,1],[NaN,2],[-1,0],[1,Infinity],[1,1.01],[1,10]]) assert.throws(()=>bpmFromMarkers(a,b,4,4))
  assert.throws(()=>bpmFromMarkers(0,2,4,0))
  assert.throws(()=>bpmFromMarkers(0,2,3,4))
})
import {fitBarMarks} from '../src/beat-markers.ts'
test('多个小节标记取平均，手点误差被抵消，漏点的小节自动补上',()=>{
  const jitter=[.03,-.02,.025,-.03,.01,-.015]
  const times=[0,1,2,3,5,6].map((bar,i)=>10+bar*2.4+jitter[i])
  const fit=fitBarMarks(times,4,4)
  assert.ok(Math.abs(fit.bpm-100)<1,String(fit.bpm))
  assert.equal(fit.bars,6)
  assert.ok(Math.abs(fit.firstBeatTime-10)<.03)
  assert.ok(fit.maxError<.05)
  assert.equal(fitBarMarks([10,12.4],4,4).bpm,100)
  assert.throws(()=>fitBarMarks([10,10.01,12],4,4))
  assert.throws(()=>fitBarMarks([10],4,4))
})
