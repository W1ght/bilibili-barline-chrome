import {test} from 'node:test'
import assert from 'node:assert/strict'
import {rowFingerprint,sameRow,firstOccurrences,FINGERPRINT_W as W,FINGERPRINT_H as H,LEFT_W,LEFT_H} from '../src/score-dedupe.ts'

/** 一行谱的缩略图：五线谱 + 按 seed 排布的音符，整体可上下错开 shift 像素。 */
function thumb(seed:number,shift=0){
  const p=new Uint8ClampedArray(W*H*4).fill(250)
  const put=(x:number,y:number,v=20)=>{y+=shift;if(y<0||y>=H)return;const i=(y*W+x)*4;p[i]=p[i+1]=p[i+2]=v}
  for(let l=0;l<5;l++)for(let x=4;x<W-4;x++)put(x,16+l*4,60)
  for(let n=0;n<16;n++){const x=30+n*13+(seed*5+n*3)%7,y=13+((seed*3+n*(seed+2))%6)*3;for(let dx=0;dx<4;dx++)for(let dy=0;dy<3;dy++)put(x+dx,y+dy)}
  return p
}
// 3×5 点阵数字，放大 3 倍画在左上角
const FONT:Record<string,string[]>={'1':['010','110','010','010','111'],'2':['111','001','111','100','111'],'3':['111','001','111','001','111'],'6':['111','100','111','101','111'],'8':['111','101','111','101','111']}
function corner(measure:string,shift=0){
  const p=new Uint8ClampedArray(LEFT_W*LEFT_H*4).fill(250)
  ;[...measure].forEach((d,k)=>FONT[d].forEach((line,r)=>[...line].forEach((on,c)=>{
    if(on!=='1')return
    for(let dy=0;dy<3;dy++)for(let dx=0;dx<3;dx++){const x=20+k*12+c*3+dx,y=12+shift+r*3+dy,i=(y*LEFT_W+x)*4;p[i]=p[i+1]=p[i+2]=30}
  })))
  return p
}
const fp=(seed:number,measure:string,shift=0)=>rowFingerprint(thumb(seed,shift),corner(measure,shift>0?1:0),10)

test('同一行上下错开几像素仍判为相同，不同的行不相同',()=>{
  assert.ok(sameRow(fp(1,'8'),fp(1,'8',3)))
  assert.ok(!sameRow(fp(1,'8'),fp(2,'8')))
})

test('节奏完全相同但小节号不同的两行不合并',()=>{
  assert.ok(!sameRow(fp(1,'16'),fp(1,'36')))
  assert.ok(!sameRow(fp(1,'12'),fp(1,'31')))
})

test('按首次出现合并：反复段落指回第一次出现的行，保持书写顺序',()=>{
  const images=['a','b','c','b2','c2','d','a']
  const prints=[fp(1,'1'),fp(2,'8'),fp(3,'12'),fp(2,'8',2),fp(3,'12',1),fp(4,'16'),fp(1,'1')]
  assert.deepEqual(firstOccurrences(images,prints),[0,1,2,1,2,5,0])
  // 图片完全相同（滚动谱的反复行共用一张截图）时无需比对。
  assert.deepEqual(firstOccurrences(['x','y','x'],[null,null,null]),[0,1,0])
})
