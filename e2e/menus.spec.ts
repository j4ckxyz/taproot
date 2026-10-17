import { expect, test } from '@playwright/test';
import { uid, addNodes, card, newProject, openProject, signIn } from './helpers';

test.beforeEach(async ({ page }) => signIn(page));

test('right-click menus work on cards and on the paper', async ({ page }) => {
  const p = await newProject(page, 'Menus');
  await addNodes(page, p.id, [{ op: 'create', node: { id: uid(), parentId: p.rootId, title: 'Card' } }]);
  await openProject(page, p.id);
  await card(page, 'Card').click({ button: 'right' });
  const menu = page.getByRole('menu');
  await expect(menu).toContainText('Add a sub-task');
  await menu.getByRole('menuitem', { name: /Due tomorrow/ }).click();
  await expect(menu).toBeHidden();
  await expect
    .poll(async () => (await (await page.request.get(`/api/v1/projects/${p.id}`)).json()).nodes.find((n: { title: string }) => n.title === 'Card').dueDate)
    .toBeTruthy();
  await page.mouse.click(1250, 800, { button: 'right' });
  await expect(page.getByRole('menu')).toContainText('Fit everything');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('menu')).toBeHidden();
});

test('the ? sheet opens, and closes on Esc or any click', async ({ page }) => {
  const p = await newProject(page, 'Sheet');
  await openProject(page, p.id);
  const sheet = page.getByRole('dialog', { name: 'Keyboard shortcuts' });
  await page.keyboard.press('?');
  await expect(sheet).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(sheet).toBeHidden();
  await page.keyboard.press('?');
  await page.mouse.click(300, 300);
  await expect(sheet).toBeHidden();
});

test('/ finds a card and selects it', async ({ page }) => {
  const p = await newProject(page, 'Find');
  await addNodes(page, p.id, [{ op: 'create', node: { id: uid(), parentId: p.rootId, title: 'Needle in a haystack' } }]);
  await openProject(page, p.id);
  await page.keyboard.press('/');
  await page.keyboard.type('needle');
  await page.keyboard.press('Enter');
  await expect(page.locator('.card-toolbar')).toContainText('Needle in a haystack');
});
