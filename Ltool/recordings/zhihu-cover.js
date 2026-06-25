import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright';
import { EDGE_PROFILE_DIR, restoreEdgeStorageState, saveEdgeStorageState } from '../src/edge-ltool.js';

const TEXT = {
  addCover: '添加文章封面',
  replaceCover: '更换文章封面',
  publish: '发布',
  confirmPublish: '确认并发布',
  publishSuccess: '发布成功',
  submitted: '提交成功',
  auditing: '审核中',
  savingDraft: '保存中',
  login: '登录',
};

const draftUrl = process.env.LTOOL_ZHIHU_DRAFT_URL;
const coverPath = process.env.LTOOL_COVER_PATH ? resolve(process.env.LTOOL_COVER_PATH) : '';
const userDataDir = resolve(process.env.LTOOL_EDGE_USER_DATA_DIR || EDGE_PROFILE_DIR);

export async function runZhihuCoverFlow({
  draftUrl,
  coverPath,
  context,
  userDataDir = EDGE_PROFILE_DIR,
  publish = true,
} = {}) {
  if (!draftUrl) throw new Error('Missing draftUrl');
  if (!coverPath) throw new Error('Missing coverPath');
  if (!existsSync(coverPath)) throw new Error(`Cover image not found: ${coverPath}`);

  const ownsContext = !context;
  const browserContext = context || await chromium.launchPersistentContext(resolve(userDataDir), {
    channel: 'msedge',
    headless: false,
    args: ['--disable-blink-features=AutomationControlled'],
  });
  if (ownsContext) await restoreEdgeStorageState(browserContext);

  const page = await openDraftPage(browserContext, draftUrl);
  try {
    console.log('[zhihu-cover] draft page opened');
    await assertZhihuEditorPage(page);
    console.log('[zhihu-cover] editor authenticated');
    await waitForEditorReady(page);
    console.log('[zhihu-cover] editor ready');

    if (coverPath) {
      await uploadCover(page, coverPath);
      console.log('[zhihu-cover] cover uploaded');
      await waitForCoverVisible(page);
      console.log('[zhihu-cover] cover visible');
    }

    let state = await getZhihuState(page);

    if (publish) {
      console.log('[zhihu-cover] publishing...');
      const publishResult = await publishArticle(page);
      console.log('[zhihu-cover] publish actions completed');
      state = await getZhihuState(page);
      state.publishSubmitted = publishResult.submitted;
      state.publishStatus = getPublishStatus(state);
      console.log(`[zhihu-cover] publish state: ${state.publishStatus}`);
    }

    console.log(`Zhihu cover${publish ? ' and publish' : ''} flow completed: ${state.url || draftUrl}`);
    console.log(formatZhihuState(state));
    return state;
  } finally {
    if (ownsContext) await saveEdgeStorageState(browserContext).catch(() => {});
    if (ownsContext) await browserContext.close();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await runZhihuCoverFlow({ draftUrl, coverPath, userDataDir, publish: process.env.LTOOL_ZHIHU_PUBLISH !== 'false' });
}

async function openDraftPage(context, draftUrl) {
  const pages = context.pages();
  const page = pages[0] || await context.newPage();
  for (const extra of pages.slice(1)) await extra.close().catch(() => {});
  await page.goto('about:blank').catch(() => {});
  await page.goto(draftUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});
  return page;
}

async function assertZhihuEditorPage(page) {
  const url = page.url();
  if (/signin|login/i.test(url)) {
    throw new Error('Zhihu editor redirected to login page. Browser login state is missing or expired.');
  }
  const editorReady = await page.locator('.WriteIndex-layout, .PostEditor, .WriteIndex-editor, [class*="editor"], .Zi.Zi--Plus').first().count().catch(() => 0);
  if (!editorReady) {
    const loginVisible = await page.locator(`text=${TEXT.login}`).first().count().catch(() => 0);
    if (loginVisible) throw new Error('Zhihu editor is not authenticated.');
  }
}

async function waitForEditorReady(page) {
  await page.waitForFunction(() => {
    return document.querySelector('.WriteIndex-layout')
      || document.querySelector('.PostEditor')
      || document.querySelector('[class*="WriteIndex"]')
      || document.querySelector('.Zi.Zi--Plus');
  }, null, { timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(2000);
}

async function uploadCover(page, coverPath) {
  // Click the "+" button to expand toolbar if needed
  const plusButton = page.locator('.Zi.Zi--Plus').first();
  if (await plusButton.count().catch(() => 0)) {
    await plusButton.click({ timeout: 10000 });
    await page.waitForTimeout(1000);
  }

  // Find the file input for cover upload
  // Method 1: getByLabel with '添加文章封面'
  const labelInput = page.getByLabel(TEXT.addCover);
  if (await labelInput.count().catch(() => 0)) {
    await labelInput.setInputFiles(coverPath);
    await page.waitForTimeout(2000);
    return;
  }

  // Method 2: find file input near cover-related text
  const coverInput = page.locator('input[type="file"]').first();
  if (await coverInput.count().catch(() => 0)) {
    await coverInput.setInputFiles(coverPath);
    await page.waitForTimeout(2000);
    return;
  }

  // Method 3: click text-based button then look for file input
  for (const text of [TEXT.addCover, TEXT.replaceCover]) {
    const button = page.locator('button, [role="button"], label, span, div').filter({ hasText: text }).first();
    if (await button.count().catch(() => 0)) {
      await button.click({ timeout: 10000 });
      await page.waitForTimeout(1000);
      const fileInput = page.locator('input[type="file"]').first();
      if (await fileInput.count().catch(() => 0)) {
        await fileInput.setInputFiles(coverPath);
        await page.waitForTimeout(2000);
        return;
      }
    }
  }

  throw new Error('Zhihu cover upload input not found');
}

async function waitForCoverVisible(page) {
  // Wait for cover image to appear in the editor
  await page.waitForFunction(() => {
    const coverImg = document.querySelector('[class*="cover"] img, [class*="Cover"] img, .PostEditor-cover img, .WriteIndex-cover img');
    return Boolean(coverImg);
  }, null, { timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(2000);
}

async function publishArticle(page) {
  // Click the publish button
  const publishButton = page.getByRole('button', { name: new RegExp(TEXT.publish) }).first();
  if (!await publishButton.count().catch(() => 0)) {
    // Fallback: find button with publish text
    const fallback = page.locator('button, [role="button"]').filter({ hasText: TEXT.publish }).first();
    if (await fallback.count().catch(() => 0)) {
      await fallback.click({ timeout: 15000 });
    } else {
      throw new Error('Zhihu publish button not found');
    }
  } else {
    await publishButton.click({ timeout: 15000 });
  }

  await page.waitForTimeout(2000);

  // Handle possible confirmation dialog
  const confirmClicked = await clickConfirmDialog(page);

  // Wait for publish success indicators
  await page.waitForFunction(
    (texts) => texts.some((text) => document.body.innerText.includes(text)),
    [TEXT.publishSuccess, TEXT.submitted, TEXT.auditing],
    { timeout: 60000 },
  ).catch(() => {});
  await page.waitForTimeout(1000);

  return { submitted: confirmClicked };
}

async function clickConfirmDialog(page) {
  // Zhihu may show a confirmation dialog before publishing
  for (const selector of ['button', '[role="button"]']) {
    const confirm = page.locator(selector).filter({ hasText: new RegExp(`${TEXT.confirmPublish}|${TEXT.publish}`) }).first();
    if (await confirm.count().catch(() => 0)) {
      const isVisible = await confirm.isVisible().catch(() => false);
      if (isVisible) {
        await confirm.click({ timeout: 10000 }).catch(() => {});
        return true;
      }
    }
  }
  // Try pressing Enter as fallback
  await page.keyboard.press('Enter').catch(() => {});
  return false;
}

async function getZhihuState(page) {
  return await page.evaluate((text) => {
    const bodyText = document.body.innerText;
    const coverImg = document.querySelector('[class*="cover"] img, [class*="Cover"] img, .PostEditor-cover img, .WriteIndex-cover img');
    return {
      url: location.href,
      coverCount: coverImg ? 1 : 0,
      saving: bodyText.includes(text.savingDraft),
      publishSuccess: [text.publishSuccess, text.submitted, text.auditing].some((t) => bodyText.includes(t)),
    };
  }, TEXT);
}

function getPublishStatus(state) {
  if (state.publishSuccess) return 'success-or-review';
  if (state.publishSubmitted && !state.saving) return 'submitted';
  if (state.saving) return 'saving';
  return 'unknown';
}

function formatZhihuState(state) {
  return JSON.stringify({
    url: state.url,
    coverCount: state.coverCount,
    publishStatus: state.publishStatus || getPublishStatus(state),
    publishSubmitted: Boolean(state.publishSubmitted),
    publishSuccess: Boolean(state.publishSuccess),
  });
}
