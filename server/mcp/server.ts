import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { z } from 'zod';
import { buildTree, toMarkdown } from '../../shared/tree.js';
import { buildScene } from '../../shared/render.js';
import { todayISO } from '../../shared/deadline.js';
import type { Op } from '../../shared/types.js';
import type { Actor } from '../auth.js';
import { config } from '../config.js';
import { renderPNG } from '../export/png.js';
import { exportMermaid } from '../export/formats.js';
import { agentActivity } from '../presence.js';
import { ChildLayoutSchema, ColorSchema, NodePatchSchema, OpSchema, ShapeSchema } from '../schemas.js';
import {
  applyOps,
  createProject,
  getDoc,
  listActivity,
  listProjects,
  searchNodes,
} from '../store.js';
import { HttpError, newId } from '../util.js';

const INSTRUCTIONS = `This server holds long-running projects drawn as a top-down tree ("waterfall") of shapes and text.
Each project has one root node (the idea in the middle/top); every other node is a task or sub-task with a parent.
Nodes can be checked off (done), have due dates (YYYY-MM-DD), notes, tags and free-form key/value metadata.
Start with list_projects, then get_project (format "outline" is the most compact). Use get_project_image to see the drawing.
Projects limit how deep branches go and how many children a node can have; tools return an error if a change would break those limits.
Write tools only exist when the API token has write access.`;

const text = (s: string) => ({ content: [{ type: 'text' as const, text: s }] });
const json = (v: unknown) => text(JSON.stringify(v, null, 2));

function wrap<A>(fn: (args: A) => Promise<ReturnType<typeof text> | object> | ReturnType<typeof text> | object) {
  return async (args: A) => {
    try {
      return (await fn(args)) as ReturnType<typeof text>;
    } catch (e) {
      const msg = e instanceof HttpError ? e.message : e instanceof Error ? e.message : String(e);
      return { content: [{ type: 'text' as const, text: `Error: ${msg}` }], isError: true };
    }
  };
}

interface NewItem {
  title: string;
  notes?: string;
  due_date?: string;
  start_date?: string;
  tags?: string[];
  meta?: Record<string, string>;
  shape?: z.infer<typeof ShapeSchema>;
  color?: z.infer<typeof ColorSchema>;
  child_layout?: z.infer<typeof ChildLayoutSchema>;
  done?: boolean;
  children?: NewItem[];
}

const NewItemSchema: z.ZodType<NewItem> = z.lazy(() =>
  z.object({
    title: z.string().min(1).max(500),
    notes: z.string().max(20_000).optional(),
    due_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe('YYYY-MM-DD'),
    start_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    tags: z.array(z.string()).optional(),
    meta: z.record(z.string(), z.string()).optional(),
    shape: ShapeSchema.optional(),
    color: ColorSchema.optional(),
    child_layout: ChildLayoutSchema.optional(),
    done: z.boolean().optional(),
    children: z.array(NewItemSchema).optional().describe('Nested sub-tasks'),
  }),
);

function flatten(items: NewItem[], parentId: string, ops: Op[]) {
  for (const it of items) {
    const id = newId();
    ops.push({
      op: 'create',
      node: {
        id,
        parentId,
        title: it.title,
        ...(it.notes !== undefined && { notes: it.notes }),
        ...(it.due_date && { dueDate: it.due_date }),
        ...(it.start_date && { startDate: it.start_date }),
        ...(it.tags && { tags: it.tags }),
        ...(it.meta && { meta: it.meta }),
        ...(it.shape && { shape: it.shape }),
        ...(it.color && { color: it.color }),
        ...(it.child_layout && { childLayout: it.child_layout }),
        ...(it.done !== undefined && { done: it.done }),
      },
    });
    if (it.children?.length) flatten(it.children, id, ops);
  }
}

export function buildMcpServer(actor: Actor): McpServer {
  const server = new McpServer({ name: config.appName.toLowerCase(), version: '0.1.0' }, { instructions: INSTRUCTIONS });
  const ro = { readOnlyHint: true, openWorldHint: false } as const;

  server.registerTool(
    'list_projects',
    {
      title: 'List projects',
      description: 'Lists projects this token can see, with progress counts and the next open deadline.',
      inputSchema: { include_archived: z.boolean().optional() },
      annotations: ro,
    },
    wrap(({ include_archived }: { include_archived?: boolean }) =>
      json(
        listProjects(actor, { includeArchived: include_archived }).map((p) => ({
          id: p.id,
          name: p.name,
          icon: p.icon,
          color: p.color,
          description: p.description,
          archived: p.archived,
          progress: `${p.done}/${p.total}`,
          nextDue: p.nextDue,
          rootId: p.rootId,
          limits: p.settings,
          updatedAt: p.updatedAt,
        })),
      ),
    ),
  );

  server.registerTool(
    'get_project',
    {
      title: 'Read a project',
      description:
        'Returns a project. format "outline" gives a compact Markdown checklist (ids omitted); "mermaid" gives a Mermaid flowchart you can paste into GitHub, Notion or docs; "json" gives every node with ids, parents, dates and metadata plus a deadline report.',
      inputSchema: {
        project_id: z.string(),
        format: z.enum(['outline', 'mermaid', 'json']).default('json'),
        include_done: z.boolean().default(true).describe('Include checked-off items'),
      },
      annotations: ro,
    },
    wrap(({ project_id, format, include_done }: { project_id: string; format: 'outline' | 'mermaid' | 'json'; include_done: boolean }) => {
      const doc = getDoc(actor, project_id);
      agentActivity(actor, project_id, null, 'reading');
      if (format === 'mermaid') {
        const kept = include_done ? doc : { ...doc, nodes: doc.nodes.filter((n) => !n.done || n.parentId === null) };
        return text(exportMermaid(kept));
      }
      if (format === 'outline') {
        return text(toMarkdown(buildTree(doc.nodes), { includeDone: include_done, heading: `${doc.project.name} (id ${doc.project.id})` }));
      }
      const scene = buildScene(doc);
      const nodes = doc.nodes
        .filter((n) => include_done || !n.done || n.parentId === null)
        .map(({ projectId: _p, createdAt: _c, ...n }) => {
          const dl = scene.deadlines.get(n.id);
          const p = scene.progress.get(n.id);
          return {
            ...n,
            depth: scene.layout.boxes.get(n.id)?.depth,
            ...(p && p.total ? { progress: `${p.done}/${p.total}` } : {}),
            ...(dl && dl.level !== 'none' ? { deadline: { level: dl.level, explanation: dl.explanation } } : {}),
          };
        });
      return json({ project: doc.project, today: todayISO(), nodes });
    }),
  );

  server.registerTool(
    'get_project_image',
    {
      title: 'See a project',
      description: 'Renders the project as a PNG image, exactly as it looks in the app (done items faded, deadlines highlighted).',
      inputSchema: { project_id: z.string(), theme: z.enum(['light', 'dark']).default('light') },
      annotations: ro,
    },
    wrap(({ project_id, theme }: { project_id: string; theme: 'light' | 'dark' }) => {
      const png = renderPNG(getDoc(actor, project_id), { theme, maxWidth: 1600 });
      agentActivity(actor, project_id, null, 'looking');
      return { content: [{ type: 'image' as const, data: png.toString('base64'), mimeType: 'image/png' }] };
    }),
  );

  server.registerTool(
    'search',
    {
      title: 'Search tasks',
      description: 'Finds nodes across projects by text, status, tag or due date.',
      inputSchema: {
        query: z.string().optional(),
        project_id: z.string().optional(),
        status: z.enum(['open', 'done', 'all']).default('all'),
        due_before: z.string().optional().describe('YYYY-MM-DD, inclusive'),
        tag: z.string().optional(),
        limit: z.number().int().min(1).max(200).default(50),
      },
      annotations: ro,
    },
    wrap((a: { query?: string; project_id?: string; status: 'open' | 'done' | 'all'; due_before?: string; tag?: string; limit: number }) =>
      json(
        searchNodes(actor, { query: a.query, projectId: a.project_id, status: a.status, dueBefore: a.due_before, tag: a.tag, limit: a.limit }).map(
          (n) => ({ id: n.id, project: n.projectName, projectId: n.projectId, parentId: n.parentId, title: n.title, done: n.done, dueDate: n.dueDate, tags: n.tags }),
        ),
      ),
    ),
  );

  server.registerTool(
    'upcoming_deadlines',
    {
      title: 'Upcoming deadlines',
      description: 'Open tasks that are overdue or due within the next N days, across all visible projects.',
      inputSchema: { days: z.number().int().min(0).max(365).default(14) },
      annotations: ro,
    },
    wrap(({ days }: { days: number }) => {
      const today = todayISO();
      const until = new Date(Date.parse(today) + days * 86_400_000).toISOString().slice(0, 10);
      return json({
        today,
        until,
        tasks: searchNodes(actor, { status: 'open', dueBefore: until, limit: 200 }).map((n) => ({
          id: n.id,
          project: n.projectName,
          projectId: n.projectId,
          title: n.title,
          dueDate: n.dueDate,
          overdue: n.dueDate! < today,
        })),
      });
    }),
  );

  server.registerTool(
    'get_activity',
    {
      title: 'Recent activity',
      description: 'Recent changes to a project, newest first, including which person or agent made them.',
      inputSchema: { project_id: z.string(), limit: z.number().int().min(1).max(200).default(30) },
      annotations: ro,
    },
    wrap(({ project_id, limit }: { project_id: string; limit: number }) => json(listActivity(actor, project_id, limit))),
  );

  if (!actor.token || actor.token.canWrite) registerWriteTools(server, actor);
  return server;
}

function registerWriteTools(server: McpServer, actor: Actor) {
  const w = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false } as const;

  server.registerTool(
    'create_project',
    {
      title: 'Create a project',
      description: 'Creates a project with a root idea, optionally with an initial tree of tasks.',
      inputSchema: {
        name: z.string().min(1).max(120),
        root_title: z.string().optional().describe('Text of the central idea; defaults to the name'),
        icon: z.string().max(16).optional().describe('An emoji'),
        color: ColorSchema.optional(),
        description: z.string().optional(),
        items: z.array(NewItemSchema).optional().describe('Top-level branches under the root'),
      },
      annotations: w,
    },
    wrap((a: { name: string; root_title?: string; icon?: string; color?: string; description?: string; items?: NewItem[] }) => {
      const doc = createProject(
        actor,
        { name: a.name, icon: a.icon ?? '🌊', color: (a.color as 'blue') ?? 'blue', description: a.description ?? '', settings: {} },
        a.root_title,
      );
      if (a.items?.length) {
        const ops: Op[] = [];
        flatten(a.items, doc.project.rootId, ops);
        applyOps(actor, doc.project.id, ops);
      }
      return json({ projectId: doc.project.id, rootId: doc.project.rootId });
    }),
  );

  server.registerTool(
    'add_nodes',
    {
      title: 'Add tasks',
      description: 'Adds one or more tasks (with optional nested sub-tasks) under a parent node. Use the root id to add a top-level branch.',
      inputSchema: { project_id: z.string(), parent_id: z.string(), items: z.array(NewItemSchema).min(1) },
      annotations: w,
    },
    wrap(({ project_id, parent_id, items }: { project_id: string; parent_id: string; items: NewItem[] }) => {
      const ops: Op[] = [];
      flatten(items, parent_id, ops);
      const r = applyOps(actor, project_id, ops);
      return json({ created: r.upserted.map((n) => ({ id: n.id, parentId: n.parentId, title: n.title })), version: r.version });
    }),
  );

  server.registerTool(
    'update_node',
    {
      title: 'Edit a task',
      description: 'Changes fields on a node. Only the fields you pass are changed; pass null to clear a date or colour.',
      inputSchema: {
        project_id: z.string(),
        node_id: z.string(),
        patch: NodePatchSchema.omit({ parentId: true, sort: true }),
      },
      annotations: { ...w, idempotentHint: true },
    },
    wrap(({ project_id, node_id, patch }: { project_id: string; node_id: string; patch: Record<string, unknown> }) => {
      const r = applyOps(actor, project_id, [{ op: 'update', id: node_id, patch }]);
      return json({ node: r.upserted[0], version: r.version });
    }),
  );

  server.registerTool(
    'set_done',
    {
      title: 'Check off tasks',
      description: 'Marks tasks done (or not done). Done tasks stay visible but faded.',
      inputSchema: { project_id: z.string(), node_ids: z.array(z.string()).min(1), done: z.boolean().default(true) },
      annotations: { ...w, idempotentHint: true },
    },
    wrap(({ project_id, node_ids, done }: { project_id: string; node_ids: string[]; done: boolean }) => {
      const r = applyOps(actor, project_id, node_ids.map((id) => ({ op: 'update' as const, id, patch: { done } })));
      return json({ updated: r.upserted.map((n) => ({ id: n.id, title: n.title, done: n.done })), version: r.version });
    }),
  );

  server.registerTool(
    'move_node',
    {
      title: 'Move a task',
      description: 'Moves a node and everything under it to a new parent. Optionally place it before a given sibling.',
      inputSchema: {
        project_id: z.string(),
        node_id: z.string(),
        new_parent_id: z.string(),
        before_id: z.string().optional().describe('Sibling to insert before; omit to append'),
      },
      annotations: w,
    },
    wrap(({ project_id, node_id, new_parent_id, before_id }: { project_id: string; node_id: string; new_parent_id: string; before_id?: string }) => {
      let sort: number | undefined;
      if (before_id) {
        const doc = getDoc(actor, project_id);
        const sib = doc.nodes.filter((n) => n.parentId === new_parent_id && n.id !== node_id).sort((a, b) => a.sort - b.sort);
        const i = sib.findIndex((n) => n.id === before_id);
        if (i >= 0) sort = i === 0 ? sib[0].sort - 1 : (sib[i - 1].sort + sib[i].sort) / 2;
      }
      const r = applyOps(actor, project_id, [{ op: 'update', id: node_id, patch: { parentId: new_parent_id, ...(sort !== undefined && { sort }) } }]);
      return json({ node: r.upserted[0], version: r.version });
    }),
  );

  server.registerTool(
    'delete_node',
    {
      title: 'Delete a task',
      description: 'Permanently deletes a node and all nodes beneath it. Prefer set_done for finished work.',
      inputSchema: { project_id: z.string(), node_id: z.string() },
      annotations: { ...w, destructiveHint: true },
    },
    wrap(({ project_id, node_id }: { project_id: string; node_id: string }) => {
      const r = applyOps(actor, project_id, [{ op: 'delete', id: node_id }]);
      return json({ deleted: r.deleted, version: r.version });
    }),
  );

  server.registerTool(
    'apply_ops',
    {
      title: 'Batch changes',
      description:
        'Applies several create/update/delete operations atomically (all or nothing). Creates may set an "id" so later ops can reference it.',
      inputSchema: { project_id: z.string(), ops: z.array(OpSchema).min(1).max(500) },
      annotations: { ...w, destructiveHint: true },
    },
    wrap(({ project_id, ops }: { project_id: string; ops: Op[] }) => {
      const r = applyOps(actor, project_id, ops);
      return json({ version: r.version, created: r.created, updated: r.upserted.length, deleted: r.deleted });
    }),
  );
}

export async function handleMcp(actor: Actor, req: Request): Promise<Response> {
  const server = buildMcpServer(actor);
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  await server.connect(transport);
  try {
    return await transport.handleRequest(req);
  } finally {
    // Stateless: one server per request.
    void transport.close();
    void server.close();
  }
}
