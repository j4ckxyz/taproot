import { expect, type APIRequestContext, type Page } from '@playwright/test';

/** A fresh card id (ids are unique across the whole server). */
export const uid = () => `e2e${Math.random().toString(36).slice(2, 12)}`;

export const ADMIN = { email: 'e2e@taproot.test', password: 'e2e-password', name: 'Robin' };
const H = { 'x-taproot-client': '1' };

/** Signs the page in, creating the admin account on a fresh server. */
export async function signIn(page: Page) {
  const status = await (await page.request.get('/api/v1/auth/status')).json();
  const path = status.needsSetup ? '/api/v1/auth/setup' : '/api/v1/auth/login';
  const r = await page.request.post(path, { headers: H, data: ADMIN });
  expect(r.ok()).toBeTruthy();
  // Every test starts from the default preferences (e.g. not locked).
  await page.request.patch('/api/v1/me', { headers: H, data: { prefs: { lockCanvas: false, snapZoom: false, motion: true } } });
}

export async function newProject(page: Page, name: string, color = 'blue') {
  const r = await page.request.post('/api/v1/projects', { headers: H, data: { name, icon: '🧪', color } });
  return (await r.json()).project as { id: string; rootId: string };
}

export async function addNodes(page: Page, projectId: string, ops: unknown[]) {
  const r = await page.request.post(`/api/v1/projects/${projectId}/ops`, { headers: H, data: { ops } });
  expect(r.ok()).toBeTruthy();
}

export async function serverTitles(request: APIRequestContext, projectId: string): Promise<string[]> {
  const d = await (await request.get(`/api/v1/projects/${projectId}`)).json();
  return d.nodes.map((n: { title: string }) => n.title).sort();
}

export const card = (page: Page, title: string) => page.locator('[data-node]').filter({ has: page.locator('.title', { hasText: new RegExp(`^${title}$`) }) });

export const editorFocused = (page: Page) => page.evaluate(() => !!document.activeElement?.hasAttribute('data-inline-editor'));

export async function openProject(page: Page, id: string) {
  await page.goto(`/p/${id}`);
  await page.locator('[data-node]').first().waitFor();
  await page.waitForTimeout(400);
}
