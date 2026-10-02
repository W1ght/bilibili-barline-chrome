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
    <ol v-if="chapters.length" class="sp-chapter-list">
      <li v-for="chapter in chapters" :key="chapter.id" :class="{current:currentId===chapter.id}">
        <input type="color" :aria-label="chapter.name+'颜色'" :value="chapter.color" @change="edit(chapter,'color',$event)" :disabled="busy" />
        <input class="sp-chapter-name" :aria-label="chapter.name+'名称'" :value="chapter.name" maxlength="40" @change="edit(chapter,'name',$event)" :disabled="busy" />
        <input class="sp-chapter-time" :aria-label="chapter.name+'起始时间'" :value="clock(chapter.time)" @change="edit(chapter,'time',$event)" :disabled="busy" title="秒数或 m:ss" />
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
  props:{chapters:{type:Array,required:true},video:{type:Object,required:true},busy:Boolean,currentId:String,clock:{type:Function,required:true}},
  data(){return {presets:chapterPresets.filter(p=>['前奏','A段','B段','间奏','尾奏'].includes(p.name)),name:''}},
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
    remove(chapter:Chapter){this.commit((this.chapters as Chapter[]).filter(c=>c.id!==chapter.id))},
  },
})
</script>
