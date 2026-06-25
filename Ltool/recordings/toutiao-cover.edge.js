import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright';
import { EDGE_PROFILE_DIR, restoreEdgeStorageState, saveEdgeStorageState } from '../src/edge-ltool.js';

const TEXT = {
  login: '\u767b\u5f55',
  title: '\u6807\u9898',
  cover: '\u5c01\u9762',
  single: '\u5355\u56fe',
  firstToutiao: '\u5934\u6761\u9996\u53d1',
  firstPlatform: '\u5e73\u53f0\u9996\u53d1',
  firstStatement: '\u58f0\u660e\u9996\u53d1',
  addCover: '\u6dfb\u52a0\u5c01\u9762',
  uploadCover: '\u4e0a\u4f20\u5c01\u9762',
  chooseCover: '\u9009\u62e9\u5c01\u9762',
  replaceCover: '\u66f4\u6362\u5c01\u9762',
  localUpload: '\u672c\u5730\u4e0a\u4f20',
  uploadImage: '\u4e0a\u4f20\u56fe\u7247',
  ok: '\u786e\u5b9a',
  done: '\u5b8c\u6210',
  use: '\u4f7f\u7528',
  savingDraft: '\u8349\u7a3f\u4fdd\u5b58\u4e2d',
  saveFailed: '\u4fdd\u5b58\u5931\u8d25',
  previewAndPublish: '\u9884\u89c8\u5e76\u53d1\u5e03',
  publish: '\u53d1\u5e03',
  confirmPublish: '\u786e\u8ba4\u53d1\u5e03',
  publishSuccess: '\u53d1\u5e03\u6210\u529f',
  submitted: '\u63d0\u4ea4\u6210\u529f',
  auditing: '\u5ba1\u6838\u4e2d',
};

const draftUrl = process.env.LTOOL_TOUTIAO_DRAFT_URL;
const coverPath = process.env.LTOOL_COVER_PATH ? resolve(process.env.LTOOL_COVER_PATH) : '';
const userDataDir = resolve(process.env.LTOOL_EDGE_USER_DATA_DIR || EDGE_PROFILE_DIR);

export async function runToutiaoCoverFlow({
  draftUrl,
  coverPath,
  context,
  userDataDir = EDGE_PROFILE_DIR,
  publish = true,
} = {}) {
  if (!draftUrl) throw new Error('Missing LTOOL_TOUTIAO_DRAFT_URL');
  if (!coverPath) throw new Error('Missing LTOOL_COVER_PATH');
  if (!existsSync(coverPath)) throw new Error(`Cover image not found: ${coverPath}`);

  const ownsContext = !context;
  const browserContext = context || await chromium.launchPersistentContext(resolve(userDataDir), {
    channel: 'msedge',
    headless: false,
    args: ['--disable-blink-features=AutomationControlled'],
  });
  if (ownsContext) await restoreEdgeStorageState(browserContext);

  const page = await openSingleDraftPage(browserContext, draftUrl);
  try {
    console.log('[edge-cover] draft page opened');
    await assertToutiaoEditorPage(page);
    console.log('[edge-cover] editor authenticated');
    await closeBlockingDrawers(page);
    console.log('[edge-cover] blocking drawers closed');
    await switchCoverDisplayToSingleImage(page);
    console.log('[edge-cover] single-image cover mode selected');
    await enablePlatformFirstPublish(page);
    console.log('[edge-cover] platform first-publish handled');
    await openCoverUpload(page);
    console.log('[edge-cover] cover upload dialog opened');
    await uploadLocalCover(page, coverPath);
    console.log('[edge-cover] local cover uploaded');
    await selectUploadedCover(page);
    console.log('[edge-cover] uploaded cover selected');
    await waitForCoverAndDraftSave(page);
    console.log('[edge-cover] cover visible and draft save settled');

    let state = await getToutiaoState(page);
    assertCoverState(state);
    console.log('[edge-cover] cover state verified');

    if (publish) {
      console.log('[edge-cover] preview and publish starting');
      const publishResult = await previewAndConfirmPublish(page);
      console.log('[edge-cover] preview and publish actions completed');
      state = await getToutiaoState(page);
      state.publishSubmitted = publishResult.submitted;
      state.publishStatus = getPublishStatus(state);
      assertPublishState(state);
      console.log(`[edge-cover] publish state verified: ${state.publishStatus}`);
    }

    console.log(`Edge Toutiao cover${publish ? ' and publish' : ''} flow completed: ${draftUrl}`);
    console.log(formatToutiaoState(state));
    return state;
  } finally {
    if (ownsContext) await saveEdgeStorageState(browserContext).catch(() => {});
    if (ownsContext) await browserContext.close();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await runToutiaoCoverFlow({ draftUrl, coverPath, userDataDir, publish: process.env.LTOOL_TOUTIAO_PUBLISH !== 'false' });
}

async function openSingleDraftPage(context, draftUrl) {
  const pages = context.pages();
  const page = pages[0] || await context.newPage();
  for (const extra of pages.slice(1)) await extra.close().catch(() => {});
  await page.goto('about:blank').catch(() => {});
  await page.goto(draftUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForLoadState('networkidle', { timeout: 20000 }).catch(() => {});
  return page;
}

async function closeBlockingDrawers(page) {
  await page.keyboard.press('Escape').catch(() => {});
  await page.waitForTimeout(500);
  await page.evaluate(() => {
    for (const selector of ['.ai-assistant-drawer', '.byte-drawer-mask']) {
      for (const node of document.querySelectorAll(selector)) {
        node.style.pointerEvents = 'none';
        node.style.display = 'none';
      }
    }
  }).catch(() => {});
}

async function assertToutiaoEditorPage(page) {
  if (/\/auth\/page\/login/.test(page.url())) {
    throw new Error('Toutiao editor redirected to login page. Edge login state is missing or expired.');
  }
  const editorReady = await page.locator(`textarea[placeholder*="${TEXT.title}"], input[placeholder*="${TEXT.title}"], .ProseMirror, [contenteditable="true"]`).first().count().catch(() => 0);
  if (!editorReady && (await page.locator(`text=${TEXT.login}`).count().catch(() => 0))) {
    throw new Error('Toutiao editor is not authenticated in the Edge profile.');
  }
}

async function switchCoverDisplayToSingleImage(page) {
  await scrollNearText(page, TEXT.cover);
  if ((await getToutiaoState(page)).singleChecked) return;
  const clicked = await clickChoiceByText(page, {
    texts: [TEXT.single],
    selectors: ['.article-cover-radio-group label', '.byte-radio-wrapper', '.byte-radio', '[role="radio"]', 'label'],
  });
  if (!clicked) throw new Error('Toutiao single-image cover option not found before upload');
  await page.waitForTimeout(800);
  if (!(await getToutiaoState(page)).singleChecked) throw new Error('Toutiao single-image cover option was clicked but not selected');
}

async function enablePlatformFirstPublish(page) {
  await scrollNearText(page, TEXT.firstToutiao);
  if ((await getToutiaoState(page)).firstPublishChecked) return;
  const clicked = await clickChoiceByText(page, {
    texts: [TEXT.firstToutiao, TEXT.firstPlatform, TEXT.firstStatement],
    selectors: ['.exclusive-checkbox-wraper label', '.byte-checkbox-wrapper', '.byte-checkbox', '[role="checkbox"]', 'label'],
  });
  if (!clicked) {
    console.log('[edge-cover] platform first-publish option not found; skipped');
    return;
  }
  await page.waitForTimeout(800);
  if (!(await getToutiaoState(page)).firstPublishChecked) throw new Error('Toutiao platform-first-publish checkbox was clicked but not selected');
}

async function openCoverUpload(page) {
  await scrollNearText(page, TEXT.cover);
  for (const selector of ['.article-cover-add', '.article-cover-img-replace']) {
    const locator = page.locator(selector).first();
    if (await locator.count().catch(() => 0)) {
      await locator.click({ timeout: 15000 });
      return;
    }
  }
  const clicked = await clickChoiceByText(page, {
    texts: [TEXT.addCover, TEXT.uploadCover, TEXT.chooseCover, TEXT.replaceCover, TEXT.cover],
    selectors: ['button', '[role="button"]', 'label', 'div', 'span'],
  });
  if (!clicked) throw new Error('Toutiao cover add/replace entry not found');
}

async function uploadLocalCover(page, coverPath) {
  const uploadButton = page.getByRole('button', { name: new RegExp(`${TEXT.localUpload}|${TEXT.uploadImage}|Choose File`, 'i') }).first();
  if (await uploadButton.count().catch(() => 0)) {
    const fileInput = uploadButton.locator('input[type="file"]').first();
    if (await fileInput.count().catch(() => 0)) {
      await fileInput.setInputFiles(coverPath);
      return;
    }
  }

  const input = page.locator('input[type="file"]').first();
  if (await input.count().catch(() => 0)) {
    await input.setInputFiles(coverPath);
    return;
  }

  throw new Error('Toutiao local cover upload input not found');
}

async function selectUploadedCover(page) {
  await page.waitForFunction(() => document.querySelectorAll('[role="listitem"] img, .img-wrap img').length > 0, null, { timeout: 30000 }).catch(() => {});
  const listImage = page.getByRole('listitem').locator('img').first();
  if (await listImage.count().catch(() => 0)) await listImage.click({ timeout: 15000 });
  const imageWrap = page.locator('.img-wrap').first();
  if (await imageWrap.count().catch(() => 0)) await imageWrap.click({ timeout: 15000 });
  await page.getByRole('button', { name: new RegExp(`${TEXT.ok}|${TEXT.done}|${TEXT.use}`) }).click({ timeout: 15000 });
}

async function waitForCoverAndDraftSave(page) {
  await page.waitForFunction(() => document.querySelectorAll('.article-cover-img-wrap img[alt="cover"], .article-cover-img-wrap img').length > 0, null, { timeout: 30000 });
  await page.waitForFunction((savingText) => !document.body.innerText.includes(savingText), TEXT.savingDraft, { timeout: 90000 }).catch(() => {});
  await page.waitForTimeout(3000);
}

async function previewAndConfirmPublish(page) {
  await clickFirstVisibleByText(page, [TEXT.previewAndPublish], ['button', '[role="button"]', '.show-dialog-btn', 'span', 'div'], 30000);
  await page.waitForTimeout(1000);

  const confirmClicked = await clickFirstVisibleByText(page, [TEXT.confirmPublish], ['button', '[role="button"]'], 30000).catch(() => false);
  if (!confirmClicked) await page.keyboard.press('Enter').catch(() => {});

  await page.waitForFunction(
    ({ successTexts, savingText }) => successTexts.some((text) => document.body.innerText.includes(text)) || !document.body.innerText.includes(savingText),
    { successTexts: [TEXT.publishSuccess, TEXT.submitted, TEXT.auditing], savingText: TEXT.savingDraft },
    { timeout: 120000 },
  ).catch(() => {});
  await page.waitForTimeout(1000);
  return { submitted: confirmClicked };
}

async function scrollNearText(page, text) {
  await page.evaluate((targetText) => {
    const node = [...document.querySelectorAll('body *')].find((item) => (item.innerText || item.textContent || '').includes(targetText));
    node?.scrollIntoView({ block: 'center', inline: 'nearest' });
  }, text).catch(() => {});
  await page.waitForTimeout(300);
}

async function clickChoiceByText(page, { texts, selectors }) {
  return await clickFirstVisibleByText(page, texts, selectors, 15000).catch(() => false);
}

async function clickFirstVisibleByText(page, texts, selectors, timeout) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    for (const selector of selectors) {
      for (const text of texts) {
        const locator = page.locator(selector).filter({ hasText: text }).first();
        if (await locator.count().catch(() => 0)) {
          await locator.scrollIntoViewIfNeeded().catch(() => {});
          await locator.click({ timeout: 3000 }).catch(async () => locator.evaluate((node) => node.click()));
          return true;
        }
      }
    }
    await page.waitForTimeout(300);
  }
  throw new Error(`Clickable text not found: ${texts.join('/')}`);
}

async function getToutiaoState(page) {
  return await page.evaluate((text) => {
    const includesText = (node, value) => (node.innerText || node.textContent || '').includes(value);
    const isChecked = (node) => {
      const input = node.querySelector?.('input');
      return Boolean(
        node.className?.toString?.().includes('checked')
        || node.getAttribute?.('aria-checked') === 'true'
        || input?.checked
        || input?.getAttribute('checked') !== null
        || node.innerHTML?.includes('checked')
      );
    };
    const singleNode = [...document.querySelectorAll('.article-cover-radio-group label, .byte-radio-wrapper, .byte-radio, [role="radio"], label')]
      .find((node) => includesText(node, text.single));
    const firstPublishNode = [...document.querySelectorAll('.exclusive-checkbox-wraper label, .byte-checkbox-wrapper, .byte-checkbox, [role="checkbox"], label')]
      .find((node) => [text.firstToutiao, text.firstPlatform, text.firstStatement].some((value) => includesText(node, value)));
    const bodyText = document.body.innerText;

    return {
      url: location.href,
      singleChecked: Boolean(singleNode && isChecked(singleNode)),
      firstPublishChecked: Boolean(firstPublishNode && isChecked(firstPublishNode)),
      singleOptionFound: Boolean(singleNode),
      firstPublishOptionFound: Boolean(firstPublishNode),
      coverCount: document.querySelectorAll('.article-cover-img-wrap img[alt="cover"], .article-cover-img-wrap img').length,
      saving: bodyText.includes(text.savingDraft),
      saveFailed: bodyText.includes(text.saveFailed),
      publishSuccess: [text.publishSuccess, text.submitted, text.auditing].some((value) => bodyText.includes(value)),
    };
  }, TEXT);
}

function assertCoverState(state) {
  if (!state.singleChecked) throw new Error('Toutiao cover upload finished but single-image cover mode is not selected');
  if (state.firstPublishOptionFound && !state.firstPublishChecked) throw new Error('Toutiao cover upload finished but platform-first-publish is not checked');
  if (!state.coverCount) throw new Error('Toutiao cover upload finished but no cover image is visible');
  if (state.saveFailed) throw new Error('Toutiao draft save failed after cover upload');
}

function assertPublishState(state) {
  if (state.saveFailed) throw new Error('Toutiao publish failed: draft save failure is visible');
  if (!state.publishSubmitted && !state.publishSuccess) throw new Error('Toutiao publish confirmation did not reach a success/review state');
}

function getPublishStatus(state) {
  if (state.publishSuccess) return 'success-or-review';
  if (state.publishSubmitted && !state.saveFailed) return 'submitted';
  if (state.saveFailed) return 'failed';
  return 'unknown';
}

function formatToutiaoState(state) {
  return JSON.stringify({
    url: state.url,
    coverCount: state.coverCount,
    publishStatus: state.publishStatus || getPublishStatus(state),
    publishSubmitted: Boolean(state.publishSubmitted),
    publishSuccess: Boolean(state.publishSuccess),
    saveFailed: Boolean(state.saveFailed),
  });
}
