<template>
  <section class="ble-card sp-chapters">
    <div class="ble-card-head"><h3>段落</h3><span class="bl-muted">播放到段落开头，点一下即标记</span></div>
    <div class="sp-chapter-presets">
      <button v-for="preset in presets" :key="preset.name" class="bl-chip" :style="{'--chip':preset.color}" @click="mark(preset.name,preset.color)" :disabled="busy">＋ {{ preset.name }}</button>
      <span class="bl-input-group sp-chapter-custom">
        <input aria-label="自定义段落名称" v-model="name" maxlength="40" placeholder="其他名称" @keydown.enter="mark(name,nextColor)" />
        <button @click="mark(name,nextColor)" :disabled="busy || !name.trim()">＋</button>
      </span>
    </div>
    <div class="sp-chapter-loop">
      <span class="bl-muted">{{ loopLabel ? `循环中：${loopLabel}` : chapters.length ? '勾选一段或几段循环练习，不相接的段落会依次跳过去' : '段落循环：先用上面的按钮标记段落（播放到段落开头点一下），之后可勾选一段或几段循环练习' }}</span>
      <span class="sp-push"></span>
      <button v-if="chapters.length" class="small" :class="{primary:selected.length}" :disabled="busy || !selected.length" @click="$emit('loop',selected)">循环所选{{ selected.length ? `（${selected.length}）` : '' }}</button>
      <button v-if="loopLabel" class="small ghost danger" @click="$emit('stop-loop')">停止循环</button>
    </div>
    <ol v-if="chapters.length" class="sp-chapter-list">
      <li v-for="chapter in chapters" :key="chapter.id" :class="{current:currentId===chapter.id,looping:loopIds.includes(chapter.id)}">
        <input type="checkbox" class="sp-chapter-pick" :aria-label="'选择'+chapter.name" :checked="selected.includes(chapter.id)" @change="pick(chapter.id,$event)" :disabled="busy" />
        <input type="color" :aria-label="chapter.name+'颜色'" :value="chapter.color" @change="edit(chapter,'color',$event)" :disabled="busy" />
        <input class="sp-chapter-name" :aria-label="chapter.name+'名称'" :value="chapter.name" maxlength="40" @change="edit(chapter,'name',$event)" :disabled="busy" />
        <input class="sp-chapter-time" :aria-label="chapter.name+'起始时间'" :value="clock(chapter.time)" @change="edit(chapter,'time',$event)" :disabled="busy" title="秒数或 m:ss" />
        <button class="ghost small" @click="$emit('loop',[chapter.id])" :disabled="busy" title="只循环这一段">循环</button>
        <button class="ghost small" @click="$emit('jump',chapter)" :disabled="busy">定位</button>
        <button class="ghost small danger" @click="remove(chapter)" :disabled="busy" title="删除段落">删除</button>
      </li>
    </ol>
  </section>
</template>

<script lang="ts">
import Vue from 'vue'
import {Chapter,chapterPresets,validateChapters} from './score-chapters'
import {parseTime} from './config'
export default Vue.extend({
  props:{chapters:{type:Array,required:true},video:{type:Object,required:true},busy:Boolean,currentId:String,clock:{type:Function,required:true},
    /** Chapters in the running loop, and its label (empty when not looping). */
    loopIds:{type:Array,default:()=>[]},loopLabel:{type:String,default:''}},
  data(){return {presets:chapterPresets.filter(p=>['前奏','A段','B段','间奏','尾奏'].includes(p.name)),name:'',selected:[] as string[]}},
  watch:{chapters(next:Chapter[]){const ids=new Set(next.map(c=>c.id));this.selected=this.selected.filter(id=>ids.has(id))}},
  computed:{
    /** Custom chapters cycle through the preset palette so no color picking is needed (the list still allows it). */
    nextColor():string{return chapterPresets[this.chapters.length%chapterPresets.length].color},
  },
  methods:{
    commit(next:unknown[],message=''){try{this.$emit('change',validateChapters(next));if(message)this.$emit('status',message)}catch(e){this.$emit('status',(e as Error).message,'warn')}},
    mark(name:string,color:string){
      if(this.busy||!name.trim())return
      const time=Number((this.video as HTMLVideoElement).currentTime.toFixed(3))
      this.commit([...this.chapters,{id:crypto.randomUUID(),time,name:name.trim(),color}],`已标记 ${name} · ${(this.clock as (t:number)=>string)(time)}`)
      this.name=''
    },
    edit(chapter:Chapter,field:'name'|'color'|'time',e:Event){
      const input=e.target as HTMLInputElement
      let value:string|number=input.value
      if(field==='time'){value=parseTime(input.value);if(!Number.isFinite(value)||value<0||value>=(this.video as HTMLVideoElement).duration){input.value=(this.clock as (t:number)=>string)(chapter.time);this.$emit('status','段落时间超出视频范围','warn');return}}
      this.commit((this.chapters as Chapter[]).map(c=>c.id===chapter.id?{...c,[field]:value}:c))
    },
    pick(id:string,e:Event){const on=(e.target as HTMLInputElement).checked;this.selected=on?[...this.selected.filter(x=>x!==id),id]:this.selected.filter(x=>x!==id)},
    remove(chapter:Chapter){this.commit((this.chapters as Chapter[]).filter(c=>c.id!==chapter.id))},
  },
})
</script>
