import type {Onset} from './score-analysis'

const HOP=256

/**
 * Onset strength from raw audio blocks: every 256 samples (~5 ms) the energy of
 * the first difference (emphasises attacks) is compared with the previous hop.
 * Timestamps come from the audio clock, mapped to video time with an offset
 * measured while playing, instead of the ~20 ms jitter of polling a timer.
 */
export class OnsetDetector {
  readonly onsets:Onset[]=[]
  private last=0
  private previous=0
  private carry:number[]=[]
  constructor(private sampleRate:number){}
  /** `startTime` is the video time of samples[0]. */
  push(samples:Float32Array,startTime:number){
    const offset=this.carry.length
    const data=offset?Float32Array.from([...this.carry,...samples]):samples
    let i=0
    for(;i+HOP<=data.length;i+=HOP){
      let energy=0
      for(let j=i;j<i+HOP;j++){const d=data[j]-(j>0?data[j-1]:this.last);energy+=d*d}
      const level=Math.log10(1e-10+energy/HOP)
      const strength=Math.max(0,level-this.previous)
      this.previous=level
      this.onsets.push({time:startTime+(i-offset)/this.sampleRate,strength})
    }
    this.last=data[data.length-1]??0
    this.carry=Array.from(data.subarray(i))
  }
}

/** Tap a cloned media stream: never replace the player's audio routing. */
export class AudioOnsets {
  context:AudioContext
  private streams:MediaStream[]=[]
  private source:MediaStreamAudioSourceNode|null=null
  private processor:ScriptProcessorNode|null=null
  private gain:GainNode|null=null
  private detector:OnsetDetector|null=null
  /** Recent samples of (video time − audio clock time). */
  private offsets:number[]=[]
  constructor(){this.context=new AudioContext();void this.context.resume()}
  get onsets():Onset[]{return this.detector?.onsets??[]}
  async connect(video:HTMLVideoElement){
    const media=[video,...Array.from(document.querySelectorAll('audio')).filter(a=>!a.paused&&Math.abs(a.currentTime-video.currentTime)<1)]
    for(const element of media){
      try{
        const stream=(element as HTMLMediaElement & {captureStream():MediaStream}).captureStream();this.streams.push(stream)
        if(!stream.getAudioTracks().length)continue
        const ctx=this.context
        this.source=ctx.createMediaStreamSource(new MediaStream(stream.getAudioTracks()))
        this.processor=ctx.createScriptProcessor(2048,2,1)
        this.gain=ctx.createGain();this.gain.gain.value=0
        this.detector=new OnsetDetector(ctx.sampleRate)
        this.processor.onaudioprocess=e=>{
          if(!this.offsets.length)return
          const input=e.inputBuffer,n=input.length,mono=new Float32Array(n)
          for(let c=0;c<input.numberOfChannels;c++){const ch=input.getChannelData(c);for(let i=0;i<n;i++)mono[i]+=ch[i]/input.numberOfChannels}
          // Constant processing latency only shifts the phase, never the tempo.
          const blockStart=e.playbackTime-2*n/ctx.sampleRate
          this.detector!.push(mono,blockStart+this.offset())
        }
        this.source.connect(this.processor);this.processor.connect(this.gain);this.gain.connect(ctx.destination)
        await ctx.resume();return
      }catch{/* Try the associated separate audio element. */}
    }
    throw new Error('播放器未提供可读取的音轨。请先播放片刻再试；仍失败可使用普通抄谱和手动小节定速。')
  }
  private offset(){const s=[...this.offsets].sort((a,b)=>a-b);return s[s.length>>1]}
  /** Called while playing at 1×: pairs the video clock with the audio clock. */
  sample(videoTime:number){
    this.offsets.push(videoTime-this.context.currentTime)
    if(this.offsets.length>61)this.offsets.shift()
  }
  async close(){
    if(this.processor)this.processor.onaudioprocess=null
    this.source?.disconnect();this.processor?.disconnect();this.gain?.disconnect()
    for(const s of this.streams)for(const t of s.getTracks())t.stop()
    if(this.context.state!=='closed')await this.context.close()
  }
}
