<template>
  <div class="sp-practice">
    <p class="bl-note">收藏一段原视频与对应谱面，之后可一键用原伴奏练习（1× 原速，节拍器暂时静音）。</p>
    <div class="bl-row">
      <input class="sp-grow" aria-label="练习名称" v-model="name" maxlength="80" placeholder="练习名称，例如 副歌 solo" />
    </div>
    <div class="bl-row">
      <label class="bl-field">起点
        <span class="bl-input-group"><input aria-label="练习起点秒数" type="number" min="0" step=".001" v-model.number="start" /><button @click="start=Number(video.currentTime.toFixed(3))" :disabled="busy">当前</button></span>
      </label>
      <label class="bl-field">终点
        <span class="bl-input-group"><input aria-label="练习终点秒数" type="number" min="0" step=".001" v-model.number="end" /><button @click="end=Number(video.currentTime.toFixed(3))" :disabled="busy">当前</button></span>
      </label>
    </div>
    <div class="bl-row">
      <button class="ghost small" @click="useChapter" :disabled="busy || !chapters.length">取当前段落</button>
      <span class="bl-muted">{{ end>start ? `时长 ${(end-start).toFixed(2)} 秒` : '设置起止时间后收藏' }}</span>
      <button class="primary sp-push" @click="save" :disabled="busy || saving">收藏</button>
    </div>
    <div class="bl-row sp-practice-head">
      <strong>收藏列表 · {{ library.length }}</strong>
      <label class="bl-check"><input type="checkbox" v-model="loop" :disabled="!!playing" /><span>循环播放</span></label>
      <button v-if="selected" class="ghost small sp-push" @click="exit">退出练习谱面</button>
      <button class="ghost small" :class="{'sp-push':!selected}" @click="refresh" title="刷新收藏列表">刷新</button>
    </div>
    <ul v-if="library.length" class="sp-practice-list">
      <li v-for="item in library" :key="item.id" :class="{current:selected===item.id}">
        <div>
          <strong>{{ item.title }}</strong>
          <span>{{ item.start.toFixed(2) }}–{{ item.end.toFixed(2) }} 秒 · {{ item.bpm ? item.bpm.toFixed(1)+' BPM' : '无 BPM' }} · <em :class="item.verified?'ok':'warn'">{{ item.verified ? '已校准' : '待核对' }}</em></span>
        </div>
        <span class="bl-row">
          <button v-if="playing===item.id" class="small" @click="pause">停止</button>
          <button v-else class="small primary" @click="play(item)" :disabled="busy || saving">{{ item.originKey===keyId?'练习':'打开视频' }}</button>
          <button class="ghost small danger" @click="remove(item)" :disabled="busy || playing===item.id" title="删除收藏">删除</button>
        </span>
      </li>
    </ul>
    <p v-else class="bl-empty">还没有收藏。</p>
  </div>
</template>
<script lang="ts">
import Vue from 'vue'
import {chapterAt} from './score-chapters'
import {excerptFrames,PracticePlayback,Practice} from './practice-model'
import {scoreRequest} from './score-capture'
import {getPracticeConfig,suspendForScoreAnalysis} from './index'
export default Vue.extend({
 props:{video:{type:Object,required:true},frames:{type:Array,required:true},chapters:{type:Array,required:true},keyId:{type:String,required:true},busy:Boolean},
 data(){return {name:'',start:0,end:0,loop:false,saving:false,library:[] as Practice[],playing:'',selected:'',playback:null as PracticePlayback|null}},
 async mounted(){this.playback=new PracticePlayback(this.video,this.playbackStopped);await this.refresh();const id=new URL(location.href).searchParams.get('barlinePractice');if(id){const item=this.library.find(p=>p.id===id&&p.originKey===this.keyId);if(item){this.$emit('open');try{await this.load(item);this.video.pause();this.video.currentTime=item.start}catch(e){this.notice((e as Error).message)}}}},
 watch:{busy(value:boolean){if(value)this.exit()},video(next:HTMLVideoElement){this.exit();this.playback=new PracticePlayback(next,this.playbackStopped)}},
 beforeDestroy(){if(this.playing)this.video.pause();this.playback?.stop()},
 methods:{
  playbackStopped(){const wasPlaying=!!this.playing;this.playing='';if(wasPlaying)this.notice('练习播放已停止，原音量保持不变，原播放速度已恢复。')},
  notice(message:string){this.$emit('status',message)},
  async refresh(){try{this.library=await scoreRequest('list','practice:')}catch(e){this.notice((e as Error).message)}},
  useChapter(){const c=chapterAt(this.chapters as any,this.video.currentTime);if(!c){this.notice('当前时间还没有段落');return}const i=this.chapters.indexOf(c);this.start=c.time;this.end=(this.chapters[i+1] as any)?.time??this.video.duration;this.name=c.name},
  async save(){this.saving=true;try{const frames=excerptFrames(this.frames as any,this.start,this.end,this.video.duration);if(!frames.length)throw new Error('该片段还没有谱面，请先截谱或生成谱子');const config=getPracticeConfig();const id=crypto.randomUUID();const value:Practice={id,kind:'practice',title:this.name.trim()||'练习片段',originKey:this.keyId,url:location.origin+location.pathname+'?p='+(new URL(location.href).searchParams.get('p')||'1'),start:this.start,end:this.end,frames,config,bpm:config?.segments[0]?.bpm??null,verified:config?.tempoSource==='manual-bars',createdAt:Date.now()};if(JSON.stringify(value).length>35000000)throw new Error('收藏谱图过大，请缩短范围');await scoreRequest('put','practice:'+id,value);await this.refresh();this.notice(`已收藏 ${(this.end-this.start).toFixed(3)} 秒原片段，谱面和时间轴保持原始坐标。`)}catch(e){this.notice((e as Error).message)}finally{this.saving=false}},
  async load(item:Practice){const data=await scoreRequest('get','practice:'+item.id);if(!data?.frames?.length)throw new Error('收藏谱面不可用');this.selected=item.id;this.$emit('select',data.frames,item.id);return data as Practice},
  async play(item:Practice){try{if(item.originKey!==this.keyId){const url=new URL(item.url);if(url.origin!=='https://www.bilibili.com'||!/^\/video\/BV[\w]+\/?$/.test(url.pathname))throw new Error('收藏地址无效');url.searchParams.set('barlinePractice',item.id);location.assign(url.href);return}const data=await this.load(item);await this.playback!.play(data.start,data.end,this.loop,suspendForScoreAnalysis);this.playing=item.id;this.notice('正在播放原视频片段；原音量保持不变，节拍器暂时静音。')}catch(e){this.notice((e as Error).message)}},
  pause(){this.video.pause();this.playback?.stop()},
  exit(){if(this.playing)this.pause();this.selected='';this.$emit('select',null)},
  async remove(item:Practice){try{if(!confirm('删除这个练习收藏？原视频和原谱面不会删除。'))return;await scoreRequest('delete','practice:'+item.id);if(this.selected===item.id)this.exit();await this.refresh()}catch(e){this.notice((e as Error).message)}},
 }
})
</script>
