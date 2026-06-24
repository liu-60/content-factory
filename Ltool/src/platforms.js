export const PLATFORM_REGISTRY = {
  weixin: { id: 'weixin', name: '微信公众号', composeUrl: 'https://mp.weixin.qq.com/cgi-bin/appmsg' },
  xiaohongshu: { id: 'xiaohongshu', name: '小红书', composeUrl: 'https://creator.xiaohongshu.com/publish/publish' },
  bilibili: { id: 'bilibili', name: '哔哩哔哩', composeUrl: 'https://member.bilibili.com/platform/upload/text/apply' },
  zhihu: { id: 'zhihu', name: '知乎', composeUrl: 'https://zhuanlan.zhihu.com/write' },
  toutiao: { id: 'toutiao', name: '头条', composeUrl: 'https://mp.toutiao.com/profile_v4/graphic/publish' },
  baijiahao: { id: 'baijiahao', name: '百家号', composeUrl: 'https://baijiahao.baidu.com/builder/rc/edit?type=news' },
  x: { id: 'x', name: 'X', composeUrl: 'https://x.com/compose/post' },
};

export const DEFAULT_PLATFORMS = Object.keys(PLATFORM_REGISTRY);

export function normalizePlatforms(value) {
  const raw = Array.isArray(value) ? value : String(value || '').split(',');
  const ids = raw.map((item) => String(item).trim().toLowerCase()).filter(Boolean);
  const expanded = ids.includes('all') ? DEFAULT_PLATFORMS : ids;
  const unknown = expanded.filter((id) => !PLATFORM_REGISTRY[id]);
  if (unknown.length) throw new Error(`Unsupported platform: ${unknown.join(', ')}`);
  return [...new Set(expanded)];
}
