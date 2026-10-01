<template>
  <section v-show="visible" class="barline-score-panel barline-ui" :class="{locked}" :style="panelStyle" aria-label="谱窗">
    <header @pointerdown="dragPanel">
      <div class="sp-title"><span class="sp-logo" aria-hidden="true">♪</span><strong>音乐小节线</strong><span :class="['sp-sub',{set:!!barConfig}]">{{ tempoSummary }}</span></div>
      <div class="sp-head-actions">
        <button class="sp-toggle" :class="{on:follow}" :aria-pressed="follow" @click="follow=!follow;queueSave()" title="播放时自动滚动到当前谱行">跟随</button>
        <button class="sp-toggle" :class="{on:locked}" :aria-pressed="locked" @click="locked=!locked;queueSave()" title="锁定面板位置和大小">锁定</button>
        <button class="sp-icon" @click="closePanel" title="收起面板" aria-label="收起面板">×</button>
      </div>
    </header>

    <nav class="sp-tabs" role="tablist">
      <button v-for="t in tabs" :key="t.id" role="tab" :aria-selected="tab===t.id" :class="{active:tab===t.id}" @click="toggleTab(t.id)">
        {{ t.label }}<em v-if="t.badge">{{ t.badge }}</em>
      </button>
      <span class="sp-push"></span>
      <button v-if="tab && shownFrames.length" class="sp-icon small sp-expand" @click="expanded=!expanded" :title="expanded?'恢复谱面区域':'展开到整个面板'" :aria-label="expanded?'恢复谱面区域':'展开到整个面板'">
        <svg v-if="expanded" viewBox="0 0 16 16" aria-hidden="true"><path d="M6 2v4H2M10 14v-4h4M2 6l4-4M14 10l-4 4" /></svg>
        <svg v-else viewBox="0 0 16 16" aria-hidden="true"><path d="M2 6V2h4M14 10v4h-4M2 2l5 5M14 14l-5-5" /></svg>
      </button>
      <button v-if="tab" class="sp-icon small" @click="tab='';expanded=false" title="收起功能区" aria-label="收起功能区">
        <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 10l4-4 4 4" /></svg>
      </button>
    </nav>

    <div v-show="tab" class="sp-drawer" :class="{tall:!shownFrames.length || expanded}">
      <div v-show="tab==='bars'" class="sp-bars">
        <section class="ble-card sp-auto">
          <div class="ble-card-head">
            <h3>从谱面自动对齐</h3>
            <span v-if="barAlign && barAlign.candidates" class="bl-tag" :class="barAlign.aligned ? 'ok' : 'warn'">{{ barAlign.aligned }} / {{ barAlign.candidates }} 行</span>
          </div>
          <template v-if="barAlign && barAlign.candidates">
            <p class="bl-note">按识别到的小节线，把每行的时长平均分给各小节；定位线和节拍网格都由此得出。{{ barAlign.leadMeasured ? `已根据光标／校准行测得视频提前 ${barAlign.lead.toFixed(2)} 秒显示谱行，并修正了全部估算行。` : '在任意一行「校准」两个点，其余行会按它整体修正。' }}</p>
            <details v-if="skippedRows.length" class="sp-skipped"><summary>{{ skippedRows.length }} 行未对齐（保持均匀估算）</summary><ul><li v-for="row in skippedRows" :key="row.index"><b>第 {{ row.index + 1 }} 行</b>{{ row.reason }}</li></ul></details>
            <div class="bl-row">
              <label class="bl-field sp-inline-field">拍号<span class="bl-input-group"><input aria-label="每小节拍数" type="number" min="1" max="32" v-model.number="form.numerator" :disabled="busy" /><b>/</b><select aria-label="拍号分母" v-model.number="form.denominator" :disabled="busy"><option v-for="d in [2,4,8,16]" :key="d" :value="d">{{ d }}</option></select></span></label>
              <span v-if="alignBpm" class="sp-bpm"><b>{{ alignBpm.toFixed(1) }}</b> BPM</span>
              <span class="sp-push"></span>
              <button class="ghost" @click="realign(true)" :disabled="busy">重新对齐</button>
              <button class="primary" @click="applyBarGridToMetronome" :disabled="busy || !barAlign || barAlign.bars.length < 3" title="把对齐得到的小节网格写入节拍器（变速处自动分段）">应用到节拍器</button>
            </div>
          </template>
          <template v-else>
            <p class="bl-note">{{ frames.length ? '这些谱行没有识别到贯穿谱线的小节线，无法自动对齐，可用下方「小节定速」手动设置。' : '先抄谱，插件会根据谱面上的小节线自动推算每个小节的时间和 BPM，不需要手动标记。' }}</p>
            <div v-if="!frames.length" class="bl-row"><button class="primary" @click="toggleTab('capture')">去抄谱</button></div>
          </template>
          <div v-if="analysis" class="sp-audio">
            <div class="bl-row"><b>音频分析</b><span class="sp-bpm"><b>{{ analysis.bpm.toFixed(1) }}</b> BPM</span><em :class="['bl-tag',confidenceClass]">{{ confidenceLabel }}可信度</em><span class="sp-push"></span><button class="small ghost" @click="exportTimeline" :disabled="busy">导出时间轴</button><button class="small" @click="applyAnalysis" :disabled="busy || !!practiceFrames">应用</button></div>
            <div class="bl-row"><span class="bl-muted">候选</span><button v-for="candidate in analysis.candidates.slice(0,3)" :key="candidate.bpm" class="small" :class="{active:candidate.bpm===analysis.bpm}" @click="chooseTempo(candidate.bpm)" :disabled="busy">{{ candidate.bpm.toFixed(1) }}</button><span class="bl-muted">{{ analysis.variable ? '可能存在变速' : '' }}</span></div>
          </div>
        </section>
        <BarLineEditor ref="editor" embedded :video="video" :initial="barConfig || defaultConfig" :has-config="!!barConfig" :revision="barRevision"
          :on-preview="previewConfig" :on-temp-mute="tempMuteMetronome" :on-delete="deleteCurrentConfig" />
      </div>
      <ScoreCaptureForm v-show="tab==='capture'" :form="form" :preview="preview" :crop-style="cropStyle" :crop-check="cropCheck" :busy="busy" :disabled="!!practiceFrames" :hint="scanHint" :clock="clock"
        @crop-start="startCrop" @crop-preset="setCrop" @refresh="refreshPreview()" @set-range="setRange" @now="setNow" @range="setQuickRange" @start="scan()" @import="importImages" />
      <ScoreChapters v-show="tab==='chapters'" :chapters="chapters" :video="video" :busy="busy" :current-id="currentChapter && currentChapter.id" :clock="clock"
        @change="chapters=$event;queueSave()" @jump="jumpChapter" @status="say" />
      <PracticePanel v-show="tab==='practice'" :video="video" :frames="framesForPractice" :chapters="chapters" :key-id="keyId" :busy="busy" @status="say" @select="selectPractice" @open="tab='practice'" />
      <BarLineManager v-if="tab==='library'" embedded :current-key="barKey" />
    </div>
    <div v-if="scanning" class="sp-progress"><span><i :style="{width:(progress*100)+'%'}"></i></span><button class="small" @click="stopCapture">停止并保留</button></div>
    <p v-if="status" :class="['sp-status',statusKind]" role="status"><span>{{ status }}</span><button class="sp-icon small" @click="status=''" aria-label="关闭提示">×</button></p>

    <div v-if="chapters.length" class="sp-chapter-strip" aria-label="段落导航">
      <button v-for="chapter in chapters" :key="chapter.id" class="bl-chip" :style="{'--chip':chapter.color}" :class="{active:currentChapter && currentChapter.id===chapter.id}" @click="jumpChapter(chapter)" :disabled="busy" :title="clock(chapter.time)">{{ chapter.name }}</button>
    </div>

    <div v-if="shownFrames.length || calibrating" class="sp-now">
      <template v-if="calibrating"><b class="warn">校准中</b>暂停在某个音符／小节线上，再点击谱图中对应位置；每行至少两点。</template>
      <template v-else-if="practiceFrames"><b>练习谱面</b>{{ active >= 0 ? `第 ${active+1} 行 · ${clock(time)}` : clock(time) }}</template>
      <template v-else-if="active >= 0"><b>第 {{ active + 1 }} / {{ shownFrames.length }} 行</b>{{ clock(time) }}<span :class="['bl-tag',modeClass(shownFrames[active])]">{{ rowMode(shownFrames[active]) }}</span></template>
      <template v-else>{{ frames.length ? '当前时间没有对应谱行' : '还没有谱面' }}</template>
      <span class="sp-offset" title="定位线整体提前或延后（例如蓝牙耳机延迟、视频音画不同步）">
        <button class="ghost small" @click="nudgeOffset(-20)" aria-label="定位线提前 20 毫秒">−</button>
        <button class="ghost small sp-offset-value" @click="form.offset=0" :title="form.offset ? '点击归零' : '定位线偏移'">{{ form.offset > 0 ? '+' : '' }}{{ form.offset }} ms</button>
        <button class="ghost small" @click="nudgeOffset(20)" aria-label="定位线延后 20 毫秒">＋</button>
      </span>
    </div>

    <div class="score-pages" ref="pages">
      <article v-for="(frame,index) in shownFrames" :key="frame.id" :class="['score-frame', {active:index===active}]">
        <div class="score-row-tools">
          <b class="sp-row-no">{{ index + 1 }}</b>
          <input :aria-label="`第${index+1}行起始时间`" :value="clock(frame.time)" @change="changeTime(frame,$event)" :disabled="busy || !!practiceFrames" :title="'起始 '+frame.time.toFixed(3)+' 秒，可输入 m:ss 或秒数'" />
          <span class="sp-row-range">– {{ clock(frameEnd(index)) }}</span>
          <span :class="['bl-tag',modeClass(frame)]">{{ rowMode(frame) }}</span>
          <span class="sp-row-actions">
            <button class="ghost small" @click="video.currentTime=frame.time" :disabled="busy" title="跳到这一行">跳转</button>
            <template v-if="!practiceFrames">
              <button class="ghost small" @click="setStartNow(frame)" :disabled="busy" title="把这一行的起点设为视频当前时间">起点=当前</button>
              <button class="ghost small" @click="rescanRow(index)" :disabled="busy" title="只重新抄写这一行的时间段">重抄</button>
              <button class="ghost small" @click="resetAnchors(frame)" :disabled="busy || !frame.anchors.length" title="清除这一行的定位点">清定位</button>
              <button class="ghost small danger" @click="removeFrame(frame)" :disabled="busy" title="删除这一行">删除</button>
            </template>
          </span>
        </div>
        <div class="score-image-wrap" :class="{calibrating}" @click="clickScore(frame,index,$event)">
          <span v-for="chapter in rowChapters(frame,index)" :key="chapter.id" class="score-chapter-pin" :style="{left:(chapter.x*100)+'%','--chip':chapter.color}" :title="chapter.name+' · '+clock(chapter.time)"><b>{{ chapter.name }}</b></span>
          <img :src="frame.image" :alt="`谱面第 ${index+1} 行`" draggable="false" loading="lazy" />
          <span v-for="anchor in frame.anchors.filter(a=>a.manual)" :key="anchor.time" class="score-anchor" :style="{left:(anchor.x*100)+'%'}" :title="clock(anchor.time)"></span>
          <span v-if="index===active" class="score-playhead" :style="{left:(position*100)+'%'}"><i></i></span>
        </div>
      </article>
      <div v-if="!frames.length && !practiceFrames && !tab" class="sp-empty">
        <b>还没有谱面</b>
        <span>在「抄谱」里框选谱面区域，点「开始抄谱」自动生成；也可以暂停在某一行，点下方「补截」。</span>
        <button class="primary" @click="tab='capture'">去抄谱</button>
      </div>
    </div>

    <footer>
      <button class="sp-play" @click="togglePlay" :disabled="busy" :title="video.paused?'播放':'暂停'">{{ video.paused ? '▶ 播放' : '❚❚ 暂停' }}</button>
      <button @click="captureOne" :disabled="busy || !!practiceFrames" title="把当前画面补成一行谱面">补截</button>
      <button class="sp-toggle" :class="{on:calibrating}" :aria-pressed="calibrating" @click="calibrating=!calibrating" :disabled="!!practiceFrames || !frames.length" title="点击谱图绑定当前视频时间">校准</button>
      <span class="sp-push"></span>
      <span class="sp-menu" :class="{open:menuOpen}">
        <button class="ghost" @click.stop="menuOpen=!menuOpen" :aria-expanded="menuOpen">导出 ▾</button>
        <span class="sp-menu-list" @click="menuOpen=false">
          <button @click="exportPng" :disabled="!shownFrames.length || busy">导出长图 PNG</button>
          <button @click="printScore" :disabled="!shownFrames.length || busy">PDF / 打印</button>
          <button @click="exportBackup" :disabled="(!frames.length && !chapters.length) || busy">下载备份</button>
          <button @click="importBackup" :disabled="busy || !!practiceFrames">恢复备份…</button>
        </span>
      </span>
      <span class="sp-count">{{ frames.length }} 行</span>
    </footer>
    <div v-if="!locked" class="score-resize" @pointerdown="resizePanel" title="拖动调整谱窗大小"></div>
  </section>
</template>

<script lang="ts">
import Vue from 'vue'
import {ScoreFrame,ScoreAnchor,CropRegion,defaultCrop,validCrop,activeScore,scorePosition,timeAtPosition,addAnchor} from './score-model'
import {captureScore,ScoreShot,FrameSampler,playScan,seekFrame,scoreRequest,downloadScore} from './score-capture'
import {ScoreSegmenter,ScanRow,InkMask,sensitivities,defaultSegmentOptions,fitCursorAnchors,mergeScanned} from './score-segment'
import {AnalysisResult,analyzeTempo,visualBarTimes,alignEstimatedRows} from './score-analysis'
import {AudioOnsets} from './score-audio'
import {applyAnalyzedTempo,applyBarGrid,suspendForScoreAnalysis,onBarState,previewConfig,tempMuteMetronome,deleteCurrentConfig} from './index'
import {BarAlignResult,autoAlignBars,applyBarAlignment,barGridSegments} from './bar-align'
import {parseTime,BarConfig,DEFAULT_CONFIG} from './config'
import {Chapter,validateChapters,chapterAt} from './score-chapters'
import PracticePanel from './PracticePanel.vue'
import ScoreCaptureForm from './ScoreCaptureForm.vue'
import ScoreChapters from './ScoreChapters.vue'
import BarLineEditor from './BarLineEditor.vue'
import BarLineManager from './BarLineManager.vue'

const crops:Record<string,CropRegion>={top:{left:0,top:0,right:1,bottom:.4},bottom:{left:0,top:.6,right:1,bottom:1},full:{left:0,top:0,right:1,bottom:1}}
const clock=(t:number)=>{if(!Number.isFinite(t))return '--';const d=Math.round(Math.max(0,t)*10);return `${Math.floor(d/600)}:${((d%600)/10).toFixed(1).padStart(4,'0')}`}
type Tab=''|'bars'|'capture'|'chapters'|'practice'|'library'
/** Images already stored by the background, per panel: id → image string. Not reactive on purpose. */
const savedImages=new WeakMap<object,Map<string,string>>()

export default Vue.extend({
  components:{PracticePanel,ScoreCaptureForm,ScoreChapters,BarLineEditor,BarLineManager},
  props:{video:{type:Object,required:true},keyId:{type:String,required:true}},
  data(){return {
    visible:false,locked:false,follow:true,calibrating:false,busy:false,scanning:false,progress:0,ready:false,preview:'',
    status:'',statusKind:'info' as 'info'|'ok'|'warn',tab:'' as Tab,menuOpen:false,
    form:{start:0,end:0,rate:4,sensitivity:'normal',withAudio:false,clean:true,numerator:4,denominator:4,autoApply:true,offset:0},
    barAlign:null as BarAlignResult|null,expanded:false,
    barConfig:null as BarConfig|null,barKey:'',barRevision:0,defaultConfig:DEFAULT_CONFIG,offBar:null as (()=>void)|null,
    cropCheck:null as {ok:boolean;text:string}|null,analysis:null as AnalysisResult|null,
    chapters:[] as Chapter[],practiceFrames:null as ScoreFrame[]|null,practiceKey:'',
    frames:[] as ScoreFrame[],crop:{...defaultCrop} as CropRegion,
    time:0,active:-1,position:0,x:Math.max(10,window.innerWidth-590),y:90,width:570,height:Math.min(720,window.innerHeight-110),
    controller:null as AbortController|null,raf:0,saveTimer:0,saveChain:Promise.resolve() as Promise<unknown>,dead:false,dragCleanup:null as (()=>void)|null,
  }},
  computed:{
    shownFrames():ScoreFrame[]{return this.practiceFrames||this.frames},
    framesForPractice():ScoreFrame[]{return this.frames.map((f,i)=>({...f,end:f.end??this.frames[i+1]?.time??this.video.duration}))},
    currentChapter():Chapter|null{return chapterAt(this.chapters,this.time)},
    tabs():{id:Tab;label:string;badge?:string|number}[]{
      return [{id:'bars',label:'小节线'},{id:'capture',label:'抄谱',badge:this.frames.length||''},{id:'chapters',label:'段落',badge:this.chapters.length||''},{id:'practice',label:'练习'},{id:'library',label:'管理'}]
    },
    tempoSummary():string{
      const c=this.barConfig;if(!c)return '未设置节拍'
      const s=c.segments[0],source=c.tempoSource==='manual-bars'?' · 已校准':c.tempoSource==='auto'?' · 自动':''
      return `${Number(s.bpm.toFixed(1))} BPM · ${s.numerator}/${s.denominator}${c.segments.length>1?` · ${c.segments.length} 段`:''}${source}`
    },    alignBpm():number|null{const d=this.barAlign?.barDuration;return d&&this.barAlign!.aligned?60*this.form.numerator*4/this.form.denominator/d:null},
    skippedRows():{index:number;reason:string}[]{return (this.barAlign?.rows||[]).filter(r=>r.reason) as {index:number;reason:string}[]},
    confidenceLabel():string{const c=this.analysis?.confidence??0;return c>=.65?'较高':c>=.4?'中等':'较低'},
    confidenceClass():string{const c=this.analysis?.confidence??0;return c>=.65?'ok':c>=.4?'':'warn'},
    panelStyle():Record<string,string>{return {left:this.x+'px',top:this.y+'px',width:this.width+'px',height:this.height+'px'}},
    cropStyle():Record<string,string>{return {left:this.crop.left*100+'%',top:this.crop.top*100+'%',width:(this.crop.right-this.crop.left)*100+'%',height:(this.crop.bottom-this.crop.top)*100+'%'}},
    scanHint():string{
      const f=this.form,span=Math.max(0,Math.min(f.end,this.videoDuration())-f.start),rate=f.withAudio?1:f.rate
      const replaced=this.frames.filter(r=>r.time>=f.start-.001&&r.time<f.end).length
      return `播放 ${clock(f.start)}–${clock(f.end)}，约 ${Math.ceil(span/rate)} 秒。${replaced?`替换此范围内的 ${replaced} 行，`:''}范围外的谱行保留；结束后回到原进度。`
    },
  },
  watch:{
    video(next:HTMLVideoElement,previous:HTMLVideoElement){this.controller?.abort();previous?.removeEventListener('durationchange',this.initDuration);next.addEventListener('durationchange',this.initDuration);this.initDuration();this.time=next.currentTime},
    form:{deep:true,handler(){this.queueSave()}},
  },
  async mounted(){
    savedImages.set(this,new Map())
    this.offBar=onBarState((state,source)=>{this.barConfig=state.config;this.barKey=state.key;if(source!=='editor')this.barRevision++})
    window.addEventListener('resize',this.clampPanel)
    document.addEventListener('fullscreenchange',this.moveForFullscreen)
    document.addEventListener('pointerdown',this.closeMenu)
    this.video.addEventListener('durationchange',this.initDuration)
    this.form.end=this.videoDuration()
    try{const saved=await scoreRequest('get',this.keyId);if(!this.dead&&saved){
      this.frames=this.validateFrames(saved.frames)
      this.realign()
      for(const f of this.frames)this.stored().set(f.id,f.image)
      this.chapters=validateChapters(saved.chapters)
      this.analysis=this.validateAnalysis(saved.analysis)
      if(this.analysis){this.form.numerator=this.analysis.numerator;this.form.denominator=this.analysis.denominator}
      if(validCrop(saved.crop||{}))this.crop=saved.crop
      this.follow=saved.follow!==false;this.locked=!!saved.locked;this.visible=this.visible||!!saved.visible
      if(saved.geometry){const g=saved.geometry;if([g.x,g.y,g.width,g.height].every(Number.isFinite)){this.x=g.x;this.y=g.y;this.width=g.width;this.height=g.height}}
      const s=saved.settings
      if(s){const f=this.form;f.start=s.start??0;f.end=s.end??f.end;f.clean=s.clean!==false;if([1,2,4].includes(s.rate))f.rate=s.rate;if(s.sensitivity in sensitivities)f.sensitivity=s.sensitivity;f.withAudio=!!s.withAudio;if(typeof s.autoApply==='boolean')f.autoApply=s.autoApply;if(Number.isFinite(s.offset))f.offset=Math.max(-1000,Math.min(1000,s.offset));if(Number.isInteger(s.numerator)&&s.numerator>=1&&s.numerator<=32)f.numerator=s.numerator;if([2,4,8,16].includes(s.denominator))f.denominator=s.denominator}
      this.clampPanel()
    }}catch(error){this.say(String((error as Error).message||error),'warn')}
    if(this.dead)return
    if(!this.frames.length)this.tab='bars'
    await this.$nextTick()
    this.ready=true;this.tick();this.moveForFullscreen()
  },
  beforeDestroy(){
    this.dead=true;this.offBar?.();this.controller?.abort();cancelAnimationFrame(this.raf);clearTimeout(this.saveTimer);this.dragCleanup?.()
    window.removeEventListener('resize',this.clampPanel);document.removeEventListener('fullscreenchange',this.moveForFullscreen);document.removeEventListener('pointerdown',this.closeMenu)
    this.video.removeEventListener('durationchange',this.initDuration)
    if(this.ready&&this.saveTimer)void this.persist().catch(()=>{})
  },
  methods:{
    clock,
    stored():Map<string,string>{return savedImages.get(this)!},
    /** Re-run automatic bar alignment on rows without cursor/manual anchors. Cheap; safe to call after any edit. */
    realign(report=false){
      if(this.practiceFrames)return
      const result=autoAlignBars(this.frames,this.videoDuration())
      applyBarAlignment(this.frames,result)
      this.barAlign=result
      if(report){this.queueSave();this.say(result.candidates?`已按小节对齐 ${result.aligned} / ${result.candidates} 行。`:'没有可按小节对齐的行。',result.aligned?'ok':'warn')}
    },
    applyBarGridToMetronome(){
      try{
        const r=this.barAlign;if(!r)return
        const segments=barGridSegments(r.bars,this.form.numerator,this.form.denominator)
        applyBarGrid(segments)
        this.say(`已把 ${r.bars.length} 个小节写入节拍器：${segments.length>1?`${segments.length} 个速度段，`:''}起始 ${segments[0].bpm.toFixed(1)} BPM（${this.form.numerator}/${this.form.denominator}）。`,'ok')
      }catch(e){this.fail(e)}
    },
    nudgeOffset(ms:number){this.form.offset=Math.max(-1000,Math.min(1000,this.form.offset+ms))},
    say(text:string,kind:'info'|'ok'|'warn'='info'){this.status=text;this.statusKind=kind},
    fail(e:unknown){this.say(e instanceof Error?e.message:String(e),'warn')},
    toggleTab(id:Tab){this.tab=this.tab===id?'':id;if(!this.tab)this.expanded=false;if(this.tab==='capture'){if(!this.preview)this.refreshPreview();else this.checkCrop()}},
    closeMenu(e:Event){if(this.menuOpen&&!(e.target as Element).closest?.('.sp-menu'))this.menuOpen=false},
    selectPractice(frames:ScoreFrame[]|null,id=''){this.practiceFrames=frames;this.practiceKey=id;this.active=-1;this.calibrating=false},
    async openChapters(){await this.open('chapters')},
    jumpChapter(chapter:Chapter){if(!this.busy)this.video.currentTime=chapter.time},
    rowChapters(frame:ScoreFrame,index:number){return this.chapters.filter(c=>c.time>=frame.time&&c.time<this.frameEnd(index)).map(c=>({...c,x:scorePosition(frame,this.frameEnd(index),c.time)}))},
    initDuration(){if(this.form.end<=0&&Number.isFinite(this.video.duration))this.form.end=this.videoDuration()},
    async open(tab?:Tab){this.visible=true;if(tab)this.tab=tab;if(this.tab==='capture'){if(!this.preview)this.refreshPreview();else this.checkCrop()}this.queueSave()},
    closePanel(){this.visible=false;(this.$refs.editor as any)?.resetTemp?.();this.queueSave()},
    previewConfig,tempMuteMetronome,deleteCurrentConfig,
    moveForFullscreen(){const target=document.fullscreenElement||document.body;if(this.$el.parentElement!==target)target.append(this.$el)},
    clampPanel(){this.width=Math.max(340,Math.min(this.width,window.innerWidth-16));this.height=Math.max(300,Math.min(this.height,window.innerHeight-16));this.x=Math.max(8,Math.min(this.x,window.innerWidth-this.width-8));this.y=Math.max(8,Math.min(this.y,window.innerHeight-this.height-8))},
    pointerTrack(event:PointerEvent,move:(e:PointerEvent)=>void,end:()=>void){
      event.preventDefault();event.stopPropagation();this.dragCleanup?.()
      const finish=()=>{window.removeEventListener('pointermove',move);window.removeEventListener('pointerup',finish);window.removeEventListener('pointercancel',finish);this.dragCleanup=null;end()}
      window.addEventListener('pointermove',move);window.addEventListener('pointerup',finish);window.addEventListener('pointercancel',finish);this.dragCleanup=finish
    },
    dragPanel(e:PointerEvent){if(this.locked||(e.target as Element).closest('button,input,label'))return;const x=this.x,y=this.y,sx=e.clientX,sy=e.clientY;this.pointerTrack(e,p=>{this.x=x+p.clientX-sx;this.y=y+p.clientY-sy;this.clampPanel()},()=>this.queueSave())},
    resizePanel(e:PointerEvent){const w=this.width,h=this.height,sx=e.clientX,sy=e.clientY;this.pointerTrack(e,p=>{this.width=w+p.clientX-sx;this.height=h+p.clientY-sy;this.clampPanel()},()=>this.queueSave())},
    nowTime(){return Number(this.video.currentTime.toFixed(2))},
    videoDuration(){return Number.isFinite(this.video.duration)?Number(this.video.duration.toFixed(2)):0},
    setRange(field:'start'|'end',e:Event){const input=e.target as HTMLInputElement,t=parseTime(input.value);if(Number.isFinite(t)&&t>=0)this.form[field]=Math.min(t,this.videoDuration()||t);else this.say('时间格式应为秒数或 m:ss，例如 75 或 1:15','warn');input.value=clock(this.form[field])},
    setNow(field:'start'|'end'){this.form[field]=this.nowTime()},
    setQuickRange(kind:'whole'|'rest'){this.form.start=kind==='whole'?0:this.nowTime();this.form.end=this.videoDuration()},
    rowMode(frame?:ScoreFrame){const a=frame?.anchors||[];return a.filter(p=>p.manual).length>=2?'手动校准':a.some(p=>p.source==='bar-estimate')?'小节对齐':a.some(p=>p.source==='audio-estimate')?'节拍估算':a.length>=2?'光标定位':'均匀估算'},
    modeClass(frame?:ScoreFrame){const m=this.rowMode(frame);return m==='均匀估算'?'muted':m==='节拍估算'?'warn':'ok'},
    refreshPreview(quiet=false){try{this.preview=captureScore(this.video,{left:0,top:0,right:1,bottom:1},false).image;this.checkCrop()}catch(e){if(!quiet)this.fail(e)}},
    setCrop(name:string){this.crop={...crops[name]};this.checkCrop();this.queueSave()},
    /** Immediate feedback on whether the box looks like notation at the current frame. */
    checkCrop(){
      try{
        const {mask,cursor}=new FrameSampler(this.crop).sample(this.video),pct=(mask.ink*100).toFixed(1)
        if(mask.ink<defaultSegmentOptions.minInk)this.cropCheck={ok:false,text:'此刻框内几乎没有深色内容：可能框错位置，或谱面尚未出现（拖到有谱的时刻再刷新画面）。'}
        else if(mask.ink>defaultSegmentOptions.maxInk)this.cropCheck={ok:false,text:`框内深色内容过多（${pct}%），可能框进了演奏画面或深色背景，请缩小范围。`}
        else this.cropCheck={ok:true,text:`像谱面（墨迹 ${pct}%）。${cursor!==null?'检测到播放光标，可自动定位。':'没发现彩色播放光标，定位线将按时间均匀估算，之后可校准。'}`}
      }catch(e){this.cropCheck={ok:false,text:(e as Error).message}}
    },
    startCrop(e:PointerEvent){if(this.busy||!this.preview)return;const rect=(e.currentTarget as HTMLElement).getBoundingClientRect();const point=(p:PointerEvent)=>({x:Math.max(0,Math.min(1,(p.clientX-rect.left)/rect.width)),y:Math.max(0,Math.min(1,(p.clientY-rect.top)/rect.height))});const a=point(e),original={...this.crop};this.pointerTrack(e,p=>{const b=point(p);this.crop={left:Math.min(a.x,b.x),right:Math.max(a.x,b.x),top:Math.min(a.y,b.y),bottom:Math.max(a.y,b.y)}},()=>{if(!validCrop(this.crop))this.crop=original;this.checkCrop();this.queueSave()})},
    async togglePlay(){try{this.video.paused?await this.video.play():this.video.pause()}catch(e){this.fail(e)}},
    frameEnd(index:number){const frame=this.shownFrames[index];return frame?.end??this.shownFrames[index+1]?.time??Math.max(this.videoDuration(),(frame?.time??0)+.1)},
    tick(){
      if(this.dead)return
      if(!this.busy&&this.visible){
        this.time=this.video.currentTime
        let next=activeScore(this.shownFrames,this.time);if(next>=0&&this.time>=this.frameEnd(next))next=-1
        if(next!==this.active){this.active=next;if(this.follow&&next>=0)this.$nextTick(()=>{const pages=this.$refs.pages as HTMLElement;const row=pages?.children[next] as HTMLElement;if(row)pages.scrollTo({top:row.offsetTop-pages.offsetTop-4,behavior:'smooth'})})}
        if(next>=0)this.position=scorePosition(this.shownFrames[next],this.frameEnd(next),this.time-this.form.offset/1000)
      }
      this.raf=requestAnimationFrame(this.tick)
    },
    queueSave(){if(!this.ready||this.busy)return;clearTimeout(this.saveTimer);this.saveTimer=window.setTimeout(()=>{this.saveTimer=0;void this.persist().catch(e=>this.say('保存失败：'+e.message,'warn'))},400)},
    /** Only images the background does not have yet are sent; everything else is a few KB. */
    persist(){
      const key=this.keyId,stored=this.stored()
      const build=(incremental:boolean)=>({version:3,chapters:JSON.parse(JSON.stringify(this.chapters)),analysis:this.analysis?JSON.parse(JSON.stringify(this.analysis)):null,title:document.title.replace(/_哔哩哔哩.*$/,''),key,
        frames:this.frames.map(({image,...rest})=>({...JSON.parse(JSON.stringify(rest)),...(incremental&&stored.get(rest.id)===image?{keepImage:true}:{image})})),
        crop:{...this.crop},follow:this.follow,locked:this.locked,visible:this.visible,geometry:{x:this.x,y:this.y,width:this.width,height:this.height},settings:{...this.form}})
      const images=this.frames.map(f=>[f.id,f.image] as const)
      const remember=()=>{stored.clear();for(const [id,image] of images)stored.set(id,image)}
      this.saveChain=this.saveChain.catch(()=>{}).then(async()=>{
        try{await scoreRequest('put',key,build(true))}
        catch(e){if((e as Error).message!=='missing-images')throw e;stored.clear();await scoreRequest('put',key,build(false))}
        remember()
      })
      return this.saveChain
    },
    makeFrame(time:number,result:ScoreShot):ScoreFrame{return {id:crypto.randomUUID(),time,image:result.image,width:result.width,height:result.height,barLines:result.barLines,anchors:result.cursor===null?[]:[{time,x:result.cursor}]}},
    validateAnalysis(a:any):AnalysisResult|null{if(!a||!Number.isFinite(a.bpm)||a.bpm<30||a.bpm>360||!Number.isFinite(a.start)||!Number.isFinite(a.end)||a.end<=a.start||!Number.isFinite(a.confidence)||!Number.isInteger(a.numerator)||a.numerator<1||a.numerator>32||![2,4,8,16].includes(a.denominator))return null;for(const k of ['beats','bars'])if(!Array.isArray(a[k])||a[k].length>5000||a[k].some((t:number,i:number)=>!Number.isFinite(t)||t<a.start||t>a.end||(i>0&&t<=a[k][i-1])))return null;if(!Array.isArray(a.candidates)||a.candidates.length>5||a.candidates.some((c:any)=>!Number.isFinite(c.bpm)||c.bpm<30||c.bpm>360||!Number.isFinite(c.phase)||c.phase<a.start||c.phase>=a.end))return null;return a},
    /**
     * One pass over the range: play it (muted, up to 4×), detect row changes on
     * a small canvas every frame, capture full resolution only once a new row has
     * settled. Only rows inside the scanned span are replaced.
     */
    async scan(range?:{start:number;end:number}){
      if(this.busy||!this.ready||this.practiceFrames)return
      const v=this.video as HTMLVideoElement,f=this.form,start=range?.start??f.start,end=Math.min(range?.end??f.end,this.videoDuration())
      const withAudio=!range&&f.withAudio,rate=withAudio?1:f.rate,{numerator,denominator}=f
      if(![start,end].every(Number.isFinite)||start<0||end-start<.5){this.say('请设置有效的开始和结束时间（至少 0.5 秒）。','warn');return}
      if(withAudio&&(end-start<8||end-start>600||!Number.isInteger(numerator)||numerator<1||numerator>32||![2,4,8,16].includes(denominator))){this.say('节拍分析需要 8 秒–10 分钟的范围和有效拍号。','warn');return}
      const crop={...this.crop},clean=f.clean,sampler=new FrameSampler(crop)
      try{sampler.sample(v)}catch(e){this.fail(e);return}
      const original=this.frames.slice(),replaced=original.filter(r=>r.time>=start-.001&&r.time<end).length
      if(replaced&&!range&&!confirm(`将重新抄写 ${clock(start)}–${clock(end)}，替换该范围内的 ${replaced} 行（范围外的保留）。继续？`))return
      // The row already on screen at `start` is kept; seeding avoids a duplicate of it.
      let seed:InkMask|null=null
      const cover=activeScore(original,start),covering=original[cover]
      if(covering&&covering.time<start-.001&&start<(covering.end??original[cover+1]?.time??Infinity))try{seed=await sampler.maskOf(v,covering.image,covering.width,covering.height)}catch{}
      const segmenter=new ScoreSegmenter<ScoreShot>(()=>captureScore(v,crop,clean),{...defaultSegmentOptions,threshold:sensitivities[f.sensitivity as keyof typeof sensitivities]})
      if(seed)segmenter.seed(seed)
      const ids=new WeakMap<object,string>()
      const toFrame=(r:ScanRow<ScoreShot>,anchors:ScoreAnchor[]=[]):ScoreFrame=>{
        if(!ids.has(r))ids.set(r,crypto.randomUUID())
        return {id:ids.get(r)!,time:r.time,...(r.end!==undefined?{end:r.end}:{}),image:r.shot.image,width:r.shot.width,height:r.shot.height,barLines:r.shot.barLines,anchors}
      }
      const saved={time:v.currentTime,paused:v.paused,rate:v.playbackRate,muted:v.muted},controller=new AbortController()
      const audio=withAudio?new AudioOnsets():null,restoreMetronome=suspendForScoreAnalysis()
      this.controller=controller;this.busy=true;this.scanning=true;this.progress=0;this.calibrating=false;clearTimeout(this.saveTimer)
      try{
        v.pause();v.muted=!withAudio
        this.say(withAudio?'原速播放并分析音频，请保持本页在前台…':`以 ${rate}× 播放抄谱中，请保持本页在前台…`)
        const result=await playScan(v,{start,end,rate,signal:controller.signal,
          onPlay:audio?()=>audio.connect(v):undefined,
          onTick:audio?t=>audio.sample(t):undefined,
          onFrame:t=>{
            const s=sampler.sample(v),event=segmenter.push({time:t,mask:s.mask,cursor:s.cursor})
            if(event==='row'||event==='grow'){
              const merged=mergeScanned(original,segmenter.rows.map(r=>toFrame(r)),start,t)
              if(merged.length>160||merged.reduce((n,r)=>n+r.image.length,0)>35000000)throw new Error('谱图已达 160 行或容量上限，已停止。请分段抄写，或把换行灵敏度调低。')
              this.frames=merged
            }
            this.progress=(t-start)/(end-start)
            this.status=`抄谱中 ${Math.round(this.progress*100)}% · ${clock(t)} · 新增 ${segmenter.rows.length} 行`
          }})
        if(this.dead||this.video!==v)return
        const stop=result.time,added=segmenter.finish().map(r=>toFrame(r,fitCursorAnchors(r.cursor)))
        const aborted=result.error?.name==='AbortError'
        let message=`${aborted?'已停止。':result.error?result.error.message+' ':''}已抄 ${clock(start)}–${clock(stop)}：新增 ${added.length} 行，其中 ${added.filter(r=>r.anchors.length>=2).length} 行识别到播放光标。`
        let kind:'ok'|'warn'=result.error&&!aborted?'warn':'ok'
        if(audio){
          if(stop-start>=8)try{
            const analysis=analyzeTempo(audio.onsets,start,stop,visualBarTimes(added),numerator,denominator)
            alignEstimatedRows(added,analysis);this.analysis=analysis;message+=` 节拍约 ${analysis.bpm.toFixed(1)} BPM。`
          }catch(e){message+=' 节拍分析失败：'+(e as Error).message;kind='warn'}
          else message+=' 范围不足 8 秒，未做节拍分析。'
        }
        if(range&&!added.length&&!result.error){this.frames=original;message='这一段没有检测到换行，已保留原谱行。可把换行灵敏度调高后再试。';kind='warn'}
        else{this.frames=mergeScanned(original,added,start,stop);this.realign()}
        this.active=-1
        if(audio&&this.analysis&&f.autoApply&&this.analysis.confidence>=.65&&this.analysis.bars.length>=3){this.applyAnalysis();message+=' 已自动应用节拍器。'}
        if(!added.length&&!result.error&&!range){message+=seed?' 画面与已有谱行相同，没有新增。':' 没有发现谱面——请检查框选区域，或把换行灵敏度调高。';kind='warn'}
        this.say(message,kind)
        if(added.length&&!range){this.tab='bars';this.expanded=false}
      }catch(e){this.frames=original;this.fail(e)}
      finally{
        await audio?.close().catch(()=>{});restoreMetronome();v.pause();v.playbackRate=saved.rate;v.muted=saved.muted
        if(!this.dead&&this.video===v){try{await seekFrame(v,saved.time,new AbortController().signal);if(!saved.paused)await v.play()}catch{}}
        this.busy=false;this.scanning=false;this.controller=null
        if(!this.dead)try{await this.persist()}catch(e){this.say('保存失败：'+(e as Error).message,'warn')}
      }
    },
    rescanRow(index:number){
      const frame=this.frames[index],previous=this.frames[index-1]
      // Start a little early inside the previous row so the exact change moment is caught.
      const start=Math.max(0,previous?Math.max(previous.time+.05,frame.time-.6):frame.time-.6)
      void this.scan({start,end:this.frameEnd(index)})
    },
    chooseTempo(bpm:number){if(!this.analysis)return;const a=this.analysis,c=a.candidates.find(c=>c.bpm===bpm);if(!c)return;const beats:number[]=[];for(let t=c.phase;t<a.end;t+=60/bpm)beats.push(t);this.analysis={...a,bpm,beats,bars:[]};for(const f of this.frames)if(f.anchors.some(a=>a.source==='audio-estimate'))f.anchors=[];alignEstimatedRows(this.frames,this.analysis);this.say('已选择候选速度；小节重拍需用起点／下一节校准。');this.queueSave()},
    applyAnalysis(){if(!this.analysis)return;const a=this.analysis;try{applyAnalyzedTempo(a.bpm,a.bars[0]??a.beats[0]??a.start,a.numerator,a.denominator,a.bars);this.say(`已应用 ${a.bpm.toFixed(2)} BPM，替换小节轴并开启节拍器。${a.bars.length<3?'首拍为音频估算，请校准重拍。':''}`,'ok')}catch(e){this.fail(e)}},
    exportTimeline(){if(this.analysis)downloadScore(new Blob([JSON.stringify({version:1,key:this.keyId,analysis:this.analysis,chapters:this.chapters,rows:this.frames.map(({time,end,anchors,barLines})=>({time,end,anchors,barLines}))},null,2)],{type:'application/json'}),'bilibili-score-timeline.json')},
    async captureOne(){try{if(this.frames.length>=160)throw new Error('最多保存 160 行，请先删除重复谱面。');const t=this.video.currentTime;if(this.frames.some(f=>Math.abs(f.time-t)<.05))throw new Error('这个时间已有谱行，请先删除旧的再补截。');const result=captureScore(this.video,this.crop,this.form.clean);this.frames.push(this.makeFrame(t,result));this.frames.sort((a,b)=>a.time-b.time);this.realign();await this.persist();this.say('已补截当前画面并保存。','ok')}catch(e){this.fail(e)}},
    stopCapture(){this.controller?.abort()},
    clickScore(frame:ScoreFrame,index:number,e:MouseEvent){
      if(this.busy)return
      if(this.practiceFrames&&this.calibrating)return
      const rect=(e.currentTarget as HTMLElement).getBoundingClientRect(),x=Math.max(0,Math.min(1,(e.clientX-rect.left)/rect.width))
      if(this.calibrating){try{
        const t=this.video.currentTime-this.form.offset/1000;if(t<frame.time||t>=this.frameEnd(index))throw new Error('当前视频时间不属于这一行。先跳到这一行的时间范围内再点击。')
        frame.anchors=addAnchor(frame,{time:t,x,manual:true});if(frame.anchors.length>=2)this.realign();this.say(`已绑定 ${clock(t)}，这一行有 ${frame.anchors.length} 个校准点。`,'ok');this.queueSave()
      }catch(error){this.fail(error)}}
      else this.video.currentTime=Math.max(0,timeAtPosition(frame,this.frameEnd(index),x)+this.form.offset/1000)
    },
    changeTime(frame:ScoreFrame,e:Event){const n=parseTime((e.target as HTMLInputElement).value);if(!Number.isFinite(n)||n<0||n>=this.video.duration||this.frames.some(f=>f!==frame&&Math.abs(f.time-n)<.02)){this.say('时间无效或与另一行重复','warn');(e.target as HTMLInputElement).value=clock(frame.time);return}
      // Cursor/manual anchors are absolute video times, so those still inside the row stay valid.
      frame.time=n;if(frame.end!==undefined&&frame.end<=n)this.$delete(frame,'end');frame.anchors=frame.anchors.filter(a=>a.time>=n&&(frame.end===undefined||a.time<=frame.end));if(frame.anchors.length<2)frame.anchors=[];this.frames.sort((a,b)=>a.time-b.time);this.active=-1;this.realign();this.queueSave()},
    setStartNow(frame:ScoreFrame){this.changeTime(frame,{target:{value:String(this.video.currentTime)}} as any)},
    resetAnchors(frame:ScoreFrame){frame.anchors=[];this.realign();this.queueSave()},
    removeFrame(frame:ScoreFrame){this.frames=this.frames.filter(f=>f!==frame);this.active=-1;this.realign();this.queueSave()},
    async exportPng(){try{
      const images=await Promise.all(this.shownFrames.map(f=>new Promise<HTMLImageElement>((resolve,reject)=>{const img=new Image();img.onload=()=>resolve(img);img.onerror=()=>reject(new Error('谱图读取失败'));img.src=f.image})))
      const width=Math.max(...images.map(i=>i.width)),heights=images.map(i=>Math.round(i.height*width/i.width)),height=heights.reduce((a,b)=>a+b+12,0)
      if(height>30000||width*height>50000000)throw new Error('长图尺寸过大，请使用 PDF / 打印分成多页。')
      const c=document.createElement('canvas');c.width=width;c.height=height;const ctx=c.getContext('2d')!;ctx.fillStyle='#fff';ctx.fillRect(0,0,width,height);let y=0;images.forEach((img,i)=>{ctx.drawImage(img,0,y,width,heights[i]);y+=heights[i]+12})
      const blob=await new Promise<Blob|null>(resolve=>c.toBlob(resolve));if(!blob)throw new Error('长图生成失败');downloadScore(blob,'bilibili-score.png')
    }catch(e){this.fail(e)}},
    async printScore(){try{if(this.practiceKey){await scoreRequest('print','practice:'+this.practiceKey);return}await this.persist();await scoreRequest('print',this.keyId)}catch(e){this.fail(e)}},
    exportBackup(){downloadScore(new Blob([JSON.stringify({version:2,frames:this.frames,crop:this.crop,analysis:this.analysis,chapters:this.chapters})],{type:'application/json'}),'bilibili-score-backup.json')},
    validateFrames(value:any):ScoreFrame[]{
      if(!Array.isArray(value)||value.length>160)throw new Error('谱面备份格式无效')
      let bytes=0;const seen=new Set<string>()
      const result=value.map((f:any)=>{
        if(!Number.isFinite(f.time)||f.time<0||typeof f.image!=='string'||!/^data:image\/(png|jpeg|webp);base64,/.test(f.image)||!Number.isFinite(f.width)||f.width<=0||!Number.isFinite(f.height)||f.height<=0)throw new Error('谱面备份包含无效图片或时间')
        bytes+=f.image.length;if(bytes>35000000)throw new Error('备份过大')
        const anchors=Array.isArray(f.anchors)?f.anchors.filter((a:any)=>Number.isFinite(a.time)&&a.time>=f.time&&Number.isFinite(a.x)&&a.x>=0&&a.x<=1):[]
        const barLines=Array.isArray(f.barLines)?f.barLines.filter((x:any)=>Number.isFinite(x)&&x>=0&&x<=1).slice(0,16):[]
        // Stable ids let saves skip images the background already has.
        const id=typeof f.id==='string'&&/^[\w-]{1,64}$/.test(f.id)&&!seen.has(f.id)?f.id:crypto.randomUUID();seen.add(id)
        const {end,keepImage,...rest}=f;return {...rest,...(Number.isFinite(end)&&end>f.time?{end}:{}),id,anchors,barLines}
      }).sort((a:ScoreFrame,b:ScoreFrame)=>a.time-b.time)
      for(let i=1;i<result.length;i++)if(result[i].time<=result[i-1].time)throw new Error('谱行起始时间不能重复')
      return result
    },
    pickFiles(accept:string,multiple=false):Promise<File[]>{return new Promise(resolve=>{const input=document.createElement('input');input.type='file';input.accept=accept;input.multiple=multiple;input.onchange=()=>resolve(Array.from(input.files||[]));input.addEventListener('cancel',()=>resolve([]));input.click()})},
    async importBackup(){try{const [file]=await this.pickFiles('.json,application/json');if(!file)return;if(file.size>36000000)throw new Error('备份过大');const data=JSON.parse(await file.text());const frames=this.validateFrames(data.frames);const chapters=validateChapters(data.chapters);const analysis=this.validateAnalysis(data.analysis);if((this.frames.length||this.chapters.length)&&!confirm('恢复备份会替换当前谱面，是否继续？'))return;this.frames=frames;this.chapters=chapters;this.analysis=analysis;if(validCrop(data.crop||{}))this.crop=data.crop;this.active=-1;this.realign();await this.persist();this.say('备份已恢复。','ok')}catch(e){this.fail(e)}},
    async importImages(){try{
      const files=await this.pickFiles('image/png,image/jpeg,image/webp',true);if(!files.length)return;if(this.frames.length+files.length>160)throw new Error('最多 160 行谱图')
      const next:ScoreFrame[]=[];let time=this.video.currentTime
      for(const file of files){if(file.size>8000000)throw new Error('单张图片不能超过 8MB');const bitmap=await createImageBitmap(file);const c=document.createElement('canvas');c.width=Math.min(1600,bitmap.width);c.height=Math.round(bitmap.height*c.width/bitmap.width);if(c.height>10000){bitmap.close();throw new Error('图片过长，请按谱行分割后导入')}c.getContext('2d')!.drawImage(bitmap,0,0,c.width,c.height);bitmap.close();while([...this.frames,...next].some(f=>Math.abs(f.time-time)<.05))time+=1;next.push({id:crypto.randomUUID(),time,image:c.toDataURL('image/png'),width:c.width,height:c.height,anchors:[]});time+=1}
      this.frames=this.validateFrames([...this.frames,...next]);this.realign();await this.persist();this.say('图片已导入。请为各行设置起始时间，并校准定位线。','ok')
    }catch(e){this.fail(e)}},
  },
})
</script>
