import {InkMask,CursorPoint,compareInk,dilate,defaultSegmentOptions} from './score-segment'

/**
 * 滚动谱：一屏有好几行谱，页面不定时上下滚动（滚动量和时机都与换行无关），光标框在各行间移动。
 * 思路：把每帧相对上一张「关键帧」的竖直位移累加成整页坐标；每次滚动停稳后截一张全分辨率关键帧，
 * 按谱表切出完整可见的各行（系统）登记到整页上；再按光标框所在的行把时间切成一次次「经过」，
 * 每次经过就是一行谱面。反复记号让光标回到上面的行时，同一行会再出现一次。
 */

/** 关键帧里的一行谱（系统），纵向坐标为占画面高度的比例。 */
export interface Band {top:number; bottom:number; full:boolean}
export interface CursorBox {x:number; y:number}
export interface ScrollKeyframe<T> {bands:Band[]; crop:(band:Band)=>T}
export interface ScrollSample {time:number; mask:InkMask; box:CursorBox|null}
export interface ScrollRow<T> {time:number; end?:number; shot:T; cursor:CursorPoint[]}
export interface ScrollOptions {
  /** 相对关键帧变化超过这个比例才判断是否滚动。 */
  change:number
  /** 位移对齐后仍对不上的墨迹比例上限。 */
  match:number
  settle:number
  minInk:number
  maxInk:number
}
export const defaultScrollOptions:ScrollOptions = {change:.15, match:.22, settle:.08, minInk:defaultSegmentOptions.minInk, maxInk:defaultSegmentOptions.maxInk}

function rowProfile(m:InkMask){
  const p=new Float64Array(m.height)
  for(let y=0;y<m.height;y++){let n=0;for(let x=0;x<m.width;x++)n+=m.mask[y*m.width+x];p[y]=n}
  return p
}
/** 位移 dy 下两帧墨迹对不上的比例（双向取大）；b 的第 y 行对应 a 的第 y+dy 行。 */
function shiftedMismatch(a:InkMask,b:InkMask,da:Uint8Array,db:Uint8Array,dy:number){
  const w=a.width,h=a.height,from=Math.max(0,-dy),to=Math.min(h,h-dy)
  let inkA=0,lostA=0,inkB=0,lostB=0
  for(let y=from;y<to;y++){
    const rb=y*w,ra=(y+dy)*w
    for(let x=0;x<w;x++){
      if(b.mask[rb+x]){inkB++;if(!da[ra+x])lostB++}
      if(a.mask[ra+x]){inkA++;if(!db[rb+x])lostA++}
    }
  }
  if(inkA<20||inkB<20)return 1
  return Math.max(lostA/inkA,lostB/inkB)
}

/**
 * 估计 b 相对 a 的竖直位移：b 的第 y 行 ≈ a 的第 y+dy 行（内容上移时 dy>0）。
 * 先用逐行墨迹量粗筛，再用二维墨迹逐一核对，避免等间距的谱行互相混淆。
 */
export function estimateShift(a:InkMask,b:InkMask,maxShare=.75):{dy:number;error:number}|null{
  if(a.width!==b.width||a.height!==b.height)return null
  const h=a.height,pa=rowProfile(a),pb=rowProfile(b),lim=Math.round(h*maxShare),minOverlap=Math.round(h*.25)
  const candidates:{dy:number;cost:number}[]=[]
  for(let dy=-lim;dy<=lim;dy++){
    const from=Math.max(0,-dy),to=Math.min(h,h-dy)
    if(to-from<minOverlap)continue
    let cost=0,mass=0
    for(let y=from;y<to;y++){cost+=Math.abs(pa[y+dy]-pb[y]);mass+=pa[y+dy]+pb[y]}
    if(mass>0)candidates.push({dy,cost:cost/mass})
  }
  candidates.sort((x,y)=>x.cost-y.cost)
  const da=dilate(a),db=dilate(b)
  let best:{dy:number;error:number}|null=null
  for(const c of candidates.slice(0,8)){
    const error=shiftedMismatch(a,b,da,db,c.dy)
    if(!best||error<best.error)best={dy:c.dy,error}
  }
  return best
}

/**
 * 按谱线把画面切成一行行（系统）。一行里的多个谱表（如钢琴大谱表、五线谱+六线谱）间距较小，
 * 行与行之间间距较大；只有一种间距时每个谱表各成一行。没有谱线（简谱等）时按空白行切分。
 */
export function detectSystems(rgba:Uint8ClampedArray,w:number,h:number):Band[]{
  const lum=(i:number)=>.299*rgba[i]+.587*rgba[i+1]+.114*rgba[i+2]
  const dark=new Uint32Array(h),ink=new Uint32Array(h)
  for(let y=0;y<h;y++){let d=0,k=0;for(let x=0;x<w;x++){const l=lum((y*w+x)*4);if(l<205)d++;if(l<150)k++}dark[y]=d;ink[y]=k}
  // 谱线：横贯一半以上宽度的深色行，相邻行合并成一条线。
  const lines:number[]=[]
  for(let y=0;y<h;y++)if(dark[y]>w*.5){const last=lines[lines.length-1];if(last!==undefined&&y-last<=2)lines[lines.length-1]=(last+y)/2;else lines.push(y)}
  const staves:{top:number;bottom:number}[]=[]
  for(let i=0;i<lines.length;){
    let j=i
    const gap=lines[i+1]-lines[i]
    if(gap>=2&&gap<=h*.06)while(j+1<lines.length&&Math.abs(lines[j+1]-lines[j]-gap)<=Math.max(1.5,gap*.3))j++
    if(j-i+1>=3)staves.push({top:lines[i],bottom:lines[j]})
    i=j+1
  }
  const make=(groups:{top:number;bottom:number}[])=>{
    const out:Band[]=[]
    for(let i=0;i<groups.length;i++){
      const g=groups[i],size=Math.max(4,g.bottom-g.top),prev=groups[i-1],next=groups[i+1]
      const top=prev?(prev.bottom+g.top)/2:g.top-size*1.2,bottom=next?(g.bottom+next.top)/2:g.bottom+size*1.2
      // 谱表上下各留出音符的空间后仍在画面内，才算完整可见。
      const full=g.top-size*.6>=0&&g.bottom+size*.6<=h
      out.push({top:Math.max(0,top)/h,bottom:Math.min(h,bottom)/h,full})
    }
    return out
  }
  if(staves.length){
    const gaps=staves.slice(1).map((s,i)=>s.top-staves[i].bottom)
    const small=Math.min(...gaps),large=Math.max(...gaps)
    const split=gaps.length&&large>small*1.6?(small+large)/2:-Infinity
    const groups:{top:number;bottom:number}[]=[]
    staves.forEach((s,i)=>{if(i&&gaps[i-1]<split)groups[groups.length-1].bottom=s.bottom;else groups.push({...s})})
    return make(groups)
  }
  // 无谱线：连续空白行（≥2% 高度）分隔的墨迹块。
  const blank=(y:number)=>ink[y]<=w*.003,minGap=Math.max(2,Math.round(h*.02)),blocks:{top:number;bottom:number}[]=[]
  let start=-1,gapRun=0
  for(let y=0;y<=h;y++){
    if(y<h&&!blank(y)){if(start<0)start=y;gapRun=0;continue}
    if(start>=0&&(++gapRun>=minGap||y===h)){const bottom=y-gapRun+1;if(bottom-start>=h*.05)blocks.push({top:start,bottom});start=-1}
  }
  return blocks.map((b,i)=>{
    const prev=blocks[i-1],next=blocks[i+1]
    return {top:(prev?(prev.bottom+b.top)/2:Math.max(0,b.top-2))/h,bottom:(next?(b.bottom+next.top)/2:Math.min(h,b.bottom+2))/h,full:b.top>1&&b.bottom<h-1}
  })
}

/**
 * 光标框：一块颜色较浅但明显偏色的竖条（任何色相），可以只覆盖一行谱的高度。
 * 框里的黑色音符会打断色块，因此逐列找允许小缺口的最长色段。
 */
export function detectCursorBox(rgba:Uint8ClampedArray,w:number,h:number):CursorBox|null{
  const tinted=(i:number)=>{const r=rgba[i],g=rgba[i+1],b=rgba[i+2],max=Math.max(r,g,b),min=Math.min(r,g,b);return max>=140&&max-min>=22}
  const minRun=Math.max(6,Math.round(h*.04)),gapLimit=Math.max(2,Math.round(h*.015))
  const runs:{len:number;top:number;bottom:number}[]=[]
  for(let x=0;x<w;x++){
    let best={len:0,top:0,bottom:0},top=-1,last=-1,len=0
    for(let y=0;y<h;y++){
      if(!tinted((y*w+x)*4))continue
      if(top<0||y-last>gapLimit+1){top=y;len=0}
      len++;last=y
      if(last-top+1>best.len&&len>=(last-top+1)*.6)best={len:last-top+1,top,bottom:last}
    }
    runs.push(best)
  }
  let pick:{l:number;r:number;mass:number}|null=null
  for(let x=0;x<w;){
    if(runs[x].len<minRun){x++;continue}
    let r=x,mass=0
    while(r<w&&runs[r].len>=minRun){mass+=runs[r].len;r++}
    if(r-x<=Math.max(4,w*.08)&&(!pick||mass>pick.mass))pick={l:x,r:r-1,mass}
    x=r
  }
  if(!pick)return null
  const mid=Math.round((pick.l+pick.r)/2),run=runs[mid].len>=minRun?runs[mid]:runs[pick.l]
  return {x:mid/Math.max(1,w-1),y:(run.top+run.bottom)/2/Math.max(1,h-1)}
}

interface System<T> {id:number; top:number; bottom:number; shot:T; since:number}
interface Key {offset:number; bands:{top:number;bottom:number;id:number|null}[]}

export class ScrollTracker<T> {
  scrolls=0
  pages=0
  private ref:{mask:InkMask;offset:number}|null=null
  private key:Key|null=null
  private systems:System<T>[]=[]
  private samples:{time:number;id:number;x:number}[]=[]
  private pending:{kind:'scroll'|'page';dy:number;since:number;count:number}|null=null
  private held:ScrollSample[]=[]
  /** 已用到的整页坐标下界；翻页（不是滚动）时新页面放到它后面。 */
  private extent=0
  constructor(private capture:()=>ScrollKeyframe<T>,private o:ScrollOptions=defaultScrollOptions){}

  /** 至少两次确认的滚动，才按滚动谱处理。 */
  get scrolling(){return this.scrolls>=2}
  get systemCount(){return this.systems.length}

  push(s:ScrollSample):'system'|null{
    const scoreLike=s.mask.ink>=this.o.minInk&&s.mask.ink<=this.o.maxInk
    if(!scoreLike)return null
    if(!this.ref)return this.commit(s,'start',0)
    const d=compareInk(this.ref.mask,s.mask)
    if(d.removed<this.o.change&&d.added<this.o.change){this.settleBack();this.observe(s);return null}
    const shift=estimateShift(this.ref.mask,s.mask)
    if(shift&&shift.dy===0&&shift.error<this.o.match){this.settleBack();this.observe(s);return null}
    const kind=shift&&shift.error<this.o.match?'scroll':'page',dy=kind==='scroll'?shift!.dy:0
    const p=this.pending
    if(!p||p.kind!==kind||Math.abs(p.dy-dy)>1){this.pending={kind,dy,since:s.time,count:1};this.held=[s];return null}
    p.count++;this.held.push(s)
    if(p.count<2||s.time-p.since<this.o.settle)return null
    this.pending=null
    const held=this.held;this.held=[]
    const event=this.commit(s,kind,dy)
    // 滚动确认前的几帧已经是新画面：按新位置补记光标，换行时刻不因等待确认而推迟。
    for(const h of held.slice(0,-1))this.observe(h)
    this.samples.sort((a,b)=>a.time-b.time)
    return event
  }
  /** 疑似变化没有成立（闪烁、过渡）：暂存的帧仍按原画面记光标。 */
  private settleBack(){
    if(!this.pending)return
    this.pending=null
    for(const h of this.held)this.observe(h)
    this.held=[]
  }

  private commit(s:ScrollSample,kind:'start'|'scroll'|'page',dy:number):'system'|null{
    const h=s.mask.height
    let offset=0
    if(kind==='scroll'){offset=this.ref!.offset+dy/h;this.scrolls++}
    else if(kind==='page'){offset=this.extent+2;this.pages++}
    this.ref={mask:s.mask,offset}
    this.extent=Math.max(this.extent,offset+1)
    const frame=this.capture()
    let added=false
    const bands=frame.bands.map(b=>{
      const top=offset+b.top,bottom=offset+b.bottom
      const match=this.systems.find(sys=>Math.min(sys.bottom,bottom)-Math.max(sys.top,top)>.5*Math.min(sys.bottom-sys.top,bottom-top))
      if(match)return {top:b.top,bottom:b.bottom,id:match.id}
      if(!b.full)return {top:b.top,bottom:b.bottom,id:null}
      const sys={id:this.systems.length,top,bottom,shot:frame.crop(b),since:s.time}
      this.systems.push(sys);added=true
      return {top:b.top,bottom:b.bottom,id:sys.id}
    })
    this.key={offset,bands}
    this.observe(s)
    return added?'system':null
  }

  private observe(s:ScrollSample){
    const box=s.box,key=this.key
    if(!box||!key)return
    let hit=key.bands.find(b=>b.id!==null&&box.y>=b.top&&box.y<=b.bottom)
    if(!hit){
      const near=key.bands.filter(b=>b.id!==null).map(b=>({b,d:Math.min(Math.abs(box.y-b.top),Math.abs(box.y-b.bottom))})).sort((a,b)=>a.d-b.d)[0]
      if(near&&near.d<.03)hit=near.b
    }
    if(hit)this.samples.push({time:s.time,id:hit.id!,x:box.x})
  }

  /**
   * 光标在同一行里连续停留的一段就是一行谱面；短暂误判（<0.25 秒且少于 3 帧）并入前一段。
   * 完全没检测到光标时，按各行出现在画面中的先后排列。
   */
  rows(minVisit=.25):ScrollRow<T>[]{
    const byId=new Map(this.systems.map(s=>[s.id,s]))
    if(this.samples.length<3)return [...this.systems].sort((a,b)=>a.since-b.since||a.top-b.top).map(s=>({time:s.since,shot:s.shot,cursor:[]}))
    type Run={id:number;start:number;last:number;points:CursorPoint[]}
    let runs:Run[]=[]
    for(const p of this.samples){
      const last=runs[runs.length-1]
      if(last&&last.id===p.id){last.last=p.time;last.points.push({time:p.time,x:p.x})}
      else runs.push({id:p.id,start:p.time,last:p.time,points:[{time:p.time,x:p.x}]})
    }
    const merged:Run[]=[]
    for(const r of runs){
      const prev=merged[merged.length-1]
      if(prev&&(r.id===prev.id||(r.last-r.start<minVisit&&r.points.length<3))){prev.last=r.last;if(r.id===prev.id)prev.points.push(...r.points);continue}
      merged.push(r)
    }
    runs=merged
    return runs.map(r=>({time:r.start,shot:byId.get(r.id)!.shot,cursor:r.points}))
  }
}
