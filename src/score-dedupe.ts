import {InkMask,compareInk,inkMask} from './score-segment'

/**
 * 反复记号、D.S./D.C. 让同一行谱演奏多次，抄谱会按演奏顺序得到多份。打印或导出时
 * 只保留第一次出现的那一行：按演奏先后取首次出现，正好就是谱面的书写顺序。
 */
export const FINGERPRINT_W=240, FINGERPRINT_H=48
/**
 * 行首小节号所在的左上角（宽 LEFT_SHARE、高 LEFT_TOP）另按接近原尺寸单独比较：
 * 鼓谱里节奏完全相同的两行往往只有小节号不同，缩略图里小节号只剩几个像素，分不出来。
 */
export const LEFT_SHARE=.08, LEFT_TOP=.4, LEFT_W=96, LEFT_H=48
export interface RowFingerprint {mask:InkMask; left:InkMask; aspect:number}

/** thumb 为整行缩放到 FINGERPRINT_W×FINGERPRINT_H；left 为左侧 LEFT_SHARE 缩放到 LEFT_W×LEFT_H；aspect 为原图宽高比。 */
export function rowFingerprint(thumb:Uint8ClampedArray,left:Uint8ClampedArray,aspect:number):RowFingerprint{
  return {mask:inkMask(thumb,FINGERPRINT_W,FINGERPRINT_H),left:inkMask(left,LEFT_W,LEFT_H),aspect}
}

/** 两次截图的上下边界可能差几个像素：在 ±10% 高度内找最佳对齐，返回对不上的墨迹比例（双向取大）。 */
function aligned(a:InkMask,b:InkMask,dy:number){
  const w=a.width,h=a.height,from=Math.max(0,-dy),to=Math.min(h,h-dy)
  const shift=(m:InkMask,off:number)=>{const mask=new Uint8Array(w*h);for(let y=from;y<to;y++)mask.set(m.mask.subarray((y+off)*w,(y+off+1)*w),y*w);let count=0;for(const v of mask)count+=v;return {...m,mask,count}}
  const d=compareInk(shift(a,dy),shift(b,0))
  return Math.max(d.removed,d.added)
}
export function rowDistance(a:InkMask,b:InkMask){
  if(a.width!==b.width||a.height!==b.height)return 1
  const lim=Math.max(1,Math.round(a.height*.1))
  let best=1
  for(let dy=-lim;dy<=lim;dy++)best=Math.min(best,aligned(a,b,dy))
  return best
}

/** 小节号要逐笔画比较：不留 1 像素容差（否则 16 与 36 会重合），只在 ±4 像素内找最佳对齐，取异或 / 并集。 */
export function cornerDistance(a:InkMask,b:InkMask,reach=4){
  if(a.width!==b.width||a.height!==b.height)return 1
  const w=a.width,h=a.height
  let best=1
  for(let dy=-reach;dy<=reach;dy++)for(let dx=-reach;dx<=reach;dx++){
    let diff=0,union=0
    for(let y=Math.max(0,-dy);y<Math.min(h,h-dy);y++)for(let x=Math.max(0,-dx);x<Math.min(w,w-dx);x++){
      const p=a.mask[(y+dy)*w+x+dx],q=b.mask[y*w+x]
      if(p|q){union++;if(p!==q)diff++}
    }
    if(union)best=Math.min(best,diff/union)
  }
  return best
}

/**
 * 实测（鼓谱录屏）：整行——同一行不同时刻截图 ≤0.21（含播放变色、边界错位），不同行 ≥0.55；
 * 左上角小节号——同一行 ≤0.10，不同小节号 ≥0.17。宁可漏合并（多印一行），不可误合并（少印一行）。
 */
export function sameRow(a:RowFingerprint,b:RowFingerprint,tolerance=.3,leftTolerance=.12){
  // 宽高比只做粗筛：同一行在画面边缘被裁掉一截时会差十几个百分点。
  if(Math.abs(a.aspect-b.aspect)>.25*Math.max(a.aspect,b.aspect))return false
  if(rowDistance(a.mask,b.mask)>tolerance)return false
  if(a.left.count<20&&b.left.count<20)return true
  return cornerDistance(a.left,b.left)<=leftTolerance
}

/** 每一行对应的首次出现的下标（自己是首次出现时就是自己）。图片完全相同时直接视为重复。 */
export function firstOccurrences(images:string[],prints:(RowFingerprint|null)[]):number[]{
  const out:number[]=[]
  images.forEach((image,i)=>{
    let first=i
    for(let j=0;j<i;j++){
      if(out[j]!==j)continue
      const a=prints[j],b=prints[i]
      if(images[j]===image||(a&&b&&sameRow(a,b))){first=j;break}
    }
    out.push(first)
  })
  return out
}
