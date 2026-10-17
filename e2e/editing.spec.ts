import { expect, test } from '@playwright/test';
import { uid, addNodes, card, editorFocused, newProject, openProject, serverTitles, signIn } from './helpers';

test.beforeEach(async ({ page }) => signIn(page));

test('a new project needs only a name and opens ready to type the first step', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('heading', { level: 1 }).waitFor();
  await page.keyboard.press('n');
  await expect(page.getByLabel('Project name')).toBeFocused();
  await page.keyboard.type('Plant a garden');
  await page.keyboard.press('Enter');
  await page.locator('[data-node]').first().waitFor();
  await expect.poll(() => editorFocused(page)).toBe(true);
});

test('Tab, Shift+Tab and Esc save what you typed', async ({ page, request }) => {
  const p = await newProject(page, 'Typing');
  await openProject(page, p.id);
  await page.keyboard.press('Tab');
  await page.keyboard.type('Research');
  await page.keyboard.press('Tab');
  await page.keyboard.type('Sources');
  await page.keyboard.press('Shift+Tab');
  await page.keyboard.type('Survey');
  await page.keyboard.press('Escape');
  await expect.poll(() => serverTitles(page.request, p.id)).toEqual(['Research', 'Sources', 'Survey', 'Typing']);
  void request;
});

test('Enter renames, and an empty new card is dropped', async ({ page }) => {
  const p = await newProject(page, 'Rename');
  await addNodes(page, p.id, [{ op: 'create', node: { id: uid(), parentId: p.rootId, title: 'Old name' } }]);
  await openProject(page, p.id);
  await card(page, 'Old name').click();
  await page.keyboard.press('Enter');
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.type('New name');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Tab');
  await page.keyboard.press('Escape');
  await expect.poll(() => serverTitles(page.request, p.id)).toEqual(['New name', 'Rename']);
});

test('double-click a card renames it; clicking away saves', async ({ page }) => {
  const p = await newProject(page, 'Clicks');
  await addNodes(page, p.id, [{ op: 'create', node: { id: uid(), parentId: p.rootId, title: 'Draft' } }]);
  await openProject(page, p.id);
  await card(page, 'Draft').dblclick();
  await expect.poll(() => editorFocused(page)).toBe(true);
  await page.keyboard.press('End');
  await page.keyboard.type(' v2');
  await page.mouse.click(1200, 820);
  await expect.poll(() => serverTitles(page.request, p.id)).toEqual(['Clicks', 'Draft v2']);
});

test('clicking a selected card again renames it', async ({ page }) => {
  const p = await newProject(page, 'Click again');
  await addNodes(page, p.id, [{ op: 'create', node: { id: uid(), parentId: p.rootId, title: 'Twice' } }]);
  await openProject(page, p.id);
  await card(page, 'Twice').click();
  await page.waitForTimeout(500);
  await card(page, 'Twice').click();
  await expect.poll(() => editorFocused(page)).toBe(true);
});

test('double-clicking empty paper adds a card', async ({ page }) => {
  const p = await newProject(page, 'Paper');
  await openProject(page, p.id);
  await page.mouse.dblclick(1100, 760);
  await expect.poll(() => editorFocused(page)).toBe(true);
  await page.keyboard.type('From the paper');
  await page.keyboard.press('Enter');
  await expect.poll(() => serverTitles(page.request, p.id)).toEqual(['From the paper', 'Paper']);
});

test('X checks off, Alt+1 sets due today, locking blocks edits', async ({ page }) => {
  const p = await newProject(page, 'Keys');
  await addNodes(page, p.id, [{ op: 'create', node: { id: uid(), parentId: p.rootId, title: 'Task' } }]);
  await openProject(page, p.id);
  await card(page, 'Task').click();
  await page.keyboard.press('x');
  await page.keyboard.press('Alt+1');
  const node = async () => (await (await page.request.get(`/api/v1/projects/${p.id}`)).json()).nodes.find((n: { title: string }) => n.title === 'Task');
  await expect.poll(async () => (await node()).done).toBe(true);
  await expect.poll(async () => !!(await node()).dueDate).toBe(true);
  await page.keyboard.press('Shift+L');
  await page.keyboard.press('Tab');
  await page.waitForTimeout(400);
  await expect.poll(() => serverTitles(page.request, p.id)).toEqual(['Keys', 'Task']);
  await page.keyboard.press('Shift+L');
});
