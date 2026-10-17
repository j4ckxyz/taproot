import type { ActivityEntry, ApiToken, Project, ProjectDoc, ProjectSummary, User } from '@shared/types';

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

async function request<T>(method: string, path: string, body?: unknown, raw = false): Promise<T> {
  const res = await fetch(`/api/v1${path}`, {
    method,
    headers: {
      'x-taproot-client': '1',
      ...(body !== undefined && !raw ? { 'content-type': 'application/json' } : {}),
    },
    body: body === undefined ? undefined : raw ? (body as string) : JSON.stringify(body),
    credentials: 'same-origin',
  });
  if (!res.ok) {
    let code = 'error';
    let message = `Request failed (${res.status})`;
    try {
      const j = await res.json();
      code = j.error?.code ?? code;
      message = j.error?.message ?? message;
    } catch {
      /* not JSON */
    }
    throw new ApiError(res.status, code, message);
  }
  return res.json() as Promise<T>;
}

export const api = {
  get: <T>(p: string) => request<T>('GET', p),
  post: <T>(p: string, b?: unknown) => request<T>('POST', p, b ?? {}),
  patch: <T>(p: string, b: unknown) => request<T>('PATCH', p, b),
  del: <T>(p: string) => request<T>('DELETE', p),
  raw: <T>(p: string, text: string) => request<T>('POST', p, text, true),
};

export interface AuthStatus {
  appName: string;
  needsSetup: boolean;
  allowSignup: boolean;
  user: User | null;
}

export const auth = {
  status: () => api.get<AuthStatus>('/auth/status'),
  setup: (b: { email: string; name: string; password: string }) => api.post<{ user: User }>('/auth/setup', b),
  signup: (b: { email: string; name: string; password: string }) => api.post<{ user: User }>('/auth/signup', b),
  login: (b: { email: string; password: string }) => api.post<{ user: User }>('/auth/login', b),
  logout: () => api.post('/auth/logout'),
};

export const projectsApi = {
  list: (archived = false) => api.get<{ projects: ProjectSummary[] }>(`/projects${archived ? '?archived=true' : ''}`),
  get: (id: string) => api.get<ProjectDoc>(`/projects/${id}`),
  create: (b: Partial<Project> & { name: string; rootTitle?: string }) => api.post<ProjectDoc>('/projects', b),
  update: (id: string, b: Partial<Project>) => api.patch<{ project: Project }>(`/projects/${id}`, b),
  remove: (id: string) => api.del(`/projects/${id}`),
  import: (format: string, text: string, name?: string) =>
    api.raw<ProjectDoc>(`/projects/import?format=${format}${name ? `&name=${encodeURIComponent(name)}` : ''}`, text),
  activity: (id: string) => api.get<{ activity: ActivityEntry[] }>(`/projects/${id}/activity`),
};

export const tokensApi = {
  list: () => api.get<{ tokens: ApiToken[] }>('/tokens'),
  create: (b: { name: string; canWrite: boolean; projectIds: string[] | null; expiresAt: string | null }) =>
    api.post<{ token: ApiToken; secret: string }>('/tokens', b),
  update: (id: string, b: Partial<ApiToken>) => api.patch<{ token: ApiToken }>(`/tokens/${id}`, b),
  revoke: (id: string) => api.del(`/tokens/${id}`),
};

export function exportUrl(id: string, format: string, theme?: string) {
  return `/api/v1/projects/${id}/export?format=${format}${theme ? `&theme=${theme}` : ''}`;
}
