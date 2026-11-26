import { expect, test } from '../src/playwright/index';

test('a screenshot (WebKit adds a stylesheet to settle animations) sets off no CSP report', async ({
  editor,
  page,
}) => {
  const msgs: string[] = [];
  page.on('console', (m) => msgs.push(m.text()));
  await editor.execute('file.new', {});
  await page.screenshot();
  await page.keyboard.type('hello');
  await page.screenshot();
  await page.waitForTimeout(500);
  expect(msgs.filter((m) => /content.security.policy/i.test(m))).toEqual([]);
});
