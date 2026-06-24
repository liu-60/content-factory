import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright';
import { EDGE_PROFILE_DIR, restoreEdgeStorageState, saveEdgeStorageState } from '../src/edge-ltool.js';

const TEXT = {
  login: '登录',
  single: '单图',
  chooseCover: '选择封面',
  editCover: '编辑',
  replaceCover: '更换',
  localUpload: '本地上传',
  confirmSelected: /^确定\s*\(\s*1\s*\)$/,
  saveDraft: /存草稿|保存草稿/,
  saving: /保存中|草稿保存中/,
  saved: /保存成功|草稿已保存|草稿保存成功/,
  saveFailed: /保存失败/,
  schedulePublish: '定时发布',
  scheduleSuccess: /提交成功|审核中|发布状态/,
};

const draftUrl = process.env.LTOOL_BAIJIAHAO_DRAFT_URL;
const coverPath = process.env.LTOOL_COVER_PATH ? resolve(process.env.LTOOL_COVER_PATH) : '';
const userDataDir = resolve(process.env.LTOOL_EDGE_USER_DATA_DIR || EDGE_PROFILE_DIR);
const schedulePublish = process.env.LTOOL_BAIJIAHAO_SCHEDULE_PUBLISH === 'true';

export async function runBaijiahaoCoverFlow({
  draftUrl,
  coverPath,
  context,
  userDataDir = EDGE_PROFILE_DIR,
  schedulePublish = false,
} = {}) {
  if (!draftUrl) throw new Error('Missing LTOOL_BAIJIAHAO_DRAFT_URL');
  if (!coverPath) throw new Error('Missing LTOOL_COVER_PATH');
  if (!existsSync(coverPath)) throw new Error(`Cover image not found: ${coverPath}`);

  const ownsContext = !context;
  const browserContext = context || await chromium.launchPersistentContext(resolve(userDataDir), {
    channel: 'msedge',
    headless: false,
    args: ['--disable-blink-features=AutomationControlled'],
  });
  if (ownsContext) await restoreEdgeStorageState(browserContext);

  const page = await openSingleDraftPage(browserContext, toEditUrl(draftUrl));
  try {
    console.log('[edge-baijiahao] editor page opened');
    await assertBaijiahaoPage(page);
    await closeBlockingDialogs(page);
    await selectSingleCoverMode(page);
    console.log('[edge-baijiahao] single-image cover mode selected');
    await openCoverChooser(page);
    console.log('[edge-baijiahao] cover chooser opened');
    await uploadLocalCover(page, coverPath);
    console.log('[edge-baijiahao] local cover uploaded');
    await selectUploadedCover(page);
    console.log('[edge-baijiahao] uploaded cover selected');
    await saveDraft(page);
    console.log('[edge-baijiahao] draft save clicked');

    let state = await getBaijiahaoDraftState(page);
    assertDraftState(state);
    if (schedulePublish) {
      state = await scheduleDraftPublish(page);
      console.log('[edge-baijiahao] scheduled publish submitted');
    }
    console.log(`Edge Baijiahao draft is ready: ${state.url}`);
    console.log(JSON.stringify(state));
    return state;
  } finally {
    if (ownsContext) await saveEdgeStorageState(browserContext).catch(() => {});
    if (ownsContext) await browserContext.close();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await runBaijiahaoCoverFlow({ draftUrl, coverPath, userDataDir, schedulePublish });
}

function toEditUrl(value) {
  const url = new URL(value);
  const articleId = url.searchParams.get('article_id') || url.searchParams.get('id');
  if (!articleId) return value;
  return `https://baijiahao.baidu.com/builder/rc/edit?type=news&article_id=${articleId}&is_pay_training_camp=`;
}

async function openSingleDraftPage(context, targetUrl) {
  const pages = context.pages();
  const page = pages[0] || await context.newPage();
  for (const extra of pages.slice(1)) await extra.close().catch(() => {});
  await page.goto('about:blank').catch(() => {});
  await clearBaijiahaoLocalDraftCache(page);
  await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForLoadState('networkidle', { timeout: 20000 }).catch(() => {});
  return page;
}

async function clearBaijiahaoLocalDraftCache(page) {
  await page.goto('https://baijiahao.baidu.com/', { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
  await page.evaluate(() => {
    for (const key of Object.keys(localStorage)) {
      // Baijiahao may restore an empty local editor draft over the server draft.
      // Keep auth tokens, but remove editor-local draft/cache switches.
      if (/^edit-.*-news$/.test(key) || /localReload$/.test(key)) {
        localStorage.removeItem(key);
      }
      if (/^BJH_EXPIRATION_.*localReload$/.test(key)) {
        localStorage.removeItem(key);
      }
    }
  }).catch(() => {});
}

async function assertBaijiahaoPage(page) {
  if (/login|passport/.test(page.url())) {
    throw new Error('Baijiahao page redirected to login. Edge login state is missing or expired.');
  }
  await page.waitForFunction(
    ({ chooseCover, replaceCover, editCover, saveDraftSource }) => {
      const text = document.body.innerText;
      return text.includes(chooseCover)
        || text.includes(replaceCover)
        || text.includes(editCover)
        || new RegExp(saveDraftSource).test(text);
    },
    {
      chooseCover: TEXT.chooseCover,
      replaceCover: TEXT.replaceCover,
      editCover: TEXT.editCover,
      saveDraftSource: TEXT.saveDraft.source,
    },
    { timeout: 30000 },
  ).catch(() => {});
  const loginVisible = await page.getByText(TEXT.login, { exact: true }).first().isVisible({ timeout: 1000 }).catch(() => false);
  const saveVisible = await page.getByRole('button', { name: TEXT.saveDraft }).first().isVisible({ timeout: 3000 }).catch(() => false);
  const coverVisible = await isAnyVisible(page, [
    page.getByText(TEXT.chooseCover, { exact: true }).first(),
    page.getByText(TEXT.replaceCover, { exact: true }).first(),
    page.getByText(TEXT.editCover, { exact: true }).first(),
  ]);
  if (loginVisible && !saveVisible) throw new Error('Baijiahao page is not authenticated in the Edge profile.');
  if (!saveVisible && !coverVisible) throw new Error('Baijiahao draft controls were not found.');
}

async function isAnyVisible(page, locators) {
  for (const locator of locators) {
    if (await locator.isVisible({ timeout: 500 }).catch(() => false)) return true;
  }
  return false;
}

async function closeBlockingDialogs(page) {
  await page.keyboard.press('Escape').catch(() => {});
  await page.waitForTimeout(500);
  await page.evaluate(() => {
    for (const selector of ['.ant-modal-mask', '.ant-drawer-mask', '[class*="modal-mask"]']) {
      for (const node of document.querySelectorAll(selector)) {
        node.style.pointerEvents = 'none';
        node.style.display = 'none';
      }
    }
  }).catch(() => {});
}

async function selectSingleCoverMode(page) {
  const radio = page.getByRole('radio', { name: TEXT.single }).first();
  if (await radio.count().catch(() => 0)) {
    await radio.scrollIntoViewIfNeeded().catch(() => {});
    await radio.check({ timeout: 15000 }).catch(async () => radio.click({ timeout: 15000 }));
    return;
  }
  await clickFirstVisibleByText(page, [TEXT.single], ['label', '[role="radio"]', 'span', 'div'], 15000);
}

async function openCoverChooser(page) {
  const replace = page.getByText(TEXT.replaceCover, { exact: true }).last();
  if (await replace.count().catch(() => 0)) {
    await replace.scrollIntoViewIfNeeded().catch(() => {});
    await replace.click({ timeout: 15000 }).catch(async () => replace.evaluate((node) => node.click()));
    return;
  }
  const exact = page.getByText(TEXT.chooseCover, { exact: true }).last();
  if (await exact.count().catch(() => 0)) {
    await exact.scrollIntoViewIfNeeded().catch(() => {});
    await exact.click({ timeout: 15000 }).catch(async () => exact.evaluate((node) => node.click()));
    return;
  }
  await clickFirstVisibleByText(page, [TEXT.chooseCover, TEXT.replaceCover, TEXT.editCover], ['button', '[role="button"]', 'span', 'div'], 15000);
}

async function uploadLocalCover(page, coverPath) {
  await page.getByText(TEXT.localUpload, { exact: true }).click({ timeout: 15000 });
  const mediaInput = page.locator('input[name="media"]').last();
  if (await mediaInput.count().catch(() => 0)) {
    await mediaInput.setInputFiles(coverPath);
    return;
  }
  const fileInput = page.locator('input[type="file"]').last();
  if (await fileInput.count().catch(() => 0)) {
    await fileInput.setInputFiles(coverPath);
    return;
  }
  throw new Error('Baijiahao local upload input was not found.');
}

async function selectUploadedCover(page) {
  await page.waitForFunction(() => document.querySelectorAll('[class*="imgWrapper"], img[src*="bcebos"], img[src^="blob:"]').length > 0, null, { timeout: 60000 });
  const wrapper = page.locator('[class*="imgWrapper"]').first();
  if (await wrapper.count().catch(() => 0)) {
    await wrapper.click({ timeout: 15000 });
    await wrapper.click({ timeout: 15000 }).catch(() => {});
  } else {
    await page.locator('img[src*="bcebos"], img[src^="blob:"]').first().click({ timeout: 15000 });
  }
  await page.getByRole('button', { name: TEXT.confirmSelected }).click({ timeout: 30000 });
  // The modal can close before the cover is committed to the form; wait for
  // the cover slot's edit/replace state before saving or scheduling.
  await page.waitForFunction(
    ({ editCover, replaceCover }) => {
      const text = document.body.innerText;
      return text.includes(editCover)
        && text.includes(replaceCover)
        && document.querySelectorAll('img[class*="coverImg"], [class*="coverWrapper"] img').length > 0;
    },
    { editCover: TEXT.editCover, replaceCover: TEXT.replaceCover },
    { timeout: 30000 },
  );
}

async function saveDraft(page) {
  await page.getByRole('button', { name: TEXT.saveDraft }).click({ timeout: 30000 });
  await page.waitForFunction(
    ({ savingSource, savedSource, failedSource }) => {
      const text = document.body.innerText;
      return new RegExp(savedSource).test(text)
        || new RegExp(failedSource).test(text)
        || !new RegExp(savingSource).test(text);
    },
    {
      savingSource: TEXT.saving.source,
      savedSource: TEXT.saved.source,
      failedSource: TEXT.saveFailed.source,
    },
    { timeout: 90000 },
  ).catch(() => {});
  await page.waitForTimeout(2000);
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

async function getBaijiahaoDraftState(page) {
  return await page.evaluate((text) => {
    const bodyText = document.body.innerText;
    const visibleImages = [...document.querySelectorAll('img')].filter((img) => {
      const src = img.getAttribute('src') || '';
      const box = img.getBoundingClientRect();
      return box.width > 20 && box.height > 20 && /bcebos|baijiahao|blob:|data:image/.test(src);
    });
    const singleRadio = [...document.querySelectorAll('[role="radio"], label, input[type="radio"]')]
      .find((node) => (node.innerText || node.textContent || node.getAttribute?.('aria-label') || '').includes(text.single));
    return {
      url: location.href,
      singleSelected: Boolean(singleRadio?.getAttribute?.('aria-checked') === 'true' || singleRadio?.querySelector?.('input')?.checked || singleRadio?.checked),
      coverCount: visibleImages.length,
      coverImageCount: document.querySelectorAll('img[class*="coverImg"], [class*="coverWrapper"] img').length,
      saveFailed: new RegExp(text.saveFailedSource).test(bodyText),
      saved: new RegExp(text.savedSource).test(bodyText),
      bodyHasSaveDraft: new RegExp(text.saveDraftSource).test(bodyText),
    };
  }, {
    single: TEXT.single,
    saveFailedSource: TEXT.saveFailed.source,
    savedSource: TEXT.saved.source,
    saveDraftSource: TEXT.saveDraft.source,
  });
}

async function scheduleDraftPublish(page) {
  // Baijiahao chooses the first valid schedule time, normally about one hour
  // from now. The caller opts in with --schedule-publish.
  await page.getByRole('button', { name: TEXT.schedulePublish }).first().click({ timeout: 30000 });
  const dialog = page.locator('.cheetah-modal, [role="dialog"]').last();
  await dialog.waitFor({ state: 'visible', timeout: 15000 });
  const modalText = await dialog.innerText({ timeout: 5000 }).catch(() => '');
  await dialog.getByRole('button', { name: TEXT.schedulePublish }).click({ timeout: 30000 });
  await page.waitForFunction(
    (successSource) => new RegExp(successSource).test(document.body.innerText),
    TEXT.scheduleSuccess.source,
    { timeout: 120000 },
  );
  return {
    ...(await getBaijiahaoDraftState(page).catch(() => ({ url: page.url() }))),
    url: page.url(),
    scheduled: true,
    scheduleModalText: modalText,
    scheduleSuccess: true,
  };
}

function assertDraftState(state) {
  if (state.saveFailed) throw new Error('Baijiahao draft save failed after cover upload.');
  if (!state.coverCount && !state.coverImageCount) throw new Error('Baijiahao draft has no visible cover image after save.');
  if (!state.bodyHasSaveDraft && !state.saved) throw new Error('Baijiahao draft controls disappeared before draft readiness could be verified.');
}
