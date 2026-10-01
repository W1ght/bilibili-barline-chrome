/**
 * Automatic bar alignment for rows without a playback cursor.
 *
 * Within a stretch of music every bar of the same metre lasts about as long,
 * however wide it is drawn. So instead of spreading a row's time evenly over
 * its width, the row's time span is split evenly over its bars, using the bar
 * lines detected when the row was captured. Rows whose bar count does not fit
 * their duration (repeats, missed bar lines, intros) are left untouched.
 *
 * Videos often show a row slightly before it is played. That lead is measured
 * from any row that has a cursor or a manual calibration and applied to all
 * estimated rows, so calibrating one row corrects the whole piece.
 */
import {ScoreAnchor,ScoreFrame,timeAtPosition} from './score-model'

export interface BarAlignRow {index:number; anchors:ScoreAnchor[]|null; reason?:string}
export interface BarAlignResult {
  rows:BarAlignRow[]
  /** Rows that got bar anchors. */
  aligned:number
  /** Rows that could have been aligned (no cursor/manual anchors, bar lines found). */
  candidates:number
  /** Typical bar length in seconds, or null if unknown. */
  barDuration:number|null
  /** Seconds the music lags behind the row appearing (measured from trusted rows). */
  lead:number
  /** True when the lead was measured rather than assumed to be zero. */
  leadMeasured:boolean
  /** Start time of every bar found, in order (estimated and trusted rows). */
  bars:number[]
}

const median=(v:number[])=>{if(!v.length)return NaN;const s=[...v].sort((a,b)=>a-b),m=s.length>>1;return s.length%2?s[m]:(s[m-1]+s[m])/2}

/** A row is "trusted" when its anchors come from the video cursor or the user. */
export function isTrusted(frame:ScoreFrame){
  const a=frame.anchors
  return a.filter(p=>p.manual).length>=2||(a.length>=2&&a.every(p=>!p.manual&&!p.source))
}
const replaceable=(frame:ScoreFrame)=>!isTrusted(frame)&&!frame.anchors.some(p=>p.manual)

/** Bar boundaries in a row (x, 0–1). Adds the opening bar that standard notation draws without a bar line. */
export function barBoundaries(barLines:number[]|undefined):number[]|null{
  const b=[...(barLines||[])].filter(x=>x>=0&&x<=1).sort((p,q)=>p-q)
  if(b.length<2)return null
  const width=median(b.slice(1).map((x,i)=>x-b[i]))
  const out=[...b]
  if(b[0]>.1)out.unshift(Math.max(.01,b[0]-width))
  if(b[b.length-1]<.9)out.push(Math.min(.99,b[b.length-1]+width))
  return out
}

export function autoAlignBars(frames:ScoreFrame[],videoEnd:number):BarAlignResult{
  const info=frames.map((f,i)=>{
    const bounds=barBoundaries(f.barLines),next=frames[i+1]
    const end=f.end??next?.time
    const bars=bounds?bounds.length-1:0
    return {f,i,bounds,bars,start:f.time,end:end!==undefined&&end>f.time?end:null,perBar:bounds&&end!==undefined&&end>f.time?(end-f.time)/(bounds.length-1):NaN}
  })
  // The bar length most rows agree on (within 10%), so a few odd rows cannot drag it.
  const consensus=(values:number[])=>{
    let best=NaN,support=0
    for(const v of values){const close=values.filter(w=>Math.abs(w/v-1)<=.1);if(close.length>support){support=close.length;best=median(close)}}
    return {value:best,support}
  }
  const all=consensus(info.map(r=>r.perBar).filter(Number.isFinite))
  const barDuration=all.support?all.value:null
  const localBar=(i:number)=>{
    const near=consensus(info.slice(Math.max(0,i-4),i+5).map(r=>r.perBar).filter(Number.isFinite))
    return near.support>=2?near.value:barDuration
  }

  // How long after a row appears its first bar is played, from rows we can trust.
  const leads:number[]=[]
  for(const r of info){
    if(!isTrusted(r.f)||!r.bounds||r.end===null)continue
    const xs=r.f.anchors.map(a=>a.x),lo=Math.min(...xs),hi=Math.max(...xs)
    const diffs=r.bounds.map((x,j)=>x>=lo&&x<=hi?timeAtPosition(r.f,r.end!,x)-(r.start+j*r.perBar):NaN).filter(Number.isFinite)
    if(diffs.length)leads.push(median(diffs))
  }
  let lead=leads.length?median(leads):0
  if(barDuration)lead=Math.max(-.5*barDuration,Math.min(1.5*barDuration,lead))

  const rows:BarAlignRow[]=[]
  let aligned=0,candidates=0
  for(const r of info){
    if(!replaceable(r.f)){rows.push({index:r.i,anchors:null});continue}
    if(!r.bounds){rows.push({index:r.i,anchors:null,reason:'未识别到小节线'});continue}
    candidates++
    const local=localBar(r.i)
    let end=r.end
    if(end===null){
      // Last row: assume the local bar length.
      if(!local){rows.push({index:r.i,anchors:null,reason:'缺少参考时长'});continue}
      end=Math.min(videoEnd||Infinity,r.start+r.bars*local)
    }
    const per=(end-r.start)/r.bars
    if(local&&r.end!==null){
      const ratio=per/local
      if(Math.abs(ratio-1)>.15){
        rows.push({index:r.i,anchors:null,reason:ratio>1.8&&ratio<2.25?'时长约为两倍，可能有反复':ratio>1?'时长偏长，可能漏识别小节线或有前奏':'时长偏短，可能多识别了小节线'})
        continue
      }
    }
    const anchors=r.bounds.map((x,j)=>({time:r.start+lead+j*per,x,source:'bar-estimate' as const}))
      .filter(a=>a.time>=r.f.time)
    if(anchors.length<2){rows.push({index:r.i,anchors:null,reason:'可用的小节太少'});continue}
    rows.push({index:r.i,anchors})
    aligned++
  }

  // Bar starts for the metronome grid, from aligned and trusted rows.
  const bars:number[]=[]
  for(const r of info){
    const row=rows[r.i]
    if(row.anchors)bars.push(...row.anchors.slice(0,-1).map(a=>a.time))
    else if(isTrusted(r.f)&&r.bounds&&r.end!==null){
      const xs=r.f.anchors.map(a=>a.x),lo=Math.min(...xs),hi=Math.max(...xs)
      for(const x of r.bounds.slice(0,-1))if(x>=lo&&x<=hi)bars.push(timeAtPosition(r.f,r.end,x))
    }
  }
  bars.sort((a,b)=>a-b)
  const minGap=(barDuration??1)*.3
  const unique=bars.filter((t,i)=>i===0||t-bars[i-1]>minGap)
  return {rows,aligned,candidates,barDuration,lead,leadMeasured:leads.length>0,bars:unique}
}

/** Apply a result: replace anchors only on rows that are not trusted; clear stale bar estimates. */
export function applyBarAlignment(frames:ScoreFrame[],result:BarAlignResult){
  for(const row of result.rows){
    const f=frames[row.index]
    if(!f||!replaceable(f))continue
    if(row.anchors)f.anchors=row.anchors
    else if(f.anchors.some(a=>a.source==='bar-estimate'))f.anchors=[]
  }
}

/**
 * Turn bar start times into metronome segments. Bars of similar length are
 * merged into one segment; a gap without bars (interlude without score) is
 * bridged with bars of the surrounding length so bar numbers stay continuous.
 */
export function barGridSegments(bars:number[],numerator:number,denominator:number){
  if(bars.length<3)throw new Error('可用的小节太少，无法生成节拍网格。')
  const quarters=numerator*4/denominator
  const lengths=bars.slice(1).map((t,i)=>t-bars[i]),typical=median(lengths)
  const filled:number[]=[bars[0]]
  for(let i=1;i<bars.length;i++){
    const gap=bars[i]-bars[i-1],count=Math.max(1,Math.round(gap/typical))
    for(let k=1;k<=count;k++)filled.push(bars[i-1]+gap*k/count)
  }
  // Greedy: extend a segment while every bar inside stays within 6% of a bar of
  // the straight line through its two ends. Ends are exact, so nothing drifts.
  const segments:{bpm:number;numerator:number;denominator:number;firstBeatTime?:number;startBar?:number}[]=[]
  let from=0
  while(from<filled.length-1){
    let to=from+1
    while(to+1<filled.length){
      const next=to+1,slope=(filled[next]-filled[from])/(next-from)
      let fits=true
      for(let k=from+1;k<next&&fits;k++)if(Math.abs(filled[from]+slope*(k-from)-filled[k])>.06*typical)fits=false
      if(!fits)break
      to=next
    }
    const length=(filled[to]-filled[from])/(to-from)
    segments.push({bpm:Number((60*quarters/length).toFixed(6)),numerator,denominator,...(segments.length?{startBar:from+1}:{firstBeatTime:filled[0]})})
    from=to
  }  if(segments.some(s=>!(s.bpm>=30&&s.bpm<=360)))throw new Error('推算出的速度超出 30–360 BPM，请检查拍号设置。')
  return segments
}
