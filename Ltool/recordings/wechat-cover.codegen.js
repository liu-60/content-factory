const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({
    channel: 'msedge',
    headless: false
  });
  const context = await browser.newContext();
  await page.goto('https://mp.weixin.qq.com/cgi-bin/appmsg?t=media/appmsg_edit&action=edit&type=77&appmsgid=100000794&token=1511386336&lang=zh_CN');
  await page.getByRole('link', { name: '登录' }).click();
  await page.getByText('内容管理').click();
  await page.getByRole('link', { name: '草稿箱' }).click();
  const page1Promise = page.waitForEvent('popup');
  await page.getByRole('link').filter({ hasText: /^$/ }).nth(2).click();
  const page1 = await page1Promise;
  await page1.getByRole('textbox', { name: '请输入作者' }).click();
  await page1.getByText('六零').click();
  await page1.getByText('未声明').click();
  await page1.getByRole('button', { name: '确定' }).click();
  await page1.locator('#js_article_tags_area').getByText('未添加').click();
  await page1.getByRole('textbox', { name: '请选择合集' }).click();
  await page1.getByText('AI', { exact: true }).click();
  await page1.getByRole('button', { name: '确认' }).click();
  await page1.getByRole('button', { name: '发表' }).click();
  await page1.locator('.weui-desktop-switch__box').first().click();
  await page1.locator('#vue_app').getByRole('button', { name: '发表' }).click();
  await page1.getByRole('button', { name: '继续发表' }).click();
  await page1.goto('https://mp.weixin.qq.com/cgi-bin/home?t=home/index&token=252416412&lang=zh_CN');

  // ---------------------
  await context.close();
  await browser.close();
})();