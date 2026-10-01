export interface ScoreAnchor { time: number; x: number; manual?: boolean; source?: 'audio-estimate'|'bar-estimate' }
export interface ScoreFrame { id: string; time: number; image: string; width: number; height: number; anchors: ScoreAnchor[]; barLines?:number[]; end?:number }
export interface CropRegion { left: number; top: number; right: number; bottom: number }
export const defaultCrop: CropRegion = {left:0, top:0, right:1, bottom:.43}
export function validCrop(c: CropRegion) {
  return Object.values(c).every(Number.isFinite) && c.left >= 0 && c.top >= 0 && c.right <= 1 && c.bottom <= 1 && c.right-c.left >= .02 && c.bottom-c.top >= .02
}
export function activeScore(frames: ScoreFrame[], time: number): number {
  if (!frames.length || time < frames[0].time) return -1
  let lo=0, hi=frames.length
  while(lo<hi){const mid=(lo+hi)>>>1;if(frames[mid].time<=time)lo=mid+1;else hi=mid}
  return lo-1
}
export function scorePosition(frame: ScoreFrame, end: number, time: number) {
  const anchors=[...frame.anchors].sort((a,b)=>a.time-b.time)
  if (anchors.length >= 2) {
    if(time<=anchors[0].time)return anchors[0].x
    for(let i=1;i<anchors.length;i++)if(time<=anchors[i].time){const a=anchors[i-1],b=anchors[i];return a.x+(b.x-a.x)*(time-a.time)/(b.time-a.time)}
    return anchors[anchors.length-1].x
  }
  return Math.max(0,Math.min(1,(time-frame.time)/Math.max(.001,end-frame.time)))
}
export function timeAtPosition(frame:ScoreFrame,end:number,x:number) {
  const anchors=[...frame.anchors].sort((a,b)=>a.x-b.x)
  if(anchors.length>=2){
    if(x<=anchors[0].x)return anchors[0].time
    for(let i=1;i<anchors.length;i++)if(x<=anchors[i].x){const a=anchors[i-1],b=anchors[i];return a.time+(b.time-a.time)*(x-a.x)/Math.max(.00001,b.x-a.x)}
    return anchors[anchors.length-1].time
  }
  return frame.time + Math.max(0,Math.min(1,x))*Math.max(0,end-frame.time)
}
export function addAnchor(frame:ScoreFrame,anchor:ScoreAnchor) {
  if(!Number.isFinite(anchor.time)||anchor.time<frame.time||!Number.isFinite(anchor.x)||anchor.x<0||anchor.x>1)throw new Error('校准时间或位置无效')
  // A manual correction replaces automatic estimates for this row.
  const existing=anchor.manual?frame.anchors.filter(a=>a.manual):frame.anchors
  const anchors=[...existing.filter(a=>Math.abs(a.time-anchor.time)>.03),anchor].sort((a,b)=>a.time-b.time)
  for(let i=1;i<anchors.length;i++)if(anchors[i].x<=anchors[i-1].x)throw new Error('同一行的校准点需随时间从左向右；换行处请补截一张谱图。')
  return anchors
}
export function neutralizeScoreColors(rgba:Uint8ClampedArray) {
  for(let p=0;p<rgba.length;p+=4){const r=rgba[p],g=rgba[p+1],b=rgba[p+2],max=Math.max(r,g,b),min=Math.min(r,g,b);const tone=max-min>40&&max>140?255:Math.round(.299*r+.587*g+.114*b);rgba[p]=rgba[p+1]=rgba[p+2]=tone}
  return rgba
}
/** Detect a narrow coloured playback cursor (any hue), not a broad highlighted measure. */
export function detectScoreCursor(data:Uint8ClampedArray,width:number,height:number):number|null {
  const counts=new Uint16Array(width)
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){
    const p=(y*width+x)*4,r=data[p],g=data[p+1],b=data[p+2],max=Math.max(r,g,b)
    if((g-r>35&&b-r>30)||(g-r>55&&g-b>30)||(max>120&&max-Math.min(r,g,b)>70))counts[x]++
  }
  let best=-1,score=0
  for(let x=0;x<width;x++)if(counts[x]>height*.3&&counts[x]>score){
    let l=x,r=x;while(l>0&&counts[l-1]>height*.25)l--;while(r<width-1&&counts[r+1]>height*.25)r++
    if(r-l<=Math.max(4,width*.035)){score=counts[x];best=x}
  }
  return best<0?null:best/Math.max(1,width-1)
}
