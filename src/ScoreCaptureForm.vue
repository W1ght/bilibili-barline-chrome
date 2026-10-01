<template>
  <div class="sp-capture">
    <section class="sp-step">
      <h4><i>1</i>框选谱面</h4>
      <div class="score-preview" @pointerdown="$emit('crop-start',$event)">
        <img v-if="preview" :src="preview" alt="拖动框选谱面区域" draggable="false" />
        <div v-else class="score-preview-empty">视频画面加载后点「刷新画面」</div>
        <div v-if="preview" class="score-crop" :style="cropStyle"></div>
      </div>
      <div class="bl-row">
        <span class="bl-seg" role="group" aria-label="快捷框选">
          <button @click="$emit('crop-preset','top')" :disabled="busy">上方</button>
          <button @click="$emit('crop-preset','bottom')" :disabled="busy">下方</button>
          <button @click="$emit('crop-preset','full')" :disabled="busy">全画面</button>
        </span>
        <button class="ghost" @click="$emit('refresh')" :disabled="busy">刷新画面</button>
      </div>
      <p v-if="cropCheck" :class="['bl-note',cropCheck.ok?'ok':'warn']">{{ cropCheck.text }}</p>
    </section>

    <section class="sp-step">
      <h4><i>2</i>范围</h4>
      <div class="bl-row">
        <label class="bl-field">开始
          <span class="bl-input-group"><input aria-label="抄谱开始时间" :value="clock(form.start)" @change="$emit('set-range','start',$event)" :disabled="busy" /><button @click="$emit('now','start')" :disabled="busy" title="取视频当前时间">当前</button></span>
        </label>
        <label class="bl-field">结束
          <span class="bl-input-group"><input aria-label="抄谱结束时间" :value="clock(form.end)" @change="$emit('set-range','end',$event)" :disabled="busy" /><button @click="$emit('now','end')" :disabled="busy" title="取视频当前时间">当前</button></span>
        </label>
      </div>
      <div class="bl-row">
        <button class="ghost small" @click="$emit('range','whole')" :disabled="busy">整个视频</button>
        <button class="ghost small" @click="$emit('range','rest')" :disabled="busy">从当前到结尾</button>
      </div>
    </section>

    <section class="sp-step">
      <h4><i>3</i>方式</h4>
      <div class="bl-field">速度
        <span class="bl-seg" role="radiogroup" aria-label="抄谱播放速度">
          <button v-for="r in rates" :key="r.value" role="radio" :aria-checked="effectiveRate===r.value" :class="{active:effectiveRate===r.value}" :disabled="busy || form.withAudio" @click="form.rate=r.value" :title="r.hint">{{ r.label }}</button>
        </span>
      </div>
      <div class="bl-field">换行灵敏度
        <span class="bl-seg" role="radiogroup" aria-label="换行灵敏度">
          <button v-for="s in sensitivities" :key="s.value" role="radio" :aria-checked="form.sensitivity===s.value" :class="{active:form.sensitivity===s.value}" :disabled="busy" @click="form.sensitivity=s.value" :title="s.hint">{{ s.label }}</button>
        </span>
      </div>
      <label class="bl-check"><input type="checkbox" v-model="form.clean" :disabled="busy" /><span>去除彩色高亮<small>浅底深色谱推荐</small></span></label>
      <label class="bl-check"><input type="checkbox" v-model="form.withAudio" :disabled="busy" /><span>同时分析节拍 BPM<small>原速有声播放，范围 8 秒–10 分钟</small></span></label>
      <div v-if="form.withAudio" class="bl-row sp-indent">
        <label class="bl-field">拍号
          <span class="bl-input-group"><input aria-label="每小节拍数" type="number" min="1" max="32" v-model.number="form.numerator" :disabled="busy" /><b>/</b><select aria-label="拍号分母" v-model.number="form.denominator" :disabled="busy"><option v-for="d in [2,4,8,16]" :key="d" :value="d">{{ d }}</option></select></span>
        </label>
        <label class="bl-check"><input type="checkbox" v-model="form.autoApply" :disabled="busy" /><span>可信时自动应用节拍器</span></label>
      </div>
    </section>

    <p class="bl-note">{{ hint }}</p>
    <div class="bl-row">
      <button class="primary" @click="$emit('start')" :disabled="busy || disabled">开始抄谱</button>
      <button @click="$emit('import')" :disabled="busy || disabled">导入谱图</button>
    </div>
  </div>
</template>

<script lang="ts">
import Vue from 'vue'
export default Vue.extend({
  props:{form:{type:Object,required:true},preview:String,cropStyle:Object,cropCheck:Object,busy:Boolean,disabled:Boolean,hint:String,clock:{type:Function,required:true}},
  data(){return {
    rates:[{value:4,label:'4× 快',hint:'静音快速播放'},{value:2,label:'2× 稳',hint:'网络慢或漏行时使用'},{value:1,label:'1× 原速',hint:'原速播放'}],
    sensitivities:[{value:'high',label:'高',hint:'漏了换行时调高'},{value:'normal',label:'标准',hint:'大多数视频'},{value:'robust',label:'低',hint:'多出碎行时调低'}],
  }},
  computed:{effectiveRate():number{return this.form.withAudio?1:this.form.rate}},
})
</script>
