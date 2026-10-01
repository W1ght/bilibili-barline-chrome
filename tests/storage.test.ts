import {test} from 'node:test'
import assert from 'node:assert/strict'
import {initStore,saveConfig,loadConfig,deleteConfig,importAllConfigs,loadAllConfigs,flushConfigs,touchOpened} from '../src/storage.ts'
const values:Record<string,any>={}
const listeners:any[]=[]
function notify(changes:any){listeners.forEach(fn=>fn(changes,'local'))}
;(globalThis as any).chrome={storage:{onChanged:{addListener:(fn:any)=>listeners.push(fn)},local:{
  get:async()=>structuredClone(values),
  set:async(data:any)=>{const changes:any={};for(const [key,value] of Object.entries(data)){changes[key]={oldValue:values[key],newValue:value};values[key]=structuredClone(value)}notify(changes)},
  remove:async(keys:string|string[])=>{const changes:any={};for(const key of [keys].flat()){changes[key]={oldValue:values[key]};delete values[key]}notify(changes)}
}}}
test('按视频存储、跨标签变更、导入校验及设置隔离',async()=>{
  await initStore()
  const cfg:any={segments:[{bpm:100,numerator:4,denominator:4,firstBeatTime:1}],metronomeMuted:true,metronomeVolume:1}
  saveConfig('100',cfg);saveConfig('200',cfg)
  assert.equal(loadConfig('100')?.segments[0].bpm,100)
  deleteConfig('100');assert.equal(loadConfig('100'),null);assert.ok(loadConfig('200'))
  await (globalThis as any).chrome.storage.local.set({'config:300':cfg,'option:hideBarNavButtons':true})
  assert.ok(loadConfig('300'))
  await assert.rejects(importAllConfigs({bad:null}))
  assert.ok(loadConfig('200'))
  await importAllConfigs({'400':cfg})
  assert.deepEqual(Object.keys(loadAllConfigs()),['400'])
  assert.equal(values['option:hideBarNavButtons'],true)
})
test('连续编辑合并为一次写入，删除会取消待写入，编辑不刷新最后打开时间',async()=>{
  const cfg:any={segments:[{bpm:90,numerator:3,denominator:4,firstBeatTime:0}],metronomeMuted:true,metronomeVolume:1}
  saveConfig('500',cfg)
  for(let bpm=91;bpm<100;bpm++)saveConfig('500',{...cfg,segments:[{...cfg.segments[0],bpm}]})
  assert.equal(values['config:500'],undefined,'not written yet')
  assert.equal(loadConfig('500')?.segments[0].bpm,99,'cache is immediate')
  flushConfigs();await new Promise(r=>setTimeout(r,0))
  assert.equal(values['config:500'].segments[0].bpm,99)
  const opened=loadConfig('500')!.openedAt
  await new Promise(r=>setTimeout(r,5));saveConfig('500',cfg);assert.equal(loadConfig('500')!.openedAt,opened)
  await new Promise(r=>setTimeout(r,5));touchOpened('500');assert.ok(loadConfig('500')!.openedAt!>opened!)
  saveConfig('600',cfg);deleteConfig('600');await new Promise(r=>setTimeout(r,350))
  assert.equal(values['config:600'],undefined)
})