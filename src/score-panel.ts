import Vue from 'vue'
import ScorePanel from './ScorePanel.vue'
import {onPageTick} from './chrome-adapter'
let root:Vue|null=null
let key=''
export function initScorePanel(){
  onPageTick(()=>{
    const video=document.querySelector<HTMLVideoElement>('.bpx-player-container video, .bilibili-player video')
    const url=new URL(location.href)
    const next=/^\/video\//.test(url.pathname)&&video?url.pathname.replace(/\/$/,'')+':p'+(url.searchParams.get('p')||'1'):''
    if(next!==key){root?.$destroy();root?.$el.remove();root=null;key=next
      if(next&&video){root=new Vue({data:{currentVideo:video},render(h){return h(ScorePanel,{ref:'panel',props:{video:this.currentVideo,keyId:next}})}});const mount=document.createElement('div');document.body.append(mount);root.$mount(mount)}
    }else if(root&&video&&(root as any).currentVideo!==video)(root as any).currentVideo=video
  })
}
/** Opens the panel, optionally on a tab ('bars' | 'capture' | 'chapters' | 'practice' | 'library'). */
export function openScorePanel(tab?:string){const panel=root?.$refs.panel as any;if(!panel)return false;void panel.open(tab);return true}

