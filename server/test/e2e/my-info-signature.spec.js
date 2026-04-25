const { test, expect } = require('@playwright/test');

const ONE_PIXEL_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aJ6EAAAAASUVORK5CYII=',
  'base64'
);

test.beforeEach(async ({ request }) => {
  await request.post('/api/testReset');
});

async function loginAs(page, userId, password) {
  await page.goto('/');
  await page.locator('#user-id').fill(userId);
  await page.locator('#user-pw').fill(password);
  await page.locator('button.btn-primary').click();
}

async function selectSecondFactory(page) {
  await page.locator('#factory-select-list button').nth(1).click();
}

test('my info modal shows the saved electronic signature', async ({ page }) => {
  await loginAs(page, 'admin', '1234');
  await selectSecondFactory(page);
  await page.locator('#my-info-btn').click();

  await expect(page.locator('#modal-title')).not.toHaveText('');
  await expect(page.getByAltText('전자서명')).toBeVisible();
});

test('writer without signature is redirected to the signature registration modal after login', async ({ page }) => {
  await loginAs(page, 'writer1', '1234');

  await expect(page.locator('#modal-title')).not.toHaveText('');
  await expect(page.locator('#sig-canvas')).toBeVisible();
});

test('admin can open user management after selecting a factory', async ({ page }) => {
  await loginAs(page, 'admin', '1234');

  await expect(page.locator('#factory-select-screen')).toBeVisible();
  await expect(page.locator('#factory-select-list button')).toHaveCount(2);

  await selectSecondFactory(page);
  await expect(page.locator('#main-screen')).toBeVisible();
  await expect(page.locator('#user-mgmt-btn')).toBeVisible();

  await page.locator('#user-mgmt-btn').click();
  await expect(page.locator('#modal-title')).not.toHaveText('');
  await expect(page.locator('#um-list > div')).toHaveCount(6);
});

test('multi-factory user sees the factory selection screen', async ({ page }) => {
  await loginAs(page, 'multi1', '1234');

  await expect(page.locator('#factory-select-screen')).toBeVisible();
  await expect(page.locator('#factory-select-list button')).toHaveCount(2);
});

test('selecting a todo card opens the form screen', async ({ page }) => {
  await loginAs(page, 'admin', '1234');
  await selectSecondFactory(page);
  await page.locator('#todo-list .log-card').first().click();

  await expect(page.locator('#form-screen')).toBeVisible();
  await expect(page.locator('#form-title')).not.toHaveText('');
});

test('approved record detail can be opened from the done list', async ({ page }) => {
  await loginAs(page, 'admin', '1234');
  await selectSecondFactory(page);
  await page.locator('#tab-done').click();
  await page.locator('#done-list .done-card-clickable').first().click();

  await expect(page.locator('#modal-title')).not.toHaveText('');
  await expect(page.locator('#modal-body')).toContainText('작성자1');
  await expect(page.locator('#modal-body')).toContainText('승인 완료 기록');
});

test('switch factory button returns the user to the factory selection screen', async ({ page }) => {
  await loginAs(page, 'admin', '1234');
  await selectSecondFactory(page);

  await expect(page.locator('#current-factory-name')).not.toHaveText('');
  await page.locator('#factory-switch-btn').click();
  await expect(page.locator('#factory-select-screen')).toBeVisible();
  await expect(page.locator('#factory-select-list button')).toHaveCount(2);
});

test('password change modal opens from my info', async ({ page }) => {
  await loginAs(page, 'admin', '1234');
  await selectSecondFactory(page);
  await page.locator('#my-info-btn').click();
  await page.locator('#change-pw-btn').click();

  await expect(page.locator('#modal-title')).not.toHaveText('');
  await expect(page.locator('#new-pw')).toBeVisible();
  await expect(page.locator('#submit-new-pw-btn')).toBeVisible();
});

test('print modal can search and list approved records', async ({ page }) => {
  await loginAs(page, 'admin', '1234');
  await selectSecondFactory(page);
  await page.locator('#print-btn').click();

  await expect(page.locator('#modal-title')).not.toHaveText('');
  await page.locator('#search-print-btn').click();

  await expect(page.locator('#print-record-list label')).toHaveCount(1);
  await expect(page.locator('#print-record-list')).toContainText('2공장 일일 점검');
});

test('admin can fill a todo form and submit it into the done list', async ({ page }) => {
  await loginAs(page, 'admin', '1234');
  await selectSecondFactory(page);
  page.on('dialog', dialog => dialog.accept());

  const todoBefore = await page.locator('#todo-list .log-card').count();
  await page.locator('#todo-list .log-card').first().click();
  await expect(page.locator('#form-screen')).toBeVisible();

  await page.locator('#f-temp').fill('4.8');
  await page.locator('.btn-all-ok').click();
  await page.locator('.form-header .form-back-btn').last().click();
  await page.locator('#confirm-submit-btn').click();

  await expect(page.locator('#main-screen')).toBeVisible();
  await page.locator('#tab-done').click();
  await expect(page.locator('#done-list')).toContainText('2공장 주간 점검');
  await expect(page.locator('#todo-list .log-card')).toHaveCount(todoBefore - 1);
});

test('admin can approve a reviewed record from the done list', async ({ page }) => {
  await loginAs(page, 'admin', '1234');
  await selectSecondFactory(page);
  page.on('dialog', dialog => {
    if (dialog.type() === 'prompt') return dialog.accept('2025-01-01');
    return dialog.accept();
  });

  await page.locator('#tab-done').click();
  const card = page.locator('#done-list .done-card-wrap').filter({ hasText: '2공장 주간 점검' }).filter({ hasText: '작성자1' }).first();
  await expect(card).toContainText('검토완료');
  await card.locator('.btn-approve').click();
  await expect(card).toContainText('승인완료');
});

test('admin can revoke approval for an approved record', async ({ page }) => {
  await loginAs(page, 'admin', '1234');
  await selectSecondFactory(page);
  page.on('dialog', dialog => dialog.accept());

  await page.locator('#tab-done').click();
  const card = page.locator('#done-list .done-card-wrap').filter({ hasText: '2공장 일일 점검' }).first();
  await expect(card).toContainText('승인완료');
  await card.locator('.btn-ghost-approve').click();
  await expect(card).toContainText('검토완료');
});

test('print flow can open the print overlay for a selected approved record', async ({ page }) => {
  await loginAs(page, 'admin', '1234');
  await page.locator('#factory-select-list button').first().click();

  await page.locator('#print-btn').click();
  await page.locator('#search-print-btn').click();
  await expect(page.locator('#print-record-list label')).toHaveCount(1);
  await page.locator('#print-record-list label input[type="checkbox"]').first().check({ force: true });
  await page.locator('#execute-print-btn').click();

  await expect(page.locator('#print-overlay')).not.toHaveClass(/hidden/);
  await expect(page.locator('#print-overlay-toolbar')).toBeVisible();
});

test('reviewer can review a submitted record from the done list', async ({ page }) => {
  page.on('dialog', dialog => dialog.accept());

  await loginAs(page, 'multi1', '1234');
  await selectSecondFactory(page);
  await page.locator('#todo-list .log-card').first().click();
  await page.locator('#f-temp').fill('5.0');
  await page.locator('.btn-all-ok').click();
  await page.locator('.form-header .form-back-btn').last().click();
  await page.locator('#confirm-submit-btn').click();
  await page.locator('button.btn-logout').click();

  await loginAs(page, 'reviewer1', '1234');
  await page.locator('#tab-done').click();

  const card = page.locator('#done-list .done-card-wrap').filter({ hasText: '2공장 주간 점검' }).filter({ hasText: '다공장사용자' }).first();
  await expect(card).toContainText('작성완료');
  await card.locator('.btn-review').click();
  await expect(card).toContainText('검토완료');
});

test('photo can be attached to an NG item and preview is shown', async ({ page }) => {
  await loginAs(page, 'admin', '1234');
  await selectSecondFactory(page);
  await page.locator('#todo-list .log-card').first().click();

  await page.locator('#btn-ng-floor').click();
  await page.locator('#defect-text-floor').fill('바닥 오염');
  await page.locator('#action-text-floor').fill('청소 완료');
  await page.locator('#photo-input-defect-gallery-floor').setInputFiles({
    name: 'defect.png',
    mimeType: 'image/png',
    buffer: ONE_PIXEL_PNG,
  });

  await expect(page.locator('#defect-photo-preview-floor img')).toBeVisible();
});
