import { existsSync } from 'node:fs';
import { basename } from 'node:path';
import { chromium } from 'playwright-core';

const DEFAULT_CDP_URL = 'http://127.0.0.1:9222';
const COVER_LABELS = [
  '封面',
  '上传封面',
  '修改封面',
  '选择封面',
  '添加封面',
  '本地上传',
  '上传图片',
  '从本地上传',
];
const CONFIRM_LABELS = ['确定', '确认', '完成', '保存', '应用'];

export function buildCoverTasks(results, docs) {
  const docsByTitle = new Map(docs.map((doc) => [doc.article.title, doc]));
  return results
    .filter((item) => item?.success && item.postUrl)
    .map((item) => {
      const doc = docsByTitle.get(item.title);
      return {
        platform: item.platform,
        title: item.title,
        postUrl: item.postUrl,
        coverPath: doc?.coverPath || item.coverPath || '',
      };
    })
    .filter((item) => item.coverPath && existsSync(item.coverPath));
}

export async function uploadDraftCovers({ results, docs, cdpUrl, headless = false } = {}) {
  const tasks = buildCoverTasks(results, docs);
  if (!tasks.length) return [];

  let browser;
  let context;
  let closeBrowser = false;
  try {
    ({ browser, context, closeBrowser } = await openBrowserContext({ cdpUrl, headless }));
  } catch (error) {
    return tasks.map((task) => ({
      ...task,
      success: false,
      error: error.message,
    }));
  }

  const output = [];
  try {
    for (const task of tasks) {
      const page = await context.newPage();
      try {
        const result = await uploadOneCover(page, task);
        output.push({ ...task, ...result });
      } catch (error) {
        output.push({ ...task, success: false, error: error.message });
      } finally {
        await page.close().catch(() => {});
      }
    }
  } finally {
    if (closeBrowser) await browser.close().catch(() => {});
  }
  return output;
}

async function openBrowserContext({ cdpUrl, headless }) {
  const endpoint = cdpUrl || process.env.LTOOL_CDP_URL || DEFAULT_CDP_URL;
  try {
    const browser = await chromium.connectOverCDP(endpoint, { timeout: 5000 });
    const context = browser.contexts()[0] || await browser.newContext();
    return { browser, context, closeBrowser: false };
  } catch (cdpError) {
    const userDataDir = process.env.LTOOL_CHROME_USER_DATA_DIR;
    if (!userDataDir) {
      throw new Error(`Playwright cannot connect to Chrome CDP at ${endpoint}. Start Chrome with --remote-debugging-port=9222 or set LTOOL_CDP_URL. ${cdpError.message}`);
    }
    const context = await chromium.launchPersistentContext(userDataDir, {
      channel: 'chrome',
      headless,
      args: ['--disable-blink-features=AutomationControlled'],
    });
    return { browser: context.browser(), context, closeBrowser: true };
  }
}

async function uploadOneCover(page, task) {
  await page.goto(task.postUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForLoadState('networkidle', { timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(1500);

  if (task.platform === 'toutiao' && await uploadToutiaoCoverFromRecording(page, task.coverPath)) {
    return { success: true, message: `uploaded ${basename(task.coverPath)} via recorded toutiao flow` };
  }

  const uploaded = await tryDirectFileInput(page, task.coverPath);
  if (!uploaded) {
    await clickByLabels(page, COVER_LABELS).catch(() => {});
    await page.waitForTimeout(1000);
    const viaChooser = await tryFileChooser(page, task.coverPath);
    if (!viaChooser) {
      const afterClick = await tryDirectFileInput(page, task.coverPath);
      if (!afterClick) throw new Error(`Cover upload input not found for ${task.platform}`);
    }
  }

  await page.waitForTimeout(1200);
  await clickByLabels(page, CONFIRM_LABELS).catch(() => {});
  await page.waitForTimeout(1500);
  return { success: true, message: `uploaded ${basename(task.coverPath)}` };
}

async function uploadToutiaoCoverFromRecording(page, coverPath) {
  try {
    await closeBlockingDrawers(page);
    await ensureSingleImageCover(page);
    await ensureToutiaoFirstPublish(page);
    if (!await openToutiaoCoverUpload(page)) return false;
    await page.getByRole('button', { name: /本地上传|Choose File/i }).locator('input[type="file"]').setInputFiles(coverPath);
    await page.waitForFunction(() => document.querySelectorAll('[role="listitem"] img').length > 0, null, { timeout: 30000 }).catch(() => {});
    await page.getByRole('listitem').locator('img').first().click({ timeout: 15000 });
    await page.locator('.img-wrap').first().click({ timeout: 15000 });
    await page.getByRole('button', { name: '确定' }).click({ timeout: 15000 });
    await page.waitForFunction(() => document.querySelectorAll('.article-cover-img-wrap img[alt="cover"]').length > 0, null, { timeout: 30000 });
    await page.waitForFunction(() => !document.body.innerText.includes('草稿保存中'), null, { timeout: 90000 }).catch(() => {});
    await page.waitForTimeout(3000);
    return true;
  } catch {
    return false;
  }
}

async function openToutiaoCoverUpload(page) {
  const addCover = page.locator('.article-cover-add').first();
  if (await addCover.count().catch(() => 0)) {
    await addCover.click({ timeout: 10000 });
    return true;
  }
  const replaceCover = page.locator('.article-cover-img-replace').first();
  if (await replaceCover.count().catch(() => 0)) {
    await replaceCover.click({ timeout: 10000 });
    return true;
  }
  return false;
}

async function ensureSingleImageCover(page) {
  const single = page.locator('.article-cover-radio-group label').filter({ hasText: '单图' }).first();
  if (!(await single.count().catch(() => 0))) return;
  const isSingle = await single.evaluate((node) => node.innerHTML.includes('checked')).catch(() => false);
  if (!isSingle) {
    await single.click({ timeout: 10000 });
    await page.waitForTimeout(800);
  }
}

async function ensureToutiaoFirstPublish(page) {
  const firstPublish = page.locator('.exclusive-checkbox-wraper label').filter({ hasText: '头条首发' }).first();
  if (!(await firstPublish.count().catch(() => 0))) return;
  const checked = await firstPublish.evaluate((node) => node.classList.contains('byte-checkbox-checked')).catch(() => false);
  if (!checked) {
    await firstPublish.click({ timeout: 10000 });
    await page.waitForTimeout(800);
  }
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

async function tryDirectFileInput(page, coverPath) {
  const inputs = await page.locator('input[type="file"]').elementHandles();
  for (const input of inputs) {
    const accept = await input.getAttribute('accept').catch(() => '') || '';
    const name = await input.getAttribute('name').catch(() => '') || '';
    const className = await input.getAttribute('class').catch(() => '') || '';
    const text = `${accept} ${name} ${className}`.toLowerCase();
    if (!text || /image|jpg|jpeg|png|webp|cover|pic|upload/.test(text)) {
      await input.setInputFiles(coverPath);
      return true;
    }
  }
  return false;
}

async function tryFileChooser(page, coverPath) {
  for (const label of COVER_LABELS) {
    const target = page.getByText(label, { exact: false }).first();
    if (!(await target.count().catch(() => 0))) continue;
    try {
      const chooserPromise = page.waitForEvent('filechooser', { timeout: 2500 });
      await target.click({ timeout: 2500 });
      const chooser = await chooserPromise;
      await chooser.setFiles(coverPath);
      return true;
    } catch {}
  }
  return false;
}

async function clickByLabels(page, labels) {
  for (const label of labels) {
    const locator = page.getByText(label, { exact: false }).first();
    if (await locator.count().catch(() => 0)) {
      await locator.click({ timeout: 3000 }).catch(() => {});
      return true;
    }
  }
  return false;
}
