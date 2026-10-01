import {test} from 'node:test'
import assert from 'node:assert/strict'
import {Metronome,beatsInWindow} from '../src/metronome.ts'
import {LoopController,loopRate} from '../src/loop.ts'

;(globalThis as any).window ??= globalThis
const cfg={segments:[{bpm:120,numerator:4,denominator:4,firstBeatTime:0}],metronomeMuted:false,metronomeVolume:1}

function fakeAudio(){
  const starts:number[]=[],stopped:number[]=[]
  const param={setValueAtTime(){},exponentialRampToValueAtTime(){}}
  const ctx:any={state:'running',currentTime:100,destination:{},
    createOscillator(){let at=0;return {type:'',frequency:param,connect(){},start(t:number){at=t;starts.push(t)},stop(t?:number){if(t===undefined)stopped.push(at)}}},
    createGain(){return {gain:param,connect(){}}},resume:async()=>{},close:async()=>{}}
  return {ctx,starts,stopped}
}
function fakeVideo(time:number,rate=1){
  return {currentTime:time,playbackRate:rate,paused:false,ended:false,addEventListener(){},removeEventListener(){},
    pause(){this.paused=true},async play(){this.paused=false}} as any
}

test('拍点窗口包含右端、不含左端，跨小节标出重拍',()=>{
  const beats=beatsInWindow(cfg,1.9,4)
  assert.deepEqual(beats.map(b=>b.time),[2,2.5,3,3.5,4])
  assert.deepEqual(beats.map(b=>b.isBar),[true,false,false,false,true])
})

test('节拍器提前按音频时钟排程，慢速播放按速度换算，不重复、不补发',()=>{
  const {ctx,starts,stopped}=fakeAudio(),video=fakeVideo(10,.5)
  const m=new Metronome(()=>ctx)
  try{
    m.setVideo(video);m.setConfig(cfg as any);m.setVolume(1);m.setMuted(false)
    m.pump();m.pump()
    assert.deepEqual(starts,[100],'beat at 10s plays now, once')
    video.currentTime=10.45;m.pump();m.pump()
    assert.equal(starts.length,2)
    assert.ok(Math.abs(starts[1]-100.1)<1e-9,'0.05s of video at 0.5x = 0.1s of audio')
    video.currentTime=30;m.pump()
    assert.equal(starts.length,3,'a jump does not flush a burst of missed clicks');assert.equal(starts[2],100)
    video.currentTime=30.49;m.pump();video.paused=true;m.pump()
    assert.ok(stopped.length>=1,'pause cancels clicks that have not sounded yet')
  }finally{m.dispose()}
})

test('循环每遍加速到目标速度为止',()=>{
  assert.equal(loopRate(.8,{step:.1,target:1},0),.8)
  assert.equal(loopRate(.8,{step:.1,target:1},1),.88)
  assert.equal(loopRate(.8,{step:.1,target:1},5),1)
  assert.equal(loopRate(1,{step:0,target:2},3),1)
})

test('循环包含起止所在小节，到终点按预备拍回到起点并加速，关闭后恢复原速度',()=>{
  const video=fakeVideo(10.3,.8);video.paused=true
  const messages:string[]=[];let countIns=0
  const loop=new LoopController({video:()=>video,config:()=>cfg as any,countIn:(_s,done)=>{countIns++;done()},cancelCountIn(){},
    countInDisabled:()=>false,speed:()=>({step:.1,target:1}),resync(){},notify:m=>messages.push(m),changed(){}})
  loop.toggle();assert.equal(loop.state,'pending');assert.equal(loop.startBar,6)
  video.currentTime=13.1;loop.toggle()
  assert.equal(loop.state,'looping');assert.equal(loop.start,10);assert.equal(loop.end,14);assert.match(messages[1],/6–7/)
  assert.equal(video.currentTime,10)
  video.paused=false;video.currentTime=13.999;(loop as any).check()
  assert.equal(video.currentTime,10);assert.equal(video.playbackRate,.88);assert.equal(countIns,1);assert.equal(video.paused,false)
  loop.toggle();assert.equal(loop.state,'off');assert.equal(video.playbackRate,.8)
})
