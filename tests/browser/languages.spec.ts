import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { dictionary, SUPPORTED_LANGUAGES } from '../../src/i18n';

test.use({ locale: 'en-US' });
const pageErrors = new WeakMap<Page, string[]>();
test.beforeEach(({ page }) => {
  const errors: string[] = [];
  pageErrors.set(page, errors);
  page.on('pageerror', error => errors.push(error.message));
});
test.afterEach(({ page }) => { expect(pageErrors.get(page) ?? []).toEqual([]); });

async function noHorizontalOverflow(page: Page) {
  const layout = await page.evaluate(() => ({ viewport: window.innerWidth, document: document.documentElement.scrollWidth }));
  expect(layout.document).toBeLessThanOrEqual(layout.viewport);
}

async function idle(page: Page) {
  await expect(page.locator('.messages-list')).toHaveAttribute('aria-busy', 'false');
}

for (const language of SUPPORTED_LANGUAGES) {
  test(`${language.name}: localized demo, cleanup, help, mobile layout, and saved preference`, async ({ page }) => {
    const t = dictionary(language.code);
    if (language.code !== 'en') {
      expect(t.demo).not.toBe(dictionary('en').demo);
      expect(t.help).not.toBe(dictionary('en').help);
      expect(t.stripImages).not.toBe(dictionary('en').stripImages);
    }
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/');
    const selector = page.getByRole('combobox', { name: 'Language / 语言', exact: true });
    await expect(selector.locator('option')).toHaveText(['English', '简体中文', '日本語', 'Français', 'Español']);
    await selector.selectOption(language.code);
    await expect(selector).toHaveValue(language.code);
    await expect(page.locator('html')).toHaveAttribute('lang', language.htmlLang);
    await expect(page.getByRole('button', { name: t.demo, exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: t.help, exact: true })).toBeVisible();
    await noHorizontalOverflow(page);

    await page.getByRole('button', { name: t.demo, exact: true }).click();
    await idle(page);
    await expect(page.locator('.demo-badge')).toHaveText(t.demoBadge);
    await expect(page.getByRole('heading', { name: t.recipe, exact: true })).toBeVisible();
    const imageSwitch = page.getByRole('switch', { name: t.stripImages, exact: true });
    await expect(imageSwitch).toBeVisible();
    await expect(imageSwitch).toHaveAttribute('aria-checked', 'true');
    const imagesRemoved = page.locator('.changes-list > span').filter({ hasText: t.imagesRemoved }).locator('strong');
    await expect(imagesRemoved).toHaveText('1');
    await imageSwitch.click();
    await expect(imageSwitch).toHaveAttribute('aria-checked', 'false');
    await idle(page);
    await expect(imagesRemoved).toHaveText('0');
    await imageSwitch.click();
    await idle(page);
    await expect(imagesRemoved).toHaveText('1');
    await noHorizontalOverflow(page);

    const help = page.getByRole('button', { name: t.help, exact: true });
    await help.click();
    const dialog = page.getByRole('dialog', { name: t.help, exact: true });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('heading', { name: t.helpTitle, exact: true })).toBeVisible();
    await expect(dialog.getByRole('button', { name: t.close, exact: true })).toBeFocused();
    await noHorizontalOverflow(page);
    await page.keyboard.press('Escape');
    await expect(dialog).not.toBeVisible();
    await expect(help).toBeFocused();

    expect(await page.evaluate(() => ({ ...localStorage }))).toEqual({ 'threadpack-language': language.code });
    await page.reload();
    await expect(selector).toHaveValue(language.code);
    await expect(page.locator('html')).toHaveAttribute('lang', language.htmlLang);
    await expect(page.getByRole('button', { name: t.demo, exact: true })).toBeVisible();
    await expect(page.locator('.message-card')).toHaveCount(0);
    await expect(page.locator('.file-summary')).not.toBeVisible();
    expect(await page.evaluate(() => ({ ...localStorage }))).toEqual({ 'threadpack-language': language.code });
    await noHorizontalOverflow(page);
  });
}

test.describe('invalid stored preference', () => {
  test.describe('supported browser locale', () => {
    test.use({ locale: 'fr-FR' });
    test('falls back to the supported browser language without restoring conversation data', async ({ page }) => {
      // Stage an invalid preference before startup to simulate an older or modified value.
      await page.addInitScript(() => localStorage.setItem('threadpack-language', 'unsupported-language'));
      await page.goto('/');
      const t = dictionary('fr');
      await expect(page.getByRole('combobox', { name: 'Language / 语言', exact: true })).toHaveValue('fr');
      await expect(page.locator('html')).toHaveAttribute('lang', 'fr');
      await expect(page.getByRole('button', { name: t.demo, exact: true })).toBeVisible();
      await expect(page.locator('.message-card')).toHaveCount(0);
      await expect.poll(() => page.evaluate(() => localStorage.getItem('threadpack-language'))).toBe('fr');
    });
  });

  test.describe('unsupported browser locale', () => {
    test.use({ locale: 'de-DE' });
    test('uses English when neither stored nor browser language is supported', async ({ page }) => {
      await page.addInitScript(() => localStorage.setItem('threadpack-language', '__proto__'));
      await page.goto('/');
      await expect(page.getByRole('combobox', { name: 'Language / 语言', exact: true })).toHaveValue('en');
      await expect(page.locator('html')).toHaveAttribute('lang', 'en');
      await expect(page.getByRole('button', { name: dictionary('en').demo, exact: true })).toBeVisible();
      await expect.poll(() => page.evaluate(() => localStorage.getItem('threadpack-language'))).toBe('en');
    });
  });
});
