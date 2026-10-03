import {test} from 'node:test'
import assert from 'node:assert/strict'
import {normalizeConfig,segmentBeatDuration,buildTimeline,barStartTime,locateBar,beatNumberAt,nextBeatAt,parseTime,firstBeatForDownbeatAt} from '../src/config.ts'
test('拍号分母参与拍长计算',()=>{
  assert.equal(segmentBeatDuration({bpm:120,numerator:6,denominator:8}),.25)
})
test('变速变拍号边界与小节跳转一致',()=>{
  const cfg=normalizeConfig({segments:[{bpm:120,numerator:4,denominator:4,firstBeatTime:1},{bpm:60,numerator:3,denominator:4,startBar:3}]})
  assert.deepEqual(buildTimeline(cfg).map(s=>s.startTime),[1,5])
  assert.equal(barStartTime(cfg,4),8)
  assert.deepEqual(locateBar(cfg,5),{bar:3,startTime:5})
  assert.equal(beatNumberAt(cfg,6),2)
  assert.equal(locateBar(cfg,.9),null)
  assert.equal(nextBeatAt(cfg,4.5)?.isBar,true)
  assert.equal(nextBeatAt(cfg,5)?.time,6)
})
test('重拍对齐此处：最小平移小节网格',()=>{
  const one=normalizeConfig({segments:[{bpm:120,numerator:4,denominator:4,firstBeatTime:1}]})
  assert.equal(firstBeatForDownbeatAt(one,1.5),1.5)
  assert.ok(Math.abs(firstBeatForDownbeatAt(one,2.6)-.6)<1e-9)
  assert.equal(firstBeatForDownbeatAt(one,.4),.4)
  const edge=normalizeConfig({segments:[{bpm:120,numerator:4,denominator:4,firstBeatTime:.3}]})
  assert.ok(Math.abs(firstBeatForDownbeatAt(edge,2))<1e-9)
  const multi=normalizeConfig({segments:[{bpm:120,numerator:4,denominator:4,firstBeatTime:1},{bpm:60,numerator:3,denominator:4,startBar:3}]})
  const first=firstBeatForDownbeatAt(multi,6.5)
  assert.equal(first,2.5)
  assert.equal(buildTimeline(normalizeConfig({...multi,segments:[{...multi.segments[0],firstBeatTime:first},multi.segments[1]]}))[1].startTime,6.5)
})
test('时间解析拒绝错误值',()=>{
  assert.equal(parseTime('1:02.250'),62.25)
  assert.equal(parseTime('0.5'),.5)
  assert.ok(Number.isNaN(parseTime('1:60')))
  assert.ok(Number.isNaN(parseTime('abc')))
})
test('导入无穷值与重复段落不会破坏时间线',()=>{
  const cfg=normalizeConfig({metronomeVolume:'bad',segments:[{firstBeatTime:Infinity},{startBar:2,bpm:60},{startBar:2,bpm:90}]})
  assert.equal(cfg.metronomeVolume,0)
  assert.equal(cfg.segments.length,2)
  assert.equal(cfg.segments[1].bpm,90)
  assert.ok(buildTimeline(cfg).every(s=>Number.isFinite(s.startTime)))
})
