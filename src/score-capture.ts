import {CropRegion,validCrop,detectScoreCursor,neutralizeScoreColors} from './score-model'
import {detectBarLines} from './score-analysis'
import {InkMask,inkMask} from './score-segment'
import {CursorBox,ScrollKeyframe,detectCursorBox,detectSystems} from './score-scroll'

function sourceRect(video:HTMLVideoElement,crop:CropRegion){
  if(!validCrop(crop))throw new Error('裁剪范围无效，请重新框选谱面。')
  if(video.readyState<2||!video.videoWidth)throw new Error('视频尚未加载画面，请先播放片刻。')
  const sx=Math.round(crop.left*video.videoWidth),sy=Math.round(crop.top*video.videoHeight)
  return {sx,sy,sw:Math.max(1,Math.round((crop.right-crop.left)*video.videoWidth)),sh:Math.max(1,Math.round((crop.bottom-crop.top)*video.videoHeight))}
}
function readPixels(ctx:CanvasRenderingContext2D,w:number,h:number){
  try{return ctx.getImageData(0,0,w,h)}catch{throw new Error('该视频不允许读取画面，无法截图。请尝试普通 B 站视频或导入已有谱图。')}
}

/** Full-resolution picture of one row; only taken when a row is kept. */
export function captureScore(video:HTMLVideoElement,crop:CropRegion,clean:boolean) {
  const {sx,sy,sw,sh}=sourceRect(video,crop)
  const canvas=document.createElement('canvas');canvas.width=Math.min(1600,sw);canvas.height=Math.max(1,Math.round(sh*canvas.width/sw))
  const ctx=canvas.getContext('2d',{willReadFrequently:true})!
  ctx.drawImage(video,sx,sy,sw,sh,0,0,canvas.width,canvas.height)
  const pixels=readPixels(ctx,canvas.width,canvas.height)
  const cursor=detectScoreCursor(pixels.data,canvas.width,canvas.height)
  const barLines=detectBarLines(pixels.data,canvas.width,canvas.height)
  if(clean){
    // Keep pale staff lines: only neutralize strongly coloured highlights.
    neutralizeScoreColors(pixels.data)
    ctx.putImageData(pixels,0,0)
  }
  return {image:canvas.toDataURL('image/png'),width:canvas.width,height:canvas.height,cursor,barLines}
}
export type ScoreShot = ReturnType<typeof captureScore>

/**
 * 滚动谱的关键帧：截一次全分辨率画面，按谱表切行；只有新出现的完整行才编码成图片。
 */
export function captureKeyframe(video:HTMLVideoElement,crop:CropRegion,clean:boolean):ScrollKeyframe<ScoreShot> {
  const {sx,sy,sw,sh}=sourceRect(video,crop)
  const canvas=document.createElement('canvas');canvas.width=Math.min(1600,sw);canvas.height=Math.max(1,Math.round(sh*canvas.width/sw))
  const ctx=canvas.getContext('2d',{willReadFrequently:true})!
  ctx.drawImage(video,sx,sy,sw,sh,0,0,canvas.width,canvas.height)
  const w=canvas.width,h=canvas.height,raw=readPixels(ctx,w,h).data
  return {bands:detectSystems(raw,w,h),crop:band=>{
    const y0=Math.max(0,Math.floor(band.top*h)),y1=Math.min(h,Math.ceil(band.bottom*h)),bh=Math.max(1,y1-y0)
    const part=raw.slice(y0*w*4,(y0+bh)*w*4)
    const cursor=detectScoreCursor(part,w,bh),barLines=detectBarLines(part,w,bh)
    if(clean)neutralizeScoreColors(part)
    const out=document.createElement('canvas');out.width=w;out.height=bh
    out.getContext('2d')!.putImageData(new ImageData(part,w,bh),0,0)
    return {image:out.toDataURL('image/png'),width:w,height:bh,cursor,barLines}
  }}
}

/** Small, reusable analysis canvas: cheap enough to inspect every presented frame. */
export class FrameSampler {
  private canvas=document.createElement('canvas')
  private ctx=this.canvas.getContext('2d',{willReadFrequently:true})!
  constructor(private crop:CropRegion){}
  private size(sw:number,sh:number){
    const scale=Math.min(1,480/sw,270/sh),w=Math.max(16,Math.round(sw*scale)),h=Math.max(8,Math.round(sh*scale))
    if(this.canvas.width!==w||this.canvas.height!==h){this.canvas.width=w;this.canvas.height=h}
    return {w,h}
  }
  sample(video:HTMLVideoElement):{mask:InkMask;cursor:number|null;box:CursorBox|null}{
    const {sx,sy,sw,sh}=sourceRect(video,this.crop),{w,h}=this.size(sw,sh)
    this.ctx.drawImage(video,sx,sy,sw,sh,0,0,w,h)
    const data=readPixels(this.ctx,w,h).data,cursor=detectScoreCursor(data,w,h)
    return {mask:inkMask(data,w,h,cursor),cursor,box:detectCursorBox(data,w,h)}
  }
  /** Mask of an already saved row at the same analysis size, or null if the crop changed since. */
  async maskOf(video:HTMLVideoElement,image:string,imageWidth:number,imageHeight:number):Promise<InkMask|null>{
    const {sw,sh}=sourceRect(video,this.crop)
    if(Math.abs(imageWidth/imageHeight-sw/sh)>.03*sw/sh)return null
    const img=new Image();img.src=image;await img.decode()
    const {w,h}=this.size(sw,sh);this.ctx.drawImage(img,0,0,w,h)
    const data=readPixels(this.ctx,w,h).data
    return inkMask(data,w,h,detectScoreCursor(data,w,h))
  }
}

export async function seekFrame(video:HTMLVideoElement,time:number,signal:AbortSignal) {
  if(signal.aborted)throw new DOMException('已停止','AbortError')
  if(Math.abs(video.currentTime-time)>.01||video.readyState<2)await new Promise<void>((resolve,reject)=>{
    const finish=(error?:Error)=>{clearTimeout(timer);video.removeEventListener('seeked',ready);signal.removeEventListener('abort',abort);error?reject(error):resolve()}
    const ready=()=>video.readyState>=2&&finish()
    const abort=()=>finish(new DOMException('已停止','AbortError'))
    const timer=setTimeout(()=>finish(new Error(`跳转到 ${time.toFixed(2)} 秒超时，请等待视频加载后重试。`)),12000)
    video.addEventListener('seeked',ready);signal.addEventListener('abort',abort,{once:true});video.currentTime=time
  })
  await new Promise<void>((resolve,reject)=>{
    let frameId=0
    const finish=(error?:Error)=>{clearTimeout(timer);if(frameId)video.cancelVideoFrameCallback(frameId);signal.removeEventListener('abort',abort);error?reject(error):resolve()}
    const abort=()=>finish(new DOMException('已停止','AbortError'))
    const timer=setTimeout(()=>finish(),180)
    signal.addEventListener('abort',abort,{once:true})
    if(video.requestVideoFrameCallback)frameId=video.requestVideoFrameCallback(()=>finish())
  })
  if(signal.aborted)throw new DOMException('已停止','AbortError')
}

export interface PlayScanOptions {
  start:number; end:number; rate:number; signal:AbortSignal
  /** Called with the media time of every presented frame. */
  onFrame:(time:number)=>void
  /** Called about every 20ms while playing (audio sampling). */
  onTick?:(time:number)=>void
  onPlay?:()=>Promise<void>
}
/**
 * Play the range once instead of seeking sample by sample: far faster on
 * B站 DASH streams and every row change is seen at frame precision.
 * Always resolves with how far it got, so partial results can be kept.
 */
export async function playScan(video:HTMLVideoElement,o:PlayScanOptions):Promise<{time:number;error?:Error}>{
  let reached=o.start
  try{
    await seekFrame(video,o.start,o.signal)
    video.playbackRate=o.rate
    await video.play()
    await o.onPlay?.()
  }catch(error){video.pause();return {time:reached,error:error as Error}}
  return new Promise(resolve=>{
    let last=video.currentTime,progressAt=performance.now(),frameId=0,done=false
    const finish=(error?:Error)=>{
      if(done)return;done=true;clearInterval(timer);if(frameId)video.cancelVideoFrameCallback(frameId)
      o.signal.removeEventListener('abort',abort);video.pause();resolve({time:Math.min(o.end,reached),error})
    }
    const abort=()=>finish(new DOMException('已停止，已抄部分会保留。','AbortError'))
    const handle=(t:number)=>{
      if(done||t<=reached+1e-4)return
      if(t>=o.end){reached=o.end;finish();return}
      try{o.onFrame(t);reached=t}catch(error){finish(error as Error)}
    }
    const onVideoFrame=(_now:number,meta:VideoFrameCallbackMetadata)=>{if(done)return;handle(meta.mediaTime);if(!done)frameId=video.requestVideoFrameCallback(onVideoFrame)}
    if(video.requestVideoFrameCallback)frameId=video.requestVideoFrameCallback(onVideoFrame)
    const timer=setInterval(()=>{
      try{
        const t=video.currentTime
        if(document.hidden)throw new Error('请保持视频标签页在前台，抄谱已停止，已抄部分会保留。')
        if(Math.abs(video.playbackRate-o.rate)>.001)throw new Error('抄谱期间播放速度被修改，已停止，已抄部分会保留。')
        if(t<last-.25||t-last>Math.max(1,o.rate*.8))throw new Error('检测到手动跳转，已停止，已抄部分会保留。')
        if(t>=o.end-.02||video.ended){handle(t);reached=Math.max(reached,Math.min(o.end,t));finish();return}
        if(t>last+.001){o.onTick?.(t);progressAt=performance.now();if(!video.requestVideoFrameCallback&&t-reached>=.06)handle(t);last=t}
        else if(video.paused)throw new Error('视频被暂停，抄谱已停止，已抄部分会保留。')
        if(performance.now()-progressAt>20000)throw new Error('缓冲超过20秒，已停止，已抄部分会保留。可降低抄谱速度后重抄剩余部分。')
      }catch(error){finish(error as Error)}
    },20)
    o.signal.addEventListener('abort',abort,{once:true});if(o.signal.aborted)abort()
  })
}

export async function scoreRequest(type:string,key:string,value?:unknown) {
  const result=await chrome.runtime.sendMessage({type:'barline-score-'+type,key,value})
  if(!result?.ok)throw new Error(result?.error||'谱面存储不可用，请重新加载扩展和视频页。')
  return result.value
}
export function downloadScore(data:Blob,name:string) {
  const url=URL.createObjectURL(data),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),30000)
}
