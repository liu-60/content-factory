import { resolve } from 'node:path';
import { chromium } from 'playwright';

const draftUrl = process.env.LTOOL_TOUTIAO_DRAFT_URL;
const coverPath = process.env.LTOOL_COVER_PATH ? resolve(process.env.LTOOL_COVER_PATH) : '';
const userDataDir = resolve(process.env.LTOOL_CODEGEN_USER_DATA_DIR || '.playwright/ltool-codegen-profile');

if (!draftUrl) throw new Error('Missing LTOOL_TOUTIAO_DRAFT_URL');
if (!coverPath) throw new Error('Missing LTOOL_COVER_PATH');

const context = await chromium.launchPersistentContext(userDataDir, {
  channel: 'chrome',
  headless: false,
});
const page = await context.newPage();

try {
  await page.goto(draftUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForLoadState('networkidle', { timeout: 20000 }).catch(() => {});
  await closeBlockingDrawers(page);
  await ensureSingleImageCover(page);
  await ensureToutiaoFirstPublish(page);
  await openCoverUpload(page);
  await page.getByRole('button', { name: /本地上传|Choose File/i }).locator('input[type="file"]').setInputFiles(coverPath);
  await page.waitForFunction(() => document.querySelectorAll('[role="listitem"] img').length > 0, null, { timeout: 30000 }).catch(() => {});
  await page.getByRole('listitem').locator('img').first().click({ timeout: 15000 });
  await page.locator('.img-wrap').first().click({ timeout: 15000 });
  await page.getByRole('button', { name: '确定' }).click({ timeout: 15000 });
  await waitForCoverAndDraftSave(page);
  const state = await getToutiaoState(page);
  console.log(`Toutiao cover upload flow completed: ${draftUrl}`);
  console.log(JSON.stringify(state));
} finally {
  await context.close();
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

async function ensureSingleImageCover(page) {
  const isSingle = await page.locator('.article-cover-radio-group label')
    .filter({ hasText: '单图' })
    .first()
    .evaluate((node) => node.innerHTML.includes('checked'))
    .catch(() => false);
  if (!isSingle) {
    await page.locator('.article-cover-radio-group label').filter({ hasText: '单图' }).first().click({ timeout: 15000 });
    await page.waitForTimeout(800);
  }
}

async function ensureToutiaoFirstPublish(page) {
  const firstPublish = page.locator('.exclusive-checkbox-wraper label').filter({ hasText: '头条首发' }).first();
  if (!(await firstPublish.count().catch(() => 0))) return;
  const checked = await firstPublish.evaluate((node) => node.classList.contains('byte-checkbox-checked')).catch(() => false);
  if (!checked) {
    await firstPublish.click({ timeout: 15000 });
    await page.waitForTimeout(800);
  }
}

async function openCoverUpload(page) {
  const addCover = page.locator('.article-cover-add').first();
  if (await addCover.count().catch(() => 0)) {
    await addCover.click({ timeout: 15000 });
    return;
  }
  const replaceCover = page.locator('.article-cover-img-replace').first();
  if (await replaceCover.count().catch(() => 0)) {
    await replaceCover.click({ timeout: 15000 });
    return;
  }
  throw new Error('Toutiao cover add/replace entry not found');
}

async function waitForCoverAndDraftSave(page) {
  await page.waitForFunction(() => document.querySelectorAll('.article-cover-img-wrap img[alt="cover"]').length > 0, null, { timeout: 30000 });
  await page.waitForFunction(() => !document.body.innerText.includes('草稿保存中'), null, { timeout: 90000 }).catch(() => {});
  await page.waitForTimeout(3000);
}

async function getToutiaoState(page) {
  return await page.evaluate(() => ({
    singleChecked: Boolean(document.querySelector('.article-cover-radio-group label input[value="2"]')?.parentElement?.innerHTML.includes('checked')),
    firstPublishChecked: Boolean(document.querySelector('.exclusive-checkbox-wraper label')?.classList.contains('byte-checkbox-checked')),
    coverCount: document.querySelectorAll('.article-cover-img-wrap img[alt="cover"]').length,
    saving: document.body.innerText.includes('草稿保存中'),
    saveFailed: document.body.innerText.includes('保存失败'),
  }));
}
