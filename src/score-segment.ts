import type {ScoreAnchor,ScoreFrame} from './score-model'

/** Binary notation mask used only for comparing frames, never stored. */
export interface InkMask {mask:Uint8Array; width:number; height:number; ink:number; count:number}
export interface CursorPoint {time:number; x:number}
export interface ScanSample {time:number; mask:InkMask; cursor:number|null}
export interface ScanRow<T> {time:number; end?:number; mask:InkMask; shot:T; cursor:CursorPoint[]; seeded?:boolean}
export interface SegmentOptions {
  /** Share of the old row's notes that must disappear before a new row is assumed. */
  threshold:number
  /** Media seconds a new picture must stay unchanged before it is captured (skips fades). */
  settle:number
  minInk:number
  maxInk:number
}
export const sensitivities = {high:.22, normal:.35, robust:.5} as const
export type Sensitivity = keyof typeof sensitivities
export const defaultSegmentOptions:SegmentOptions = {threshold:sensitivities.normal, settle:.2, minInk:.004, maxInk:.45}

/**
 * Ink = pixels clearly darker than the paper (lighter, on dark-themed scores).
 * Light highlight tints stay background while dark coloured notes stay ink, so
 * "played notes turn red" is not a new row. Staff lines and the cursor column
 * are removed so that comparisons are driven by the notes themselves.
 */
export function inkMask(rgba:Uint8ClampedArray,width:number,height:number,cursor:number|null=null):InkMask {
  const n=width*height,lum=new Uint8Array(n),hist=new Uint32Array(256)
  for(let i=0;i<n;i++){const p=i*4,l=Math.round(.299*rgba[p]+.587*rgba[p+1]+.114*rgba[p+2]);lum[i]=l;hist[l]++}
  const percentile=(q:number)=>{let seen=0;for(let l=0;l<256;l++){seen+=hist[l];if(seen>=n*q)return l}return 255}
  const inverted=percentile(.5)<110
  const paper=inverted?255-percentile(.3):percentile(.7)
  const limit=Math.min(paper*.62,paper-40)
  const mask=new Uint8Array(n);let raw=0
  for(let i=0;i<n;i++){const l=inverted?255-lum[i]:lum[i];if(l<limit){mask[i]=1;raw++}}
  for(let y=0;y<height;y++){
    let row=0;for(let x=0;x<width;x++)row+=mask[y*width+x]
    if(row>width*.45)mask.fill(0,y*width,(y+1)*width)
  }
  if(cursor!==null){
    const c=Math.round(cursor*(width-1)),r=Math.max(2,Math.round(width*.006))
    for(let y=0;y<height;y++)mask.fill(0,y*width+Math.max(0,c-r),y*width+Math.min(width,c+r+1))
  }
  let count=0;for(let i=0;i<n;i++)count+=mask[i]
  return {mask,width,height,ink:raw/Math.max(1,n),count}
}

function dilate(m:InkMask){
  const {width:w,height:h}=m,a=new Uint8Array(m.mask.length),b=new Uint8Array(m.mask.length)
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){const i=y*w+x;a[i]=m.mask[i]|(x>0?m.mask[i-1]:0)|(x<w-1?m.mask[i+1]:0)}
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){const i=y*w+x;b[i]=a[i]|(y>0?a[i-w]:0)|(y<h-1?a[i+w]:0)}
  return b
}
/** Share of `from` ink with no ink nearby in `to` (1px jitter tolerated). */
function missing(from:InkMask,near:Uint8Array){
  if(from.count<20)return 0
  let lost=0;for(let i=0;i<from.mask.length;i++)if(from.mask[i]&&!near[i])lost++
  return lost/from.count
}
export function compareInk(a:InkMask,b:InkMask){
  if(a.width!==b.width||a.height!==b.height)return {removed:1,added:1}
  return {removed:missing(a,dilate(b)),added:missing(b,dilate(a))}
}

export class ScoreSegmenter<T> {
  readonly rows:ScanRow<T>[]=[]
  private current:ScanRow<T>|null=null
  private pending:{kind:'row'|'grow'|'blank';first:number;since:number;mask:InkMask;count:number}|null=null
  private wrap=0
  private lastClosed:ScanRow<T>|null=null
  constructor(private capture:()=>T,private o:SegmentOptions=defaultSegmentOptions){}

  /** Treat an already saved row as on screen, so an unchanged start is not duplicated. */
  seed(mask:InkMask){this.current={time:-Infinity,mask,shot:null as unknown as T,cursor:[],seeded:true}}

  push(s:ScanSample):'row'|'grow'|'blank'|null {
    const T=this.o.threshold,scoreLike=s.mask.ink>=this.o.minInk&&s.mask.ink<=this.o.maxInk
    let kind:'row'|'grow'|'blank'|'same'
    if(!scoreLike)kind=this.current?'blank':'same'
    else if(!this.current)kind='row'
    else{const d=compareInk(this.current.mask,s.mask);kind=d.removed>=T?'row':d.added>=T?'grow':'same'}
    if(kind==='same'){
      this.pending=null
      if(this.current&&scoreLike)return this.observeCursor(s)
      return null
    }
    const p=this.pending
    if(!p||p.kind!==kind||!this.similar(p.mask,s.mask)){
      // Keep the earliest deviation through a fade, restart only the stability clock.
      this.pending={kind,first:p?.first??s.time,since:s.time,mask:s.mask,count:1}
      return null
    }
    p.count++;p.mask=s.mask
    if(p.count<2||s.time-p.since<this.o.settle)return null
    this.pending=null
    if(kind==='grow'){
      // Notes revealed progressively: keep the start time, refresh to the fuller picture.
      const row=this.current!;row.mask=s.mask;if(!row.seeded)row.shot=this.capture()
      return 'grow'
    }
    if(kind==='blank'){this.close(p.first,true);return 'blank'}
    const previous=this.current?null:this.lastClosed
    this.close(p.first)
    if(previous&&previous.end!==undefined&&p.first-previous.end<3&&this.similar(previous.mask,s.mask)){
      // The same row came back after a brief interruption (hand, subtitle, flash).
      delete previous.end;this.current=previous;this.lastClosed=null;return null
    }
    this.open(p.first,s.mask,this.capture())
    if(s.cursor!==null)this.current!.cursor.push({time:s.time,x:s.cursor})
    return 'row'
  }

  finish(minRow=.4):ScanRow<T>[]{
    this.pending=null
    return this.rows.filter((r,i)=>{const end=r.end??this.rows[i+1]?.time;return end===undefined||end-r.time>=minRow})
  }

  private similar(a:InkMask,b:InkMask){const d=compareInk(a,b);return d.removed<this.o.threshold/2&&d.added<this.o.threshold/2}
  private open(time:number,mask:InkMask,shot:T){this.current={time,mask,shot,cursor:[]};this.rows.push(this.current);this.wrap=0}
  /** Only a row interrupted by a non-score picture may be reopened. */
  private close(time:number,blank=false){
    if(this.current&&!this.current.seeded)this.current.end=time
    this.lastClosed=blank&&this.current&&!this.current.seeded?this.current:null
    this.current=null
  }

  /** A cursor jumping back to the left on the same picture means the row is played again (repeat). */
  private observeCursor(s:ScanSample):'row'|null {
    const row=this.current!
    if(s.cursor===null)return null
    const recent=row.cursor.slice(-3).map(c=>c.x).sort((a,b)=>a-b),last=recent[recent.length>>1]
    if(recent.length>=3&&last>.45&&s.cursor<last-.3){
      if(++this.wrap<2)return null
      const shot=row.seeded?null:row.shot,mask=row.mask
      if(shot===null){row.cursor.push({time:s.time,x:s.cursor});return null}
      this.close(s.time);this.lastClosed=null;this.open(s.time,mask,shot)
      this.current!.cursor.push({time:s.time,x:s.cursor})
      return 'row'
    }
    this.wrap=0;row.cursor.push({time:s.time,x:s.cursor});return null
  }
}

function isotonic(values:number[]){
  const blocks:{sum:number;n:number}[]=[]
  for(const v of values){
    blocks.push({sum:v,n:1})
    while(blocks.length>1){const a=blocks[blocks.length-2],b=blocks[blocks.length-1];if(a.sum/a.n<=b.sum/b.n)break;a.sum+=b.sum;a.n+=b.n;blocks.pop()}
  }
  return blocks.flatMap(b=>Array(b.n).fill(b.sum/b.n) as number[])
}
/** Robust, monotonic playhead anchors from noisy cursor sightings. */
export function fitCursorAnchors(points:CursorPoint[]):ScoreAnchor[]{
  if(points.length<4)return []
  const sorted=[...points].sort((a,b)=>a.time-b.time)
  const local=sorted.filter((p,i)=>{const w=sorted.slice(Math.max(0,i-2),i+3).map(q=>q.x).sort((a,b)=>a-b);return Math.abs(p.x-w[w.length>>1])<=.08})
  let fit=isotonic(local.map(p=>p.x))
  const keep=local.filter((p,i)=>Math.abs(p.x-fit[i])<=.06)
  if(keep.length<4)return []
  fit=isotonic(keep.map(p=>p.x))
  if(fit[fit.length-1]-fit[0]<.12)return []
  const out:ScoreAnchor[]=[]
  keep.forEach((p,i)=>{const last=out[out.length-1];if(!last||(p.time-last.time>=.2&&fit[i]>last.x+.002))out.push({time:p.time,x:fit[i]})})
  const tail=keep.length-1,last=out[out.length-1]
  if(last.time!==keep[tail].time&&fit[tail]>last.x)out.push({time:keep[tail].time,x:fit[tail]})
  return out.length>=2?out:[]
}

/** Replace only the rescanned span; rows outside it are kept untouched. */
export function mergeScanned(existing:ScoreFrame[],added:ScoreFrame[],start:number,stop:number):ScoreFrame[]{
  const first=added[0]?.time
  const kept=existing.filter(f=>f.time<start-.001||f.time>=stop).map(f=>f.time<start&&first!==undefined&&f.end!==undefined&&f.end>first?{...f,end:first}:f)
  return [...kept,...added.filter(a=>kept.every(k=>Math.abs(k.time-a.time)>=.02))].sort((a,b)=>a.time-b.time)
}
