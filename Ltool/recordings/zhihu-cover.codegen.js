const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({
    channel: 'chrome',
    headless: false
  });
  const context = await browser.newContext();
  await page.goto('https://zhuanlan.zhihu.com/p/2053552220537360998/edit');
  await page.locator('.Zi.Zi--Plus').first().click();
  await page.getByLabel('添加文章封面').setInputFiles('ef4d5bb0-fe98-4cd5-9aac-9e6b3c740ce9.png');
  await page.getByRole('button', { name: '发布' }).click();

  // ---------------------
  await context.close();
  await browser.close();
})();