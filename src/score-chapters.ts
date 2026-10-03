export interface Chapter {id:string; time:number; name:string; color:string}
export const chapterPresets=[
  {name:'前奏',color:'#64748b'},{name:'A段',color:'#00a1d6'},{name:'A1',color:'#0284c7'},{name:'A2',color:'#0891b2'},
  {name:'B段',color:'#a855f7'},{name:'B1',color:'#7c3aed'},{name:'B2',color:'#c026d3'},
  {name:'间奏',color:'#d97706'},{name:'尾奏',color:'#16a34a'},
]
export function validateChapters(value:unknown):Chapter[]{
  if(value==null)return []
  if(!Array.isArray(value)||value.length>300)throw new Error('段落数据无效或超过300段')
  const result=value.map(c=>{if(!c||!Number.isFinite(c.time)||c.time<0||typeof c.name!=='string'||!c.name.trim()||c.name.length>40||!/^#[0-9a-f]{6}$/i.test(c.color))throw new Error('段落名称、时间或颜色无效');return {id:String(c.id||c.time),time:c.time,name:c.name.trim(),color:c.color}}).sort((a,b)=>a.time-b.time)
  for(let i=1;i<result.length;i++)if(result[i].time-result[i-1].time<.05)throw new Error('同一时间已有段落，请修改已有段落')
  return result
}
/**
 * 选中段落的循环片段：每段从自己的开头到下一段开头（最后一段到视频结尾）。
 * snap 把边界吸到最近的小节线（有节拍配置时），循环衔接不会切在半拍上。
 */
export function chapterSpans(chapters:Chapter[],ids:string[],duration:number,snap:(t:number)=>number=t=>t){
  const wanted=new Set(ids),end=Number.isFinite(duration)&&duration>0?duration-.05:Infinity
  return chapters.flatMap((c,i)=>{
    if(!wanted.has(c.id))return []
    const start=Math.max(0,snap(c.time)),stop=Math.min(end,i+1<chapters.length?snap(chapters[i+1].time):end)
    return stop-start>.2&&Number.isFinite(stop)?[{start,end:stop}]:[]
  })
}
export function chapterAt(chapters:Chapter[],time:number):Chapter|null {
  for(let i=chapters.length-1;i>=0;i--)if(time>=chapters[i].time)return chapters[i]
  return null
}
