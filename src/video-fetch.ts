/**
 * 「音乐小节线」组件 —— 通过 B 站 API 拉取视频标题/封面/bv/aid。
 * 优先用配置里记录的 aid；无则回退用 key（历史数据可能是 aid）。
 * 配置 key 是 cid || aid，cid 场景若无 aid 记录则无法解析。
 */

import { getJsonWithCredentials } from '@/core/ajax'
import { BarConfig } from './config'

export const fetchVideoMeta = async (
  key: string,
  aid?: string,
): Promise<Partial<Pick<BarConfig, 'videoTitle' | 'videoCover' | 'bvid' | 'aid'>> | null> => {
  const id = aid || key
  if (!/^\d+$/.test(id)) {
    return null
  }
  try {
    const json = await getJsonWithCredentials(
      `https://api.bilibili.com/x/web-interface/view?aid=${id}`,
    )
    if (json.code !== 0) {
      return null
    }
    const { data } = json
    return {
      videoTitle: data?.title,
      videoCover: (data?.pic || '').replace('http:', 'https:'),
      bvid: data?.bvid,
      aid: String(data?.aid),
    }
  } catch {
    return null
  }
}
