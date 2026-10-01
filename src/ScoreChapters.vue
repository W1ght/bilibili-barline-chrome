<template>
  <div class="sp-chapters">
    <p class="bl-note">把视频定位到段落起点，点下面的按钮即可标记；每段持续到下一段开始。</p>
    <div class="sp-chapter-presets">
      <button v-for="preset in presets" :key="preset.name" class="bl-chip" :style="{'--chip':preset.color}" @click="mark(preset.name,preset.color)" :disabled="busy">＋ {{ preset.name }}</button>
    </div>
    <div class="bl-row">
      <span class="bl-input-group">
        <input aria-label="新段落颜色" type="color" v-model="color" />
        <input aria-label="自定义段落名称" v-model="name" maxlength="40" placeholder="自定义名称" @keydown.enter="mark(name,color)" />
        <button @click="mark(name,color)" :disabled="busy || !name.trim()">标记</button>
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
    <p v-else class="bl-empty">还没有段落。</p>
  </div>
</template>

<script lang="ts">
import Vue from 'vue'
import {Chapter,chapterPresets,validateChapters} from './score-chapters'
import {parseTime} from './config'
export default Vue.extend({
  props:{chapters:{type:Array,required:true},video:{type:Object,required:true},busy:Boolean,currentId:String,clock:{type:Function,required:true}},
  data(){return {presets:chapterPresets,name:'',color:'#00a1d6'}},
  methods:{
    commit(next:unknown[],message=''){try{this.$emit('change',validateChapters(next));if(message)this.$emit('status',message)}catch(e){this.$emit('status',(e as Error).message,'warn')}},
    mark(name:string,color:string){
      if(this.busy||!name.trim())return
      const time=Number((this.video as HTMLVideoElement).currentTime.toFixed(3))
      this.commit([...this.chapters,{id:crypto.randomUUID(),time,name,color}],`已标记 ${name} · ${(this.clock as (t:number)=>string)(time)}`)
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
