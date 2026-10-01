import {ScoreFrame, timeAtPosition} from './score-model'
export interface Onset {time:number; strength:number}
export interface TempoCandidate {bpm:number; score:number; phase:number}
export interface AnalysisResult {bpm:number; confidence:number; candidates:TempoCandidate[]; beats:number[]; bars:number[]; visualBars:number; variable:boolean; start:number; end:number; numerator:number; denominator:number}
const median=(a:number[])=>{const b=[...a].sort((x,y)=>x-y);return b.length?b[b.length>>1]:0}

/** Conservative staff-spanning verticals. Stems shorter than the staff are rejected. */
export function detectBarLines(data:Uint8ClampedArray,w:number,h:number):number[]{
  const dark=(x:number,y:number)=>{const p=(y*w+x)*4;return Math.max(data[p],data[p+1],data[p+2])<205}
  const rows:number[]=[]
  for(let y=0;y<h;y++){let n=0;for(let x=0;x<w;x++)if(dark(x,y))n++;if(n>w*.6&&(rows.length===0||y-rows[rows.length-1]>2))rows.push(y)}
  if(rows.length<5)return []
  // Find a regular group of 5 or 6 horizontal staff lines.
  let staff:number[]=[]
  for(let i=0;i<=rows.length-5;i++)for(const size of [6,5]){
    const r=rows.slice(i,i+size);if(r.length!==size)continue
    const gaps=r.slice(1).map((y,j)=>y-r[j]),gap=median(gaps)
    if(gap>=3&&gaps.every(g=>Math.abs(g-gap)<=2)&&r.length>staff.length)staff=r
  }
  if(!staff.length)return []
  const top=staff[0],bottom=staff[staff.length-1],cols:number[]=[]
  for(let x=0;x<w;x++){let n=0;for(let y=top;y<=bottom;y++)if(dark(x,y))n++;if(n/(bottom-top+1)>.88)cols.push(x)}
  const out:number[]=[]
  for(let i=0;i<cols.length;){let j=i;while(j+1<cols.length&&cols[j+1]-cols[j]<=2)j++;const x=(cols[i]+cols[j])/2/(w-1);if(x>.015&&x<.99&&(!out.length||x-out[out.length-1]>.025))out.push(x);i=j+1}
  return out.length>=2&&out.length<=16?out:[]
}

export function analyzeTempo(onsets:Onset[],start:number,end:number,visualBars:number[]=[],numerator=4,denominator=4):AnalysisResult {
  if(end-start<8)throw new Error('至少分析 8 秒；建议选择 20–60 秒节奏清晰的片段。')
  const rate=100,n=Math.ceil((end-start)*rate),env=new Float64Array(n)
  for(const p of onsets){const i=Math.round((p.time-start)*rate);if(i>=0&&i<n&&Number.isFinite(p.strength))env[i]=Math.max(env[i],p.strength)}
  const sorted=Array.from(env).sort((a,b)=>a-b),floor=sorted[Math.floor(n*.5)],scale=sorted[Math.floor(n*.98)]-floor
  if(scale<.00001)throw new Error('未检测到有效音频节奏。请取消视频静音，确认有声音后重试。')
  for(let i=0;i<n;i++)env[i]=Math.min(3,Math.max(0,(env[i]-floor)/scale))
  const candidates:TempoCandidate[]=[]
  for(let bpm=40;bpm<=240;bpm+=.25){
    const lag=60*rate/bpm;let corr=0,energy=0
    for(let i=Math.ceil(lag);i<n;i++){const j=i-lag,k=Math.floor(j),v=env[k]*(1-j+k)+(env[k+1]||0)*(j-k);corr+=env[i]*v;energy+=env[i]*env[i]}
    candidates.push({bpm,score:corr/Math.max(.001,energy),phase:0})
  }
  const quarters=numerator*4/denominator,intervals=visualBars.slice(1).map((t,i)=>t-visualBars[i]).filter(t=>t>.5&&t<12)
  for(const c of candidates)if(intervals.length>=2){const matches=intervals.filter(t=>Math.abs(t*c.bpm/60-quarters)<quarters*.12).length/intervals.length;c.score+=matches*.45}
  candidates.sort((a,b)=>b.score-a.score)
  const best:TempoCandidate[]=[]
  for(const c of candidates)if(best.every(b=>Math.abs(b.bpm-c.bpm)>3)){best.push(c);if(best.length===5)break}
  for(const c of best){const period=60*rate/c.bpm;let score=-1,phase=0;for(let p=0;p<period;p++){let s=0,count=0;for(let i=p;i<n;i+=period){s+=env[Math.round(i)]||0;count++}s/=count;if(s>score){score=s;phase=p}}c.phase=start+phase/rate}
  const chosen=best[0],period=60/chosen.bpm,beats:number[]=[];let supported=0
  for(let t=chosen.phase;t<end;t+=period){let peak=0,at=t;const center=Math.round((t-start)*rate),radius=Math.max(1,Math.round(period*rate*.15));for(let i=Math.max(0,center-radius);i<Math.min(n,center+radius+1);i++)if(env[i]>peak){peak=env[i];at=start+i/rate}if(peak>.18)supported++;beats.push(peak>.18?at:t)}
  if(beats.length<5)throw new Error('节拍样本不足，请延长分析范围。')
  const confidence=Math.min(.95,Math.max(0,chosen.score)*.55+supported/beats.length*.4)
  const consistent=intervals.filter(t=>Math.abs(t*chosen.bpm/60-quarters)<quarters*.15)
  let bars:number[]=[],run:number[]=[]
  if(consistent.length>=2)for(const time of visualBars){
    if(run.length&&Math.abs((time-run[run.length-1])*chosen.bpm/60-quarters)>quarters*.15){if(run.length>bars.length)bars=run;run=[]}
    run.push(time)
  }
  if(run.length>bars.length)bars=run
  if(bars.length<3)bars=[]
  // Local onset support warns about drift; never silently assume every onset is a downbeat.
  const gaps=beats.slice(1).map((t,i)=>t-beats[i]);const variable=gaps.filter(g=>Math.abs(g-period)>period*.16).length>gaps.length*.25
  return {bpm:chosen.bpm,confidence,candidates:best,beats,bars,visualBars:visualBars.length,variable,start,end,numerator,denominator}
}

export function visualBarTimes(frames:ScoreFrame[]):number[]{
  const times:number[]=[]
  for(const frame of frames){if(frame.anchors.length<3||frame.anchors.some(a=>a.manual))continue
    const a=frame.anchors[0],b=frame.anchors[frame.anchors.length-1]
    for(const x of frame.barLines||[])if(x>=a.x&&x<=b.x)times.push(timeAtPosition(frame,b.time,x))
  }
  return times.sort((a,b)=>a-b).filter((t,i,a)=>i===0||t-a[i-1]>.3)
}

/** Only infer spacing when no cursor was seen. Such anchors remain explicitly estimated. */
export function alignEstimatedRows(frames:ScoreFrame[],result:AnalysisResult){
  for(let i=0;i<frames.length;i++){
    const f=frames[i];if(f.anchors.length>=2||f.anchors.some(a=>a.manual))continue
    const end=frames[i+1]?.time??result.end,beats=result.beats.filter(t=>t>=f.time&&t<end)
    if(beats.length<2)continue
    const bars=f.barLines||[],left=bars.length>=2?bars[0]:.03,right=bars.length>=2?bars[bars.length-1]:.97
    f.anchors=beats.map((time,j)=>({time,x:left+(right-left)*j/(beats.length-1),source:'audio-estimate' as const}))
  }
}
