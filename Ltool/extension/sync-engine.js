export const PLATFORMS = {
  weixin: { id: 'weixin', name: '微信公众号', domains: ['mp.weixin.qq.com'], loginUrl: 'https://mp.weixin.qq.com/', composeUrl: 'https://mp.weixin.qq.com/cgi-bin/appmsg', mode: 'api' },
  xiaohongshu: { id: 'xiaohongshu', name: '小红书', domains: ['creator.xiaohongshu.com', 'www.xiaohongshu.com'], loginUrl: 'https://creator.xiaohongshu.com/', composeUrl: 'https://creator.xiaohongshu.com/publish/publish', mode: 'composer', contentMode: 'text', titleSelectors: ['input[placeholder*="标题"]', 'textarea[placeholder*="标题"]'], editorSelectors: ['textarea[placeholder*="正文"]', '[contenteditable="true"]'], coverLabels: ['封面', '上传封面', '选择封面', '添加封面'], publishLabels: ['发布'] },
  bilibili: { id: 'bilibili', name: '哔哩哔哩', domains: ['bilibili.com', 'member.bilibili.com'], loginUrl: 'https://passport.bilibili.com/', composeUrl: 'https://member.bilibili.com/platform/upload/text/apply', mode: 'api' },
  zhihu: { id: 'zhihu', name: '知乎', domains: ['zhihu.com', 'zhuanlan.zhihu.com'], loginUrl: 'https://www.zhihu.com/signin', composeUrl: 'https://zhuanlan.zhihu.com/write', mode: 'api' },
  toutiao: { id: 'toutiao', name: '头条', domains: ['mp.toutiao.com', 'toutiao.com'], loginUrl: 'https://mp.toutiao.com/', composeUrl: 'https://mp.toutiao.com/profile_v4/graphic/publish', mode: 'api', contentMode: 'html', titleSelectors: ['textarea[placeholder*="标题"]', 'input[placeholder*="标题"]'], editorSelectors: ['.ProseMirror', '.DraftEditor-editorContainer [contenteditable="true"]', '[contenteditable="true"]'], coverLabels: ['封面', '上传封面', '选择封面', '添加封面'], publishLabels: ['发布'] },
  baijiahao: { id: 'baijiahao', name: '百家号', domains: ['baijiahao.baidu.com', 'baidu.com'], loginUrl: 'https://baijiahao.baidu.com/', composeUrl: 'https://baijiahao.baidu.com/builder/rc/edit?type=news', mode: 'api' },
  x: { id: 'x', name: 'X', domains: ['x.com', 'twitter.com'], loginUrl: 'https://x.com/login', composeUrl: 'https://x.com/compose/post', mode: 'composer', contentMode: 'text', titleSelectors: [], editorSelectors: ['div[data-testid="tweetTextarea_0"]', '[contenteditable="true"]'], publishLabels: ['Post', '发布'] },
};

export async function listPlatforms(forceRefresh = false) {
  return await Promise.all(Object.values(PLATFORMS).map((platform) => checkAuth(platform.id, forceRefresh)));
}

export async function checkAuth(platformId) {
  const adapter = createAdapter(platformId);
  return await adapter.checkAuth();
}

export async function syncArticleBatch(params) {
  const platformIds = params.platforms || Object.keys(PLATFORMS);
  const articles = params.articles || [];
  const publish = Boolean(params.publish);
  const results = [];
  for (const article of articles) {
    for (const platformId of platformIds) {
      try {
        const adapter = createAdapter(platformId);
        const auth = await adapter.checkAuth();
        if (!auth.isAuthenticated) {
          await chrome.tabs.create({ url: adapter.platform.loginUrl, active: false });
          throw new Error(`Not logged in. Opened login page: ${adapter.platform.loginUrl}`);
        }
        const prepared = await adapter.prepareArticle(normalizeArticle(article));
        results.push({ ...(await adapter.saveArticle(prepared, { publish })), timestamp: Date.now() });
      } catch (error) {
        results.push({ platform: platformId, title: article.title, success: false, error: error.message, timestamp: Date.now() });
      }
    }
  }
  return { batchId: params.batchId || `batch_${Date.now()}`, results };
}

function createAdapter(platformId) {
  const platform = PLATFORMS[platformId];
  if (!platform) throw new Error(`Unknown platform: ${platformId}`);
  if (platformId === 'weixin') return new WeixinAdapter(platform);
  if (platformId === 'toutiao') return new ToutiaoAdapter(platform);
  if (platformId === 'baijiahao') return new BaijiahaoAdapter(platform);
  if (platformId === 'bilibili') return new BilibiliAdapter(platform);
  if (platformId === 'zhihu') return new ZhihuAdapter(platform);
  return new ComposerAdapter(platform);
}

function normalizeArticle(article) {
  const html = article.html || article.content || `<p>${escapeHtml(article.text || article.markdown || '')}</p>`;
  return { ...article, title: article.title || 'Untitled', html, content: html, text: article.text || htmlToPlainText(html) };
}

class BaseAdapter {
  constructor(platform) {
    this.platform = platform;
  }

  async checkAuth() {
    const cookies = [];
    for (const domain of this.platform.domains) cookies.push(...await chrome.cookies.getAll({ domain }));
    const usable = cookies.filter((cookie) => !cookie.expirationDate || cookie.expirationDate * 1000 > Date.now());
    return platformInfo(this.platform, usable.length > 0, usable[0]?.domain || '', usable[0]?.name || '');
  }

  async prepareArticle(article) {
    this.imageUploadWarnings = [];
    const html = await this.processImages(article.html || '');
    const coverUpload = article.cover ? await this.uploadCover(article.cover).catch((error) => ({ error: error.message })) : null;
    return { ...article, html, content: html, text: article.text || htmlToPlainText(html), coverUpload, imageUploadWarnings: this.imageUploadWarnings || [] };
  }

  async processImages(content) {
    let result = content;
    const uploaded = new Map();
    for (const match of extractImages(content)) {
      if (this.shouldSkipImage(match.src)) continue;
      let upload = uploaded.get(match.src);
      if (!upload) {
        try {
          upload = await this.uploadImageByUrl(match.src);
        } catch (error) {
          this.imageUploadWarnings = this.imageUploadWarnings || [];
          this.imageUploadWarnings.push({ src: summarizeImageSource(match.src), error: error.message });
          result = result.replace(match.full, removeImage(match));
          continue;
        }
        uploaded.set(match.src, upload);
      }
      result = result.replace(match.full, replaceImage(match, upload));
    }
    return result;
  }

  shouldSkipImage() {
    return false;
  }

  async uploadCover(src) {
    return await this.uploadImageByUrl(src);
  }

  async uploadImageByUrl() {
    throw new Error(`${this.platform.name} does not support API image upload`);
  }

  result(success, extra = {}) {
    return { platform: this.platform.id, platformName: this.platform.name, success, draftOnly: true, ...extra };
  }
}

class WeixinAdapter extends BaseAdapter {
  headerRuleIds = [920001];

  async checkAuth() {
    try {
      const html = await (await fetchWithTimeout('https://mp.weixin.qq.com/', { credentials: 'include' }, 30000, 'Weixin auth page')).text();
      if (/登录超时|重新登录|login/i.test(html) && !/token=\d+/.test(html)) return platformInfo(this.platform, false);
      const token = html.match(/[?&]token=(\d+)/)?.[1]
        || html.match(/data:\s*\{[\s\S]*?t:\s*["'](\d+)["']/)?.[1]
        || html.match(/token:\s*["']?(\d+)["']?/)?.[1];
      if (!token) return platformInfo(this.platform, false);
      const ticket = html.match(/ticket:\s*["']([^"']+)["']/)?.[1] || '';
      const userName = html.match(/user_name:\s*["']([^"']+)["']/)?.[1] || '';
      if (!ticket || !userName) return platformInfo(this.platform, false, '', '', 'Weixin login metadata is incomplete; please re-login in Edge.');
      this.meta = {
        token,
        ticket,
        userName,
        nickName: html.match(/nick_name:\s*["']([^"']+)["']/)?.[1] || '',
        svrTime: Number(html.match(/time:\s*["'](\d+)["']/)?.[1] || Date.now() / 1000),
      };
      return platformInfo(this.platform, true, this.meta.nickName, this.meta.userName);
    } catch (error) {
      return platformInfo(this.platform, false, '', '', error.message);
    }
  }

  shouldSkipImage(src) {
    return !src.startsWith('data:') && ['mmbiz.qpic.cn', 'mmbiz.qlogo.cn'].some((pattern) => src.includes(pattern));
  }

  async uploadImageByUrl(src) {
    if (!this.meta) await this.checkAuth();
    if (!this.meta?.token) throw new Error('Weixin token not available');
    return await this.withHeaderRules(async () => {
      const blob = await urlToBlob(src);
      const timestamp = Date.now();
      const fileName = `${timestamp}.jpg`;
      const formData = new FormData();
      formData.append('type', blob.type || 'image/jpeg');
      formData.append('id', String(timestamp));
      formData.append('name', fileName);
      formData.append('lastModifiedDate', new Date().toString());
      formData.append('size', String(blob.size));
      formData.append('file', blob, fileName);
      const query = new URLSearchParams({ action: 'upload_material', f: 'json', scene: '8', writetype: 'doublewrite', groupid: '1', ticket_id: this.meta.userName, ticket: this.meta.ticket, svr_time: String(this.meta.svrTime), token: this.meta.token, lang: 'zh_CN', seq: String(Date.now()), t: String(Math.random()) });
      const data = await executeFormDataInPlatformTab(this.platform, `https://mp.weixin.qq.com/cgi-bin/filetransfer?${query}`, formData, 90000);
      if (data.base_resp?.err_msg !== 'ok' || !data.cdn_url) throw new Error(data.base_resp?.err_msg || data.err_msg || `Weixin image upload failed: ${JSON.stringify(data).slice(0, 300)}`);
      return { url: data.cdn_url };
    });
  }

  async saveArticle(article, options) {
    if (!this.meta) await this.checkAuth();
    return await this.withHeaderRules(async () => {
      const cover = article.coverUpload && !article.coverUpload.error ? article.coverUpload : null;
      const form = weixinForm(this.meta.token, article, cover);
      const data = await executeFetchInPlatformTab(this.platform, `https://mp.weixin.qq.com/cgi-bin/operate_appmsg?t=ajax-response&sub=create&type=77&token=${this.meta.token}&lang=zh_CN`, 'POST', new URLSearchParams(form).toString(), { 'Content-Type': 'application/x-www-form-urlencoded' });
      const appMsgId = data.appMsgId || data.appmsgid || data.app_msg_id || data.AppMsgId;
      if (!appMsgId) throw new Error(`Weixin save failed ret=${data.ret ?? data.base_resp?.ret ?? 'unknown'} msg=${data.err_msg || data.base_resp?.err_msg || ''} body=${JSON.stringify(data).slice(0, 300)}`);
      return this.result(true, { title: article.title, postId: appMsgId, postUrl: `https://mp.weixin.qq.com/cgi-bin/appmsg?t=media/appmsg_edit&action=edit&type=77&appmsgid=${appMsgId}&token=${this.meta.token}&lang=zh_CN`, draftOnly: !options.publish, message: `api=operate_appmsg; cover=${Boolean(cover)}; imageWarnings=${article.imageUploadWarnings?.length || 0}` });
    });
  }

  async withHeaderRules(fn) {
    if (!chrome.declarativeNetRequest?.updateDynamicRules) return await fn();
    const rules = [{
      id: this.headerRuleIds[0],
      priority: 1,
      action: {
        type: 'modifyHeaders',
        requestHeaders: [
          { header: 'Origin', operation: 'set', value: 'https://mp.weixin.qq.com' },
          { header: 'Referer', operation: 'set', value: 'https://mp.weixin.qq.com/' },
        ],
      },
      condition: {
        urlFilter: '*://mp.weixin.qq.com/cgi-bin/*',
        resourceTypes: ['xmlhttprequest'],
      },
    }];
    await chrome.declarativeNetRequest.updateDynamicRules({ removeRuleIds: this.headerRuleIds, addRules: rules });
    try {
      return await fn();
    } finally {
      await chrome.declarativeNetRequest.updateDynamicRules({ removeRuleIds: this.headerRuleIds }).catch(() => {});
    }
  }
}

class ToutiaoAdapter extends BaseAdapter {
  async checkAuth() {
    try {
      const data = await fetchJson('https://mp.toutiao.com/mp/agw/media/get_media_info');
      if (data.data?.user?.id) {
        return platformInfo(this.platform, true, data.data.user.screen_name, String(data.data.user.id));
      }
      return platformInfo(this.platform, false);
    } catch (error) {
      return platformInfo(this.platform, false, '', '', error.message);
    }
  }

  shouldSkipImage(src) {
    return !src.startsWith('data:') && ['pstatp.com', 'toutiao.com', 'byteimg.com'].some((pattern) => src.includes(pattern));
  }

  async getCsrfToken() {
    const response = await fetch('https://mp.toutiao.com/ttwid/check/', {
      method: 'HEAD',
      credentials: 'include',
      headers: {
        'x-secsdk-csrf-request': '1',
        'x-secsdk-csrf-version': '1.2.22',
      },
    });
    return response.headers.get('x-ware-csrf-token') || '';
  }

  async uploadImageByUrl(src) {
    const blob = await urlToBlob(src);
    const csrf = await this.getCsrfToken();
    const formData = new FormData();
    formData.append('image', blob, 'image.jpg');
    const raw = await (await fetch('https://mp.toutiao.com/spice/image?upload_source=20020002&aid=1231&device_platform=web', {
      method: 'POST',
      credentials: 'include',
      headers: { 'x-secsdk-csrf-token': csrf },
      body: formData,
    })).text();
    let data;
    try {
      data = JSON.parse(raw);
    } catch {
      throw new Error('Toutiao image upload response parse failed');
    }
    if (data.code !== 0 || !data.data?.image_url || !data.data?.image_uri) throw new Error(data.message || 'Toutiao image upload failed');
    return {
      url: data.data.image_url,
      attrs: {
        class: '',
        'ic-uri': '',
        image_type: blob.type || 'image/png',
        mime_type: '',
        web_uri: data.data.image_uri,
        img_width: String(data.data.image_width || 0),
        img_height: String(data.data.image_height || 0),
      },
    };
  }

  async saveArticle(article, options) {
    let content = String(article.html || '').replace(/<figure[^>]*>\s*<\/figure>/gi, '').replace(/\n{3,}/g, '\n\n');
    const cover = article.coverUpload && !article.coverUpload.error ? article.coverUpload : null;
    content = injectCoverImage(content, cover);
    content = content.replace(/<img\s+([^>]+)>/gi, '<div class="pgc-img"><img $1><p class="pgc-img-caption"></p></div>');
    const titleId = `${Date.now()}_${Math.random().toString().slice(2, 18)}`;
    const coverList = cover ? [toutiaoCover(cover)] : [];
    const body = new URLSearchParams();
    body.append('pgc_id', '0');
    body.append('source', '29');
    body.append('extra', JSON.stringify({
      content_source: 100000000402,
      content_word_cnt: content.length,
      is_multi_title: 0,
      sub_titles: [],
      gd_ext: { entrance: '', from_page: 'publisher_mp', enter_from: 'PC', device_platform: 'mp', is_message: 0 },
    }));
    body.append('content', content);
    body.append('title', article.title);
    body.append('search_creation_info', JSON.stringify({ searchTopOne: 0, abstract: '', clue_id: '' }));
    body.append('title_id', titleId);
    body.append('mp_editor_stat', '{}');
    body.append('is_refute_rumor', '0');
    body.append('save', options.publish ? '1' : '0');
    body.append('timer_status', '0');
    body.append('timer_time', '');
    body.append('educluecard', '');
    body.append('draft_form_data', JSON.stringify({ coverType: cover ? 1 : 3 }));
    body.append('pgc_feed_covers', JSON.stringify(coverList));
    body.append('article_ad_type', '3');
    body.append('is_fans_article', '0');
    body.append('govern_forward', '0');
    body.append('praise', '0');
    body.append('disable_praise', '0');
    body.append('tree_plan_article', '0');
    body.append('activity_tag', '0');
    body.append('trends_writing_tag', '0');
    body.append('claim_exclusive', '0');

    const data = await executeFetchInPlatformTab(
      this.platform,
      'https://mp.toutiao.com/mp/agw/article/publish?source=mp&type=article&aid=1231',
      'POST',
      body.toString(),
      { 'Content-Type': 'application/x-www-form-urlencoded' },
    );
    if (data.err_no !== 0 || !data.data?.pgc_id) throw new Error(data.message || 'Toutiao save failed');
    const postId = data.data.pgc_id;
    return this.result(true, {
      title: article.title,
      postId,
      postUrl: `https://mp.toutiao.com/profile_v4/graphic/publish?pgc_id=${postId}`,
      draftOnly: !options.publish,
      message: `api=article/publish; cover=${Boolean(cover)}`,
    });
  }
}

class BaijiahaoAdapter extends BaseAdapter {
  async checkAuth() {
    try {
      const data = await fetchJson(`https://baijiahao.baidu.com/builder/app/appinfo?_=${Date.now()}`);
      if (data.errmsg === 'success' && data.data?.user) return platformInfo(this.platform, true, data.data.user.name, data.data.user.userid);
      return platformInfo(this.platform, false);
    } catch (error) {
      return platformInfo(this.platform, false, '', '', error.message);
    }
  }

  shouldSkipImage(src) {
    return !src.startsWith('data:') && ['baijiahao.baidu.com', 'bdstatic.com', 'bcebos.com'].some((pattern) => src.includes(pattern));
  }

  async fetchAuthToken() {
    const html = await (await fetch('https://baijiahao.baidu.com/builder/rc/edit', { credentials: 'include' })).text();
    const token = html.match(/window\.__BJH__INIT__AUTH__\s*=\s*['"]([^'"]+)["']/)?.[1];
    if (!token) throw new Error('Baijiahao auth token not found');
    return token;
  }

  async uploadImageByUrl(src) {
    const blob = await urlToBlob(src);
    const formData = new FormData();
    formData.append('media', blob, 'image.jpg');
    formData.append('type', 'image');
    formData.append('app_id', '1589639493090963');
    formData.append('is_waterlog', '1');
    formData.append('save_material', '1');
    formData.append('no_compress', '0');
    formData.append('is_events', '');
    formData.append('article_type', 'news');
    const data = await (await fetch('https://baijiahao.baidu.com/pcui/picture/uploadproxy', { method: 'POST', credentials: 'include', body: formData })).json();
    if (data.errmsg !== 'success' || !data.ret?.https_url) throw new Error(data.errmsg || 'Baijiahao image upload failed');
    return { url: data.ret.https_url };
  }

  async saveArticle(article, options) {
    const token = await this.fetchAuthToken();
    const cover = article.coverUpload && !article.coverUpload.error ? article.coverUpload : null;
    const content = injectCoverImage(article.html || '', cover);
    const text = await (await fetch('https://baijiahao.baidu.com/pcui/article/save?callback=bjhdraft', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/x-www-form-urlencoded', token }, body: new URLSearchParams({ title: article.title, content, feed_cat: '1', len: String(content.length), activity_list: JSON.stringify([{ id: 408, is_checked: 0 }]), source_reprinted_allow: '0', original_status: '0', original_handler_status: '1', isBeautify: 'false', subtitle: '', bjhtopic_id: '', bjhtopic_info: '', type: 'news' }) })).text();
    const data = JSON.parse(text.replace(/^bjhdraft\(/, '').replace(/\)$/, ''));
    if (data.errmsg !== 'success' || !data.ret?.article_id) throw new Error(data.errmsg || 'Baijiahao save failed');
    return this.result(true, { title: article.title, postId: data.ret.article_id, postUrl: `https://baijiahao.baidu.com/builder/rc/edit?type=news&article_id=${data.ret.article_id}`, draftOnly: !options.publish, message: `api=article/save; cover=${Boolean(cover)}` });
  }
}

class BilibiliAdapter extends BaseAdapter {
  async checkAuth() {
    try {
      const data = await fetchJson('https://api.bilibili.com/x/web-interface/nav?build=0&mobi_app=web');
      if (data.code === 0 && data.data?.isLogin) {
        this.csrf = await getCookie('.bilibili.com', 'bili_jct');
        return platformInfo(this.platform, true, data.data.uname, String(data.data.mid));
      }
      return platformInfo(this.platform, false);
    } catch (error) {
      return platformInfo(this.platform, false, '', '', error.message);
    }
  }

  shouldSkipImage(src) {
    return !src.startsWith('data:') && ['hdslb.com', 'bilibili.com', 'biliimg.com'].some((pattern) => src.includes(pattern));
  }

  async uploadImageByUrl(src) {
    if (!this.csrf) this.csrf = await getCookie('.bilibili.com', 'bili_jct');
    if (!this.csrf) throw new Error('Bilibili csrf not found');
    const blob = await urlToBlob(src);
    const formData = new FormData();
    formData.append('binary', blob, 'image.jpg');
    formData.append('csrf', this.csrf);
    const data = await (await fetch('https://api.bilibili.com/x/article/creative/article/upcover', { method: 'POST', credentials: 'include', body: formData })).json();
    if (data.code !== 0 || !data.data?.url) throw new Error(data.message || 'Bilibili image upload failed');
    return { url: data.data.url, attrs: { size: String(data.data.size) } };
  }

  async saveArticle(article, options) {
    if (!this.csrf) this.csrf = await getCookie('.bilibili.com', 'bili_jct');
    const data = await postFormJson('https://api.bilibili.com/x/article/creative/draft/addupdate', { tid: '4', title: article.title, content: article.html || '', csrf: this.csrf, save: '0', pgc_id: '0' });
    if (data.code !== 0 || !data.data?.aid) throw new Error(data.message || 'Bilibili save failed');
    return this.result(true, { title: article.title, postId: String(data.data.aid), postUrl: `https://member.bilibili.com/platform/upload/text/edit?aid=${data.data.aid}`, draftOnly: !options.publish, message: `api=draft/addupdate; cover=${Boolean(article.coverUpload && !article.coverUpload.error)}` });
  }
}

class ZhihuAdapter extends BaseAdapter {
  async checkAuth() {
    try {
      const data = await fetchJson('https://www.zhihu.com/api/v4/me', { headers: { 'x-requested-with': 'fetch' } });
      if (data.id) return platformInfo(this.platform, true, data.name, data.id);
      return platformInfo(this.platform, false);
    } catch (error) {
      return platformInfo(this.platform, false, '', '', error.message);
    }
  }

  shouldSkipImage(src) {
    return !src.startsWith('data:') && ['zhimg.com', 'pic1.zhimg.com', 'pic2.zhimg.com', 'pic3.zhimg.com', 'pic4.zhimg.com'].some((pattern) => src.includes(pattern));
  }

  async uploadImageByUrl(src) {
    if (src.startsWith('data:')) return { url: src };
    const data = await postFormJson('https://zhuanlan.zhihu.com/api/uploaded_images', { url: src, source: 'article' }, { 'x-requested-with': 'fetch' });
    if (!data.src) throw new Error('Zhihu image upload failed');
    return { url: data.src };
  }

  async saveArticle(article, options) {
    const create = await (await fetch('https://zhuanlan.zhihu.com/api/articles/drafts', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json', 'x-requested-with': 'fetch' }, body: JSON.stringify({ title: article.title, content: '', delta_time: 0 }) })).json();
    if (!create.id) throw new Error('Zhihu draft id not returned');
    const response = await fetch(`https://zhuanlan.zhihu.com/api/articles/${create.id}/draft`, { method: 'PATCH', credentials: 'include', headers: { 'Content-Type': 'application/json', 'x-requested-with': 'fetch' }, body: JSON.stringify({ title: article.title, content: transformZhihuContent(article.html || '') }) });
    if (!response.ok) throw new Error(`Zhihu update draft failed: ${response.status}`);
    return this.result(true, { title: article.title, postId: create.id, postUrl: `https://zhuanlan.zhihu.com/p/${create.id}/edit`, draftOnly: !options.publish, message: `api=articles/drafts; cover=${Boolean(article.coverUpload && !article.coverUpload.error)}` });
  }
}

class ComposerAdapter extends BaseAdapter {
  async prepareArticle(article) {
    return article;
  }

  async saveArticle(article, options) {
    const tab = await chrome.tabs.create({ url: this.platform.composeUrl, active: true });
    await waitForTabComplete(tab.id, 45000);
    await sleep(2500);
    const [injection] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: fillComposer, args: [this.platform, article, options.publish], world: 'MAIN' });
    const result = injection?.result || {};
    if (!result.success) throw new Error(result.error || 'Composer fill failed');
    return this.result(true, { title: article.title, postUrl: tab.url, draftOnly: !options.publish, message: `api=composer-fallback; ${result.message}` });
  }
}

function platformInfo(platform, isAuthenticated, username = '', userId = '', error = '') {
  return { id: platform.id, name: platform.name, loginUrl: platform.loginUrl, composeUrl: platform.composeUrl, mode: platform.mode, isAuthenticated, username, userId, error };
}

function injectCoverImage(content, cover) {
  if (!cover?.url || String(content).includes(cover.url)) return String(content || '');
  const attrs = Object.entries(cover.attrs || {})
    .map(([key, value]) => ` ${key}="${escapeHtml(String(value))}"`)
    .join('');
  return `<p><img src="${escapeHtml(cover.url)}"${attrs} /></p>${content || ''}`;
}

function toutiaoCover(cover) {
  return {
    url: cover.url,
    uri: cover.attrs?.web_uri || cover.attrs?.uri || '',
    web_uri: cover.attrs?.web_uri || cover.attrs?.uri || '',
    width: Number(cover.attrs?.img_width || cover.width || 0),
    height: Number(cover.attrs?.img_height || cover.height || 0),
  };
}

async function executeFetchInPlatformTab(platform, url, method, body, headers = {}) {
  const existing = await chrome.tabs.query({ url: `https://${platform.domains[0]}/*` });
  const tab = existing.find((item) => item.id) || await chrome.tabs.create({ url: platform.composeUrl, active: false });
  await waitForTabComplete(tab.id, 45000);
  const [injection] = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    world: 'MAIN',
    func: async (requestUrl, requestMethod, requestBody, requestHeaders) => {
      try {
        const response = await fetch(requestUrl, {
          method: requestMethod,
          credentials: 'include',
          headers: requestHeaders,
          body: requestBody,
        });
        const text = await response.text();
        let data;
        try {
          data = JSON.parse(text);
        } catch {
          data = { raw: text };
        }
        return { success: response.ok, status: response.status, data };
      } catch (error) {
        return { success: false, error: error.message };
      }
    },
    args: [url, method, body, headers],
  });
  const result = injection?.result;
  if (!result?.success) throw new Error(result?.error || result?.data?.message || `Platform request failed: ${result?.status || 'unknown'}`);
  return result.data;
}

async function executeFormDataInPlatformTab(platform, url, formData, timeoutMs = 90000) {
  const existing = await chrome.tabs.query({ url: `https://${platform.domains[0]}/*` });
  const tab = existing.find((item) => item.id) || await chrome.tabs.create({ url: platform.composeUrl, active: false });
  await waitForTabComplete(tab.id, 45000);
  const entries = [];
  for (const [key, value] of formData.entries()) {
    if (value instanceof Blob) {
      entries.push({ key, kind: 'blob', name: value.name || 'file.jpg', type: value.type || 'application/octet-stream', bytes: [...new Uint8Array(await value.arrayBuffer())] });
    } else {
      entries.push({ key, kind: 'text', value: String(value) });
    }
  }
  const [injection] = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    world: 'MAIN',
    func: async (requestUrl, serializedEntries, requestTimeoutMs) => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), requestTimeoutMs);
      try {
        const body = new FormData();
        for (const entry of serializedEntries) {
          if (entry.kind === 'blob') {
            body.append(entry.key, new File([new Uint8Array(entry.bytes)], entry.name, { type: entry.type }), entry.name);
          } else {
            body.append(entry.key, entry.value);
          }
        }
        const response = await fetch(requestUrl, { method: 'POST', credentials: 'include', body, signal: controller.signal });
        const text = await response.text();
        let data;
        try {
          data = JSON.parse(text);
        } catch {
          data = { raw: text };
        }
        return { success: response.ok, status: response.status, data };
      } catch (error) {
        return { success: false, error: error.message || 'Platform form request failed' };
      } finally {
        clearTimeout(timer);
      }
    },
    args: [url, entries, timeoutMs],
  });
  const result = injection?.result;
  if (!result?.success) throw new Error(result?.error || result?.data?.message || `Platform form request failed: ${result?.status || 'unknown'}`);
  return result.data;
}

async function fetchJson(url, options = {}) {
  return await (await fetch(url, { credentials: 'include', ...options })).json();
}

async function postFormJson(url, data, headers = {}) {
  return await (await fetch(url, { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/x-www-form-urlencoded', ...headers }, body: new URLSearchParams(data) })).json();
}

async function getCookie(domain, name) {
  const cookies = await chrome.cookies.getAll({ domain, name });
  return cookies[0]?.value || '';
}

async function urlToBlob(src) {
  if (String(src).startsWith('data:')) return dataUriToBlob(src);
  const response = await fetchWithTimeout(src, {}, 60000, 'Image download');
  if (!response.ok) throw new Error(`Image download failed: ${src}`);
  return await response.blob();
}

function dataUriToBlob(src) {
  const match = String(src).match(/^data:([^;,]+)?(;base64)?,([\s\S]*)$/);
  if (!match) throw new Error('Invalid data URI image');
  const mime = match[1] || 'application/octet-stream';
  const isBase64 = Boolean(match[2]);
  const raw = isBase64 ? atob(match[3]) : decodeURIComponent(match[3]);
  const bytes = new Uint8Array(raw.length);
  for (let index = 0; index < raw.length; index += 1) bytes[index] = raw.charCodeAt(index);
  return new Blob([bytes], { type: mime });
}

async function fetchWithTimeout(url, options = {}, timeoutMs = 60000, label = 'Fetch') {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(`${label} timeout after ${timeoutMs}ms`), timeoutMs);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    if (!response.ok) throw new Error(`${label} failed status=${response.status}`);
    return response;
  } catch (error) {
    if (error.name === 'AbortError') throw new Error(`${label} timeout after ${timeoutMs}ms`);
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function extractImages(content) {
  const matches = [];
  let match;
  const htmlRegex = /<img[^>]+src=["']([^"']+)["'][^>]*>/gi;
  while ((match = htmlRegex.exec(content)) !== null) matches.push({ full: match[0], src: match[1], type: 'html' });
  const mdRegex = /!\[([^\]]*)\]\(([^)]+)\)/g;
  while ((match = mdRegex.exec(content)) !== null) matches.push({ full: match[0], src: match[2], alt: match[1], type: 'markdown' });
  return matches;
}

function replaceImage(match, upload) {
  if (match.type === 'markdown') return `![${match.alt || ''}](${upload.url})`;
  let next = `<img src="${upload.url}"`;
  if (upload.attrs) for (const [key, value] of Object.entries(upload.attrs)) next += ` ${key}="${escapeHtml(String(value))}"`;
  return `${next} />`;
}

function removeImage(match) {
  return match.type === 'markdown' ? '' : '';
}

function summarizeImageSource(src) {
  if (!src) return '';
  if (src.startsWith('data:')) return src.slice(0, 42) + '...';
  return src.slice(0, 160);
}

function weixinForm(token, article, cover) {
  return {
    token, lang: 'zh_CN', f: 'json', ajax: '1', random: String(Math.random()), AppMsgId: '', count: '1', data_seq: '0', operate_from: 'Chrome', isnew: '0',
    ad_video_transition0: '', can_reward0: '0', related_video0: '', is_video_recommend0: '-1',
    title0: article.title, author0: '', writerid0: '0', fileid0: '', digest0: article.summary || '', auto_gen_digest0: article.summary ? '0' : '1',
    content0: `<section style="margin-left: 6px; margin-right: 6px; line-height: 1.75em;">${stripExternalLinks(article.html || '')}</section>`,
    sourceurl0: '', need_open_comment0: '1', only_fans_can_comment0: '0',
    cdn_url0: cover?.url || '', cdn_235_1_url0: cover?.url || '', cdn_1_1_url0: cover?.url || '', cdn_url_back0: cover?.url || '', crop_list0: cover ? JSON.stringify([{ ratio: '1_1', x1: 0, y1: 0, x2: 1, y2: 1 }]) : '',
    music_id0: '', video_id0: '', voteid0: '', voteismlt0: '', supervoteid0: '', cardid0: '', cardquantity0: '', cardlimit0: '', vid_type0: '', show_cover_pic0: cover ? '1' : '0',
    shortvideofileid0: '', copyright_type0: '0', releasefirst0: '', platform0: '', reprint_permit_type0: '', allow_reprint0: '', allow_reprint_modify0: '', original_article_type0: '', ori_white_list0: '',
    free_content0: '', fee0: '0', ad_id0: '', guide_words0: '', is_share_copyright0: '0', share_copyright_url0: '', source_article_type0: '', reprint_recommend_title0: '', reprint_recommend_content0: '',
    share_page_type0: '0', share_imageinfo0: '{"list":[]}', share_video_id0: '', dot0: '{}', share_voice_id0: '', insert_ad_mode0: '', categories_list0: '[]',
  };
}

function stripExternalLinks(content) {
  return String(content).replace(/<a\s+[^>]*href=["']([^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi, (full, href, text) => (href.includes('mp.weixin.qq.com') || href.includes('weixin.qq.com') || href.startsWith('#') ? full : text));
}

function transformZhihuContent(content) {
  return String(content).replace(/<img([^>]+)src="([^"]+)"([^>]*)>/gi, '<figure><img$1src="$2"$3></figure>').replace(/\s*data-(?!draft)[a-z-]+="[^"]*"/gi, '').replace(/\s*style="[^"]*"/gi, '');
}

function htmlToPlainText(html) {
  return String(html).replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|h[1-6]|li|blockquote)>/gi, '\n').replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').trim();
}

function escapeHtml(value) {
  return String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function waitForTabComplete(tabId, timeoutMs) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { chrome.tabs.onUpdated.removeListener(listener); reject(new Error('Composer page load timeout')); }, timeoutMs);
    const listener = (id, info) => {
      if (id === tabId && info.status === 'complete') {
        clearTimeout(timer);
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      }
    };
    chrome.tabs.onUpdated.addListener(listener);
    chrome.tabs.get(tabId).then((tab) => { if (tab.status === 'complete') { clearTimeout(timer); chrome.tabs.onUpdated.removeListener(listener); resolve(); } }).catch(() => {});
  });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function fillComposer(platform, article, publish) {
  const visible = (node) => {
    if (!node) return false;
    const rect = node.getBoundingClientRect();
    const style = getComputedStyle(node);
    return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
  };
  const queryFirst = (selectors) => {
    for (const selector of selectors || []) {
      try {
        const node = Array.from(document.querySelectorAll(selector)).find(visible);
        if (node) return node;
      } catch {}
    }
    return null;
  };
  const setValue = (node, value, html = false) => {
    if (!node) return false;
    node.focus();
    if (node.isContentEditable) {
      node.innerHTML = html ? value : value.replace(/\n/g, '<br>');
      node.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: value }));
      node.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    }
    const proto = node.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value')?.set?.call(node, value);
    node.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: value }));
    node.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  };
  const clickByLabel = (labels) => {
    const button = Array.from(document.querySelectorAll('button, [role="button"], a, div')).find((node) => visible(node) && labels.some((label) => (node.innerText || node.textContent || '').trim().includes(label)));
    if (!button) return false;
    button.click();
    return true;
  };
  const setCoverFile = async (src) => {
    if (!src || !src.startsWith('data:')) return false;
    clickByLabel(platform.coverLabels || []);
    await new Promise((resolve) => setTimeout(resolve, 500));
    const input = Array.from(document.querySelectorAll('input[type="file"]')).find((node) => {
      const accept = node.getAttribute('accept') || '';
      return accept.includes('image') || accept.includes('.png') || accept.includes('.jpg') || accept === '';
    });
    if (!input) return false;
    const match = src.match(/^data:([^;]+);base64,(.+)$/);
    if (!match) return false;
    const bytes = Uint8Array.from(atob(match[2]), (char) => char.charCodeAt(0));
    const ext = match[1].split('/')[1] || 'jpg';
    const file = new File([bytes], `cover.${ext}`, { type: match[1] });
    const transfer = new DataTransfer();
    transfer.items.add(file);
    input.files = transfer.files;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  };
  return (async () => {
    const titleOk = platform.id === 'x' || setValue(queryFirst(platform.titleSelectors), article.title || '');
    const contentValue = platform.contentMode === 'text' ? (article.text || article.markdown || article.html || '') : (article.html || article.markdown || article.text || '');
    const contentOk = setValue(queryFirst(platform.editorSelectors), contentValue, platform.contentMode !== 'text');
    const coverOk = await setCoverFile(article.cover);
    let published = false;
    if (publish) {
      published = clickByLabel(platform.publishLabels || ['发布']);
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
    return { success: Boolean(titleOk && contentOk && (!publish || published)), message: `title=${titleOk}; content=${contentOk}; cover=${coverOk}; publish=${published}`, error: titleOk && contentOk ? 'Publish button not found' : 'Title or content editor not found' };
  })();
}
