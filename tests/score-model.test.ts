import {test} from 'node:test'
import assert from 'node:assert/strict'
import {activeScore,scorePosition,timeAtPosition,addAnchor,validCrop,detectScoreCursor,neutralizeScoreColors} from '../src/score-model.ts'
const row=(time:number)=>({id:String(time),time,image:'',width:100,height:20,anchors:[] as any[]})
test('谱面按时间切换，倒放和精确边界一致',()=>{
  const frames=[row(2),row(5),row(10)]
  assert.equal(activeScore(frames,1),-1);assert.equal(activeScore(frames,5),1);assert.equal(activeScore(frames,4),0);assert.equal(activeScore(frames,99),2)
})
test('手动定位线校准采用分段插值，并可反向点击定位',()=>{
  const f=row(2);f.anchors=addAnchor(f,{time:3,x:.1,manual:true});f.anchors=addAnchor(f,{time:5,x:.8,manual:true})
  assert.ok(Math.abs(scorePosition(f,6,4)-.45)<1e-9)
  assert.ok(Math.abs(timeAtPosition(f,6,.45)-4)<1e-9)
  assert.throws(()=>addAnchor(f,{time:6,x:.5,manual:true}))
  assert.equal(scorePosition(row(2),6,4),.5)
})
test('框选范围及窄播放线识别',()=>{
  assert.equal(validCrop({left:0,top:0,right:1,bottom:.4}),true)
  assert.equal(validCrop({left:.5,top:0,right:.4,bottom:1}),false)
  const data=new Uint8ClampedArray(100*20*4).fill(255)
  for(let y=0;y<20;y++){const p=(y*100+30)*4;data[p]=0;data[p+1]=180;data[p+2]=220}
  assert.equal(detectScoreCursor(data,100,20),30/99)
})
test('清理彩色背景保留浅灰谱线和黑色音符',()=>{
  const pixels=new Uint8ClampedArray([180,180,180,255,20,20,20,255,0,180,220,255])
  assert.deepEqual(Array.from(neutralizeScoreColors(pixels)),[180,180,180,255,20,20,20,255,255,255,255,255])
})
