<template>
  <div class="sp-capture">
    <div class="score-preview" @pointerdown="$emit('crop-start',$event)">
      <img v-if="preview" :src="preview" alt="拖动框选谱面区域" draggable="false" />
      <div v-else class="score-preview-empty">视频画面加载后点 ↻ 刷新</div>
      <div v-if="preview" class="score-crop" :style="cropStyle"></div>
      <span class="sp-preview-tools" @pointerdown.stop>
        <button @click="$emit('crop-preset','top')" :disabled="busy">上方</button>
        <button @click="$emit('crop-preset','bottom')" :disabled="busy">下方</button>
        <button @click="$emit('crop-preset','full')" :disabled="busy">全画面</button>
        <button @click="$emit('refresh')" :disabled="busy" title="刷新画面" aria-label="刷新画面">↻</button>
      </span>
    </div>
    <p :class="['bl-note', cropCheck ? (cropCheck.ok ? 'ok' : 'warn') : '']">{{ cropCheck ? cropCheck.text : '在画面上拖框，只框住一行谱面。' }}</p>

    <div class="bl-row">
      <span class="bl-seg" role="radiogroup" aria-label="抄谱范围">
        <button v-for="m in modes" :key="m.value" role="radio" :aria-checked="mode===m.value" :class="{active:mode===m.value}" :disabled="busy" @click="setMode(m.value)">{{ m.label }}</button>
      </span>
      <span class="bl-muted">{{ clock(form.start) }}–{{ clock(form.end) }}</span>
    </div>
    <div v-if="mode==='custom'" class="bl-row">
      <span class="bl-input-group"><b>从</b><input aria-label="抄谱开始时间" :value="clock(form.start)" @change="$emit('set-range','start',$event)" :disabled="busy" /><button @click="$emit('now','start')" :disabled="busy" title="取视频当前时间">当前</button></span>
      <span class="bl-input-group"><b>到</b><input aria-label="抄谱结束时间" :value="clock(form.end)" @change="$emit('set-range','end',$event)" :disabled="busy" /><button @click="$emit('now','end')" :disabled="busy" title="取视频当前时间">当前</button></span>
    </div>

    <button class="primary sp-start" @click="$emit('start')" :disabled="busy || disabled">开始抄谱</button>
    <p class="bl-muted sp-start-hint">{{ hint }}</p>

    <details class="ble-more">
      <summary>抄谱选项：速度、换行灵敏度、节拍分析、导入图片</summary>
      <div class="sp-option">速度
        <span class="bl-seg" role="radiogroup" aria-label="抄谱播放速度">
          <button v-for="r in rates" :key="r.value" role="radio" :aria-checked="effectiveRate===r.value" :class="{active:effectiveRate===r.value}" :disabled="busy || form.withAudio" @click="form.rate=r.value" :title="r.hint">{{ r.label }}</button>
        </span>
      </div>
      <div class="sp-option">换行灵敏度
        <span class="bl-seg" role="radiogroup" aria-label="换行灵敏度">
          <button v-for="s in sensitivities" :key="s.value" role="radio" :aria-checked="form.sensitivity===s.value" :class="{active:form.sensitivity===s.value}" :disabled="busy" @click="form.sensitivity=s.value" :title="s.hint">{{ s.label }}</button>
        </span>
      </div>
      <label class="bl-check"><input type="checkbox" v-model="form.clean" :disabled="busy" /><span>去除彩色高亮<small>浅底深色谱推荐</small></span></label>
      <label class="bl-check"><input type="checkbox" v-model="form.withAudio" :disabled="busy" /><span>同时分析音频节拍<small>原速有声播放，范围 8 秒–10 分钟，按 {{ form.numerator }}/{{ form.denominator }} 拍（在「节拍」里改）；可信时自动应用</small></span></label>
      <div class="bl-row"><button class="small" @click="$emit('import')" :disabled="busy || disabled">导入谱图图片…</button></div>
    </details>
  </div>
</template>

<script lang="ts">
import Vue from 'vue'
type Mode='whole'|'rest'|'custom'
export default Vue.extend({
  props:{form:{type:Object,required:true},preview:String,cropStyle:Object,cropCheck:Object,busy:Boolean,disabled:Boolean,hint:String,clock:{type:Function,required:true},duration:Number},
  data(){return {
    picked:'' as Mode|'',
    modes:[{value:'whole',label:'整个视频'},{value:'rest',label:'从当前位置'},{value:'custom',label:'自定义'}] as {value:Mode;label:string}[],
    rates:[{value:4,label:'4× 快',hint:'静音快速播放'},{value:2,label:'2× 稳',hint:'网络慢或漏行时使用'},{value:1,label:'1× 原速',hint:'原速播放'}],
    sensitivities:[{value:'high',label:'高',hint:'漏了换行时调高'},{value:'normal',label:'标准',hint:'大多数视频'},{value:'robust',label:'低',hint:'多出碎行时调低'}],
  }},
  computed:{
    effectiveRate():number{return this.form.withAudio?1:this.form.rate},
    /** Until the user picks, saved ranges show as 「整个视频」 or 「自定义」. */
    mode():Mode{if(this.picked)return this.picked;const f=this.form,d=this.duration||0;return f.start<=.05&&(!d||f.end>=d-.05)?'whole':'custom'},
  },
  methods:{
    setMode(mode:Mode){this.picked=mode;if(mode!=='custom')this.$emit('range',mode)},
  },
})
</script>
