import type {ScoreFrame} from './score-model'
import type {BarConfig} from './config'
export function excerptFrames(frames:ScoreFrame[],start:number,end:number,videoEnd:number):ScoreFrame[]{
  if(!Number.isFinite(start)||!Number.isFinite(end)||start<0||end<=start||end>videoEnd+.05)throw new Error('练习片段起止时间无效')
  return frames.filter((f,i)=>f.time<end&&(f.end??frames[i+1]?.time??videoEnd)>start).map(f=>{
    const i=frames.indexOf(f);return {...f,end:f.end??frames[i+1]?.time??videoEnd,anchors:f.anchors.map(a=>({...a}))}
  })
}
export interface Practice {id:string;kind:'practice';title:string;originKey:string;url:string;start:number;end:number;frames:ScoreFrame[];config:BarConfig|null;bpm:number|null;verified:boolean;createdAt:number}
export class PracticePlayback {
  private timer=0;private frame=0;private generation=0;private restore:(()=>void)|null=null
  constructor(private video:HTMLVideoElement,private onStop:()=>void){}
  async play(start:number,end:number,loop:boolean,suspend:()=>()=>void){
    this.stop();const token=++this.generation,v=this.video,rate=v.playbackRate
    const unmute=suspend();v.playbackRate=1;this.restore=()=>{v.playbackRate=rate;unmute()}
    let seeking=false
    const check=()=>{
      if(token!==this.generation)return
      if(v.currentTime>=end||v.ended){
        v.pause()
        if(loop&&!seeking){seeking=true;v.currentTime=start;void v.play().then(()=>{seeking=false}).catch(()=>this.stop())}
        else if(!loop){v.currentTime=end;this.stop();return}
      }else if(v.currentTime<start-.1||v.playbackRate!==1){v.pause();this.stop();return}
    }
    const tick=()=>{check();if(token===this.generation&&v.requestVideoFrameCallback)this.frame=v.requestVideoFrameCallback(tick)}
    v.pause();v.currentTime=start
    try{await v.play();if(token!==this.generation)return;this.timer=window.setInterval(()=>{if(v.paused&&!seeking)return;check()},15);tick()}
    catch(e){this.stop();throw e}
  }
  stop(){this.generation++;clearInterval(this.timer);if(this.frame)this.video.cancelVideoFrameCallback(this.frame);this.frame=0;this.restore?.();this.restore=null;this.onStop()}
}
