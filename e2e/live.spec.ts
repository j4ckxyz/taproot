import { expect, test } from '@playwright/test';
import { uid, addNodes, card, newProject, openProject, signIn } from './helpers';

test.beforeEach(async ({ page }) => signIn(page));

test('changes sync between tabs, with presence', async ({ page, context }) => {
  const p = await newProject(page, 'Two tabs');
  await addNodes(page, p.id, [{ op: 'create', node: { id: uid(), parentId: p.rootId, title: 'Shared' } }]);
  await openProject(page, p.id);
  const other = await context.newPage();
  await openProject(other, p.id);
  await card(other, 'Shared').click();
  await expect(page.locator('.presence-avatar')).toHaveCount(1);
  await other.keyboard.press('Tab');
  await other.keyboard.type('From the other tab');
  await other.keyboard.press('Enter');
  await expect(card(page, 'From the other tab')).toBeVisible();
});

test('an agent editing over MCP shows up live, with a cursor and a log entry', async ({ page }) => {
  const p = await newProject(page, 'Agent');
  const t = await (await page.request.post('/api/v1/tokens', { headers: { 'x-taproot-client': '1' }, data: { name: 'Claude', canWrite: true } })).json();
  await openProject(page, p.id);
  const r = await page.request.post('/mcp', {
    headers: { authorization: `Bearer ${t.secret}`, accept: 'application/json, text/event-stream' },
    data: { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'add_nodes', arguments: { project_id: p.id, parent_id: p.rootId, items: [{ title: 'Written by an agent' }] } } },
  });
  expect(r.ok()).toBeTruthy();
  await expect(card(page, 'Written by an agent')).toBeVisible();
  await expect(page.locator('.presence-cursor')).toContainText('Claude');
  await page.keyboard.press('h');
  await expect(page.getByRole('dialog')).toContainText('added “Written by an agent”');
});
