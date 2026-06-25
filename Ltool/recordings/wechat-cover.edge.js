import { existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright';
import { CHROME_PROFILE_DIR, EDGE_PROFILE_DIR, restoreEdgeStorageState, saveEdgeStorageState } from '../src/edge-ltool.js';

const TEXT = {
  login: '\u767b\u5f55',
  saveDraft: '\u4fdd\u5b58\u4e3a\u8349\u7a3f',
  saveDraftAlt: '\u4fdd\u5b58\u8349\u7a3f',
  save: '\u4fdd\u5b58',
  ok: '\u786e\u5b9a',
  confirm: '\u786e\u8ba4',
  originalUnset: '\u672a\u58f0\u660e',
  authorPlaceholder: '\u8bf7\u8f93\u5165\u4f5c\u8005',
  collectionUnset: '\u672a\u6dfb\u52a0',
  collectionPlaceholder: '\u8bf7\u9009\u62e9\u5408\u96c6',
  defaultAuthor: '\u516d\u96f6',
  defaultCollection: 'AI',
  cover: '\u5c01\u9762',
  publish: '\u53d1\u8868',
  continuePublish: '\u7ee7\u7eed\u53d1\u8868',
};

const draftUrl = process.env.LTOOL_WECHAT_DRAFT_URL;
const browserChannel = process.env.LTOOL_WECHAT_BROWSER === 'chrome' ? 'chrome' : (process.env.LTOOL_WECHAT_BROWSER === 'edge' ? 'msedge' : process.env.LTOOL_WECHAT_BROWSER || 'msedge');
const defaultUserDataDir = browserChannel === 'chrome' ? CHROME_PROFILE_DIR : EDGE_PROFILE_DIR;
const userDataDir = resolve(process.env.LTOOL_CHROME_USER_DATA_DIR || process.env.LTOOL_EDGE_USER_DATA_DIR || defaultUserDataDir);

export async function runWechatDraftFlow({
  draftUrl,
  context,
  userDataDir = defaultUserDataDir,
  channel = browserChannel,
  author = process.env.LTOOL_WECHAT_AUTHOR || TEXT.defaultAuthor,
  collection = process.env.LTOOL_WECHAT_COLLECTION || TEXT.defaultCollection,
  saveDraft = process.env.LTOOL_WECHAT_SAVE_DRAFT !== 'false',
  publish = process.env.LTOOL_WECHAT_PUBLISH === 'true',
  screenshotPath = process.env.LTOOL_WECHAT_QR_SCREENSHOT || '',
  loginWaitMs = Number(process.env.LTOOL_WECHAT_LOGIN_WAIT_MS || 180000),
} = {}) {
  if (!draftUrl) throw new Error('Missing LTOOL_WECHAT_DRAFT_URL');

  const ownsContext = !context;
  const browserContext = context || await chromium.launchPersistentContext(resolve(userDataDir), {
    channel,
    headless: false,
    ignoreDefaultArgs: ['--disable-extensions', '--disable-component-extensions-with-background-pages'],
    args: ['--disable-blink-features=AutomationControlled'],
  });
  if (ownsContext) await restoreEdgeStorageState(browserContext);

  const page = await openSingleDraftPage(browserContext, draftUrl, { loginWaitMs });
  try {
    console.log('[edge-wechat] draft page opened');
    await assertWechatEditorPage(page);
    console.log('[edge-wechat] editor authenticated');
    await closeBlockingDialogs(page);
    await fillOriginalAuthor(page, author);
    await chooseCollection(page, collection);
    if (saveDraft) {
      await clickSaveDraft(page);
      console.log('[edge-wechat] draft save requested');
    }
    let qrScreenshot = '';
    if (publish) {
      qrScreenshot = await publishAndCaptureQr(page, screenshotPath);
      console.log(`[edge-wechat] qr screenshot saved: ${qrScreenshot}`);
    }
    const state = await getWechatDraftState(page);
    if (qrScreenshot) state.qrScreenshot = qrScreenshot;
    assertDraftState(state);
    console.log(`Edge WeChat draft is ready: ${state.url}`);
    console.log(JSON.stringify(state));
    return state;
  } finally {
    if (ownsContext) await saveEdgeStorageState(browserContext).catch(() => {});
    if (ownsContext) await browserContext.close();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await runWechatDraftFlow({ draftUrl, userDataDir, channel: browserChannel });
}

async function openSingleDraftPage(context, targetUrl, { loginWaitMs = 180000 } = {}) {
  const pages = context.pages();
  const page = pages[0] || await context.newPage();
  for (const extra of pages.slice(1)) await extra.close().catch(() => {});
  await page.goto('about:blank').catch(() => {});
  await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForLoadState('networkidle', { timeout: 20000 }).catch(() => {});
  if (await isWechatLoginPage(page)) {
    console.log('[edge-wechat] login page detected; waiting for login');
    await clickWechatLogin(page).catch(() => {});
    await waitForWechatLogin(page, loginWaitMs);
    await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForLoadState('networkidle', { timeout: 20000 }).catch(() => {});
  }
  return page;
}

async function assertWechatEditorPage(page) {
  if (/\/cgi-bin\/loginpage|\/acct\/login/.test(page.url())) {
    throw new Error('WeChat editor redirected to login. Edge login state is missing or expired.');
  }
  await page.waitForFunction(() => {
    const text = document.body.innerText;
    return /appmsg|ueditor/i.test(location.href)
      || text.includes('\u4fdd\u5b58\u4e3a\u8349\u7a3f')
      || text.includes('\u4fdd\u5b58\u8349\u7a3f')
      || text.includes('\u5c01\u9762');
  }, null, { timeout: 30000 }).catch(() => {});
  const loginVisible = await page.getByText(TEXT.login, { exact: true }).first().isVisible({ timeout: 1000 }).catch(() => false);
  const saveVisible = await isAnyVisible(page, [
    page.getByRole('button', { name: TEXT.saveDraft }).first(),
    page.getByRole('button', { name: TEXT.saveDraftAlt }).first(),
    page.getByText(TEXT.saveDraft, { exact: false }).first(),
    page.getByText(TEXT.saveDraftAlt, { exact: false }).first(),
  ]);
  if (loginVisible && !saveVisible) throw new Error('WeChat page is not authenticated in the Edge profile.');
  if (!saveVisible && !/appmsgid=\d+/.test(page.url())) throw new Error('WeChat draft editor controls were not found.');
}

async function isWechatLoginPage(page) {
  if (/\/cgi-bin\/loginpage|\/acct\/login/.test(page.url())) return true;
  const text = await page.locator('body').innerText({ timeout: 3000 }).catch(() => '');
  return /登录超时|重新登录/.test(text) || (text.includes(TEXT.login) && !text.includes(TEXT.saveDraft) && !text.includes(TEXT.saveDraftAlt));
}

async function clickWechatLogin(page) {
  const candidates = [
    page.getByRole('button', { name: /登录|Log in/i }).first(),
    page.getByText(TEXT.login, { exact: true }).first(),
    page.locator('a,button').filter({ hasText: /登录|Log in/i }).first(),
  ];
  for (const locator of candidates) {
    if (await locator.count().catch(() => 0)) {
      await locator.click({ timeout: 5000 }).catch(() => {});
      await page.waitForTimeout(1000);
      return true;
    }
  }
  return false;
}

async function waitForWechatLogin(page, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const loginPage = await isWechatLoginPage(page).catch(() => true);
    const url = page.url();
    if (!loginPage && /mp\.weixin\.qq\.com/.test(url)) return true;
    await page.waitForTimeout(3000);
  }
  throw new Error(`WeChat login was not completed within ${timeoutMs}ms`);
}

async function closeBlockingDialogs(page) {
  await page.keyboard.press('Escape').catch(() => {});
  await page.waitForTimeout(500);
  await page.evaluate(() => {
    for (const selector of ['.weui-desktop-mask', '.weui-desktop-dialog', '.popover', '.tooltip']) {
      for (const node of document.querySelectorAll(selector)) {
        const text = node.innerText || '';
        if (!text.includes('\u786e\u5b9a') && !text.includes('\u786e\u8ba4')) {
          node.style.pointerEvents = 'none';
        }
      }
    }
  }).catch(() => {});
}

async function fillOriginalAuthor(page, author) {
  if (!author) return false;
  const originalBox = page.locator('#js_original_edit_box').first();
  if (!(await originalBox.count().catch(() => 0))) return false;
  const trigger = originalBox.getByText(TEXT.originalUnset, { exact: false }).first();
  if (await trigger.count().catch(() => 0)) {
    await trigger.click({ timeout: 5000 }).catch(() => {});
  }
  const textbox = originalBox.getByRole('textbox', { name: new RegExp(TEXT.authorPlaceholder) }).first();
  if (await textbox.count().catch(() => 0)) {
    await textbox.click({ timeout: 5000 }).catch(() => {});
    await textbox.fill(author, { timeout: 5000 }).catch(() => {});
    await clickScopedButton(originalBox, [TEXT.ok, TEXT.confirm]).catch(() => {});
    await page.waitForTimeout(800);
    console.log('[edge-wechat] original author handled');
    return true;
  }
  return false;
}

async function chooseCollection(page, collection) {
  if (!collection) return false;
  const area = page.locator('#js_article_tags_area').first();
  if (!(await area.count().catch(() => 0))) return false;
  const unset = area.getByText(TEXT.collectionUnset, { exact: false }).first();
  if (await unset.count().catch(() => 0)) {
    await unset.scrollIntoViewIfNeeded().catch(() => {});
    await unset.click({ timeout: 5000 }).catch(() => {});
  }
  const input = page.getByRole('textbox', { name: new RegExp(TEXT.collectionPlaceholder) }).first();
  if (await input.count().catch(() => 0)) {
    await input.click({ timeout: 5000 }).catch(() => {});
  }
  const option = page.getByText(collection, { exact: true }).last();
  if (await option.count().catch(() => 0)) {
    await option.click({ timeout: 5000 }).catch(() => {});
    await clickFirstVisible(page, [
      page.getByRole('button', { name: TEXT.confirm }).last(),
      page.getByRole('button', { name: TEXT.ok }).last(),
    ]).catch(() => {});
    await page.waitForTimeout(800);
    console.log('[edge-wechat] collection handled');
    return true;
  }
  return false;
}

async function clickSaveDraft(page) {
  await clickFirstVisible(page, [
    page.getByRole('button', { name: TEXT.saveDraft }).first(),
    page.getByRole('button', { name: TEXT.saveDraftAlt }).first(),
    page.getByText(TEXT.saveDraft, { exact: false }).first(),
    page.getByText(TEXT.saveDraftAlt, { exact: false }).first(),
    page.getByText(TEXT.save, { exact: true }).first(),
  ], 30000);
  await page.waitForTimeout(1000);
  await clickFirstVisible(page, [
    page.getByRole('button', { name: TEXT.ok }).last(),
    page.getByRole('button', { name: TEXT.confirm }).last(),
  ], 3000).catch(() => {});
  await page.waitForFunction(() => {
    const text = document.body.innerText;
    return !text.includes('\u4fdd\u5b58\u4e2d') && !text.includes('\u6b63\u5728\u4fdd\u5b58');
  }, null, { timeout: 90000 }).catch(() => {});
  await page.waitForTimeout(2000);
}

async function publishAndCaptureQr(page, screenshotPath = '') {
  await clickFirstVisible(page, [
    page.getByRole('button', { name: TEXT.publish }).first(),
    page.getByText(TEXT.publish, { exact: true }).first(),
  ], 30000);
  await page.waitForTimeout(1000);
  await clickPublishSwitches(page);
  await clickFirstVisible(page, [
    page.locator('#vue_app').getByRole('button', { name: TEXT.publish }).first(),
    page.getByRole('button', { name: TEXT.publish }).last(),
  ], 30000).catch(() => {});
  await page.waitForTimeout(1000);
  await clickFirstVisible(page, [
    page.getByRole('button', { name: TEXT.continuePublish }).last(),
    page.getByText(TEXT.continuePublish, { exact: false }).last(),
    page.getByRole('button', { name: TEXT.confirm }).last(),
    page.getByRole('button', { name: TEXT.ok }).last(),
  ], 30000).catch(() => {});
  await waitForQrPage(page);
  const output = resolve(screenshotPath || defaultQrScreenshotPath(page));
  mkdirSync(dirname(output), { recursive: true });
  await page.screenshot({ path: output, fullPage: true });
  return output;
}

async function clickPublishSwitches(page) {
  const switches = page.locator('.weui-desktop-switch__box');
  const count = await switches.count().catch(() => 0);
  if (count > 0) {
    await switches.first().click({ timeout: 5000 }).catch(() => {});
    await page.waitForTimeout(500);
  }
}

async function waitForQrPage(page) {
  await page.waitForFunction(() => {
    const text = document.body.innerText;
    const images = [...document.querySelectorAll('img, canvas')].filter((node) => {
      const box = node.getBoundingClientRect();
      return box.width > 80 && box.height > 80;
    });
    return /二维码|扫码|微信扫一扫|管理员|确认发表|验证/.test(text) || images.length > 0;
  }, null, { timeout: 120000 });
  await page.waitForTimeout(1500);
}

function defaultQrScreenshotPath(page) {
  const appmsgid = new URL(page.url()).searchParams.get('appmsgid') || Date.now();
  return `Ltool/recordings/wechat-qr-${appmsgid}.png`;
}

async function getWechatDraftState(page) {
  return await page.evaluate(() => {
    const bodyText = document.body.innerText;
    const images = [...document.querySelectorAll('img')].filter((img) => {
      const src = img.getAttribute('src') || '';
      const box = img.getBoundingClientRect();
      return box.width > 20 && box.height > 20 && /mmbiz|qpic|data:image|blob:/.test(src);
    });
    return {
      url: location.href,
      appmsgid: new URL(location.href).searchParams.get('appmsgid') || '',
      coverCount: images.length,
      hasCoverText: bodyText.includes('\u5c01\u9762'),
      saveFailed: bodyText.includes('\u4fdd\u5b58\u5931\u8d25'),
      loginVisible: bodyText.includes('\u767b\u5f55'),
    };
  });
}

function assertDraftState(state) {
  if (state.loginVisible && !state.appmsgid) throw new Error('WeChat login state disappeared before draft verification.');
  if (state.saveFailed) throw new Error('WeChat draft save failed.');
  if (!state.appmsgid) throw new Error('WeChat draft URL does not contain appmsgid.');
}

async function isAnyVisible(page, locators) {
  for (const locator of locators) {
    if (await locator.isVisible({ timeout: 500 }).catch(() => false)) return true;
  }
  return false;
}

async function clickScopedButton(scope, labels) {
  for (const label of labels) {
    const button = scope.getByRole('button', { name: label }).last();
    if (await button.count().catch(() => 0)) {
      await button.click({ timeout: 3000 });
      return true;
    }
  }
  return false;
}

async function clickFirstVisible(page, locators, timeout = 10000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    for (const locator of locators) {
      if (await locator.count().catch(() => 0)) {
        await locator.scrollIntoViewIfNeeded().catch(() => {});
        await locator.click({ timeout: 2500 }).catch(async () => locator.evaluate((node) => node.click()));
        return true;
      }
    }
    await page.waitForTimeout(300);
  }
  throw new Error('Clickable WeChat draft control not found.');
}
