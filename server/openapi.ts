import { z } from 'zod';
import {
  NodeCreateSchema,
  NodePatchSchema,
  OpsBodySchema,
  ProjectCreateSchema,
  ProjectPatchSchema,
  TokenCreateSchema,
} from './schemas.js';
import { config } from './config.js';

const schema = (s: z.ZodType) => {
  const out = z.toJSONSchema(s, { target: 'openapi-3.0', unrepresentable: 'any', io: 'input' }) as Record<string, unknown>;
  delete out.$schema;
  return out;
};

const ref = (name: string) => ({ $ref: `#/components/schemas/${name}` });
const jsonBody = (name: string) => ({ required: true, content: { 'application/json': { schema: ref(name) } } });
const ok = (description: string, s?: object) => ({
  description,
  ...(s ? { content: { 'application/json': { schema: s } } } : {}),
});
const pid = { name: 'id', in: 'path', required: true, schema: { type: 'string' }, description: 'Project id' };
const nid = { name: 'nodeId', in: 'path', required: true, schema: { type: 'string' } };

export function openApiSpec(baseUrl: string) {
  return {
    openapi: '3.0.3',
    info: {
      title: `${config.appName} API`,
      version: '1.0.0',
      description: `REST API for ${config.appName}: long-running projects drawn as trees of shapes and text.

**Authentication.** Create a token in *Settings → API tokens* and send it as \`Authorization: Bearer tap_…\`.
Tokens are read-only unless you enable write access, and can be limited to specific projects.

**Model.** A project has one root node. Every other node has a \`parentId\`. Children are ordered by \`sort\`.
Each project sets \`maxDepth\` (levels below the root) and \`maxChildren\` (per node); changes that would exceed them fail with 422.

**Writing.** Use \`POST /projects/{id}/ops\` to apply several changes atomically. Creates may supply their own \`id\` so that later ops in the same batch can refer to them.

**Live updates.** \`GET /projects/{id}/events\` streams Server-Sent Events (\`change\` events carry upserted nodes and deleted ids).

**MCP.** The same features are available to MCP clients at \`${baseUrl}/mcp\` (Streamable HTTP).`,
    },
    servers: [{ url: `${baseUrl}/api/v1` }],
    security: [{ bearer: [] }],
    components: {
      securitySchemes: { bearer: { type: 'http', scheme: 'bearer', description: 'API token (tap_…)' } },
      schemas: {
        Node: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            projectId: { type: 'string' },
            parentId: { type: 'string', nullable: true, description: 'null for the root' },
            sort: { type: 'number' },
            title: { type: 'string' },
            notes: { type: 'string' },
            shape: { type: 'string', enum: ['rounded', 'rect', 'ellipse', 'diamond', 'text'], description: 'rounded = card, rect = square card, ellipse = pill, diamond = milestone, text = plain text' },
            color: { type: 'string', nullable: true },
            childLayout: { type: 'string', enum: ['row', 'column'] },
            collapsed: { type: 'boolean' },
            done: { type: 'boolean' },
            doneAt: { type: 'string', nullable: true },
            startDate: { type: 'string', nullable: true, example: '2026-11-01' },
            dueDate: { type: 'string', nullable: true, example: '2026-11-14' },
            tags: { type: 'array', items: { type: 'string' } },
            meta: { type: 'object', additionalProperties: { type: 'string' } },
            createdAt: { type: 'string' },
            updatedAt: { type: 'string' },
          },
        },
        Project: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            name: { type: 'string' },
            icon: { type: 'string' },
            color: { type: 'string' },
            description: { type: 'string' },
            settings: {
              type: 'object',
              properties: { maxDepth: { type: 'integer' }, maxChildren: { type: 'integer' }, warnDays: { type: 'integer' } },
            },
            archived: { type: 'boolean' },
            rootId: { type: 'string' },
            version: { type: 'integer' },
            createdAt: { type: 'string' },
            updatedAt: { type: 'string' },
          },
        },
        ProjectDoc: {
          type: 'object',
          properties: { project: ref('Project'), nodes: { type: 'array', items: ref('Node') } },
        },
        Error: {
          type: 'object',
          properties: { error: { type: 'object', properties: { code: { type: 'string' }, message: { type: 'string' } } } },
        },
        ProjectCreate: schema(ProjectCreateSchema.extend({ rootTitle: z.string().optional() })),
        ProjectPatch: schema(ProjectPatchSchema),
        NodeCreate: schema(NodeCreateSchema),
        NodePatch: schema(NodePatchSchema),
        OpsBody: schema(OpsBodySchema),
        TokenCreate: schema(TokenCreateSchema),
      },
    },
    paths: {
      '/projects': {
        get: {
          tags: ['Projects'],
          summary: 'List projects',
          parameters: [{ name: 'archived', in: 'query', schema: { type: 'boolean' } }],
          responses: { 200: ok('Projects with progress counts') },
        },
        post: {
          tags: ['Projects'],
          summary: 'Create a project (write)',
          requestBody: jsonBody('ProjectCreate'),
          responses: { 201: ok('The new project and its root node', ref('ProjectDoc')) },
        },
      },
      '/projects/import': {
        post: {
          tags: ['Projects'],
          summary: 'Import a project (write)',
          description: 'Body is the raw file: a Taproot JSON export, a Markdown checklist, or OPML.',
          parameters: [
            { name: 'format', in: 'query', schema: { type: 'string', enum: ['json', 'markdown', 'opml'] } },
            { name: 'name', in: 'query', schema: { type: 'string' } },
          ],
          requestBody: { content: { 'text/plain': { schema: { type: 'string' } } } },
          responses: { 201: ok('Imported project', ref('ProjectDoc')) },
        },
      },
      '/projects/{id}': {
        parameters: [pid],
        get: {
          tags: ['Projects'],
          summary: 'Get a project and all its nodes',
          parameters: [{ name: 'include', in: 'query', schema: { type: 'string', enum: ['deadlines'] }, description: 'Add a deadline report' }],
          responses: { 200: ok('Project document', ref('ProjectDoc')) },
        },
        patch: { tags: ['Projects'], summary: 'Update project details or limits (write)', requestBody: jsonBody('ProjectPatch'), responses: { 200: ok('Updated') } },
        delete: { tags: ['Projects'], summary: 'Delete a project (signed-in users only)', responses: { 200: ok('Deleted') } },
      },
      '/projects/{id}/ops': {
        parameters: [pid],
        post: {
          tags: ['Nodes'],
          summary: 'Apply a batch of node operations atomically (write)',
          requestBody: jsonBody('OpsBody'),
          responses: { 200: ok('New version, changed nodes and deleted ids'), 422: ok('A limit was exceeded or validation failed', ref('Error')) },
        },
      },
      '/projects/{id}/nodes': {
        parameters: [pid],
        post: { tags: ['Nodes'], summary: 'Create a node (write)', requestBody: jsonBody('NodeCreate'), responses: { 201: ok('Created') } },
      },
      '/projects/{id}/nodes/{nodeId}': {
        parameters: [pid, nid],
        patch: { tags: ['Nodes'], summary: 'Update a node (write)', requestBody: jsonBody('NodePatch'), responses: { 200: ok('Updated') } },
        delete: { tags: ['Nodes'], summary: 'Delete a node and its sub-tree (write)', responses: { 200: ok('Deleted') } },
      },
      '/projects/{id}/outline': {
        parameters: [pid],
        get: {
          tags: ['Projects'],
          summary: 'Markdown checklist of the project',
          responses: { 200: { description: 'Markdown', content: { 'text/markdown': { schema: { type: 'string' } } } } },
        },
      },
      '/projects/{id}/export': {
        parameters: [pid],
        get: {
          tags: ['Export'],
          summary: 'Export a project',
          parameters: [
            { name: 'format', in: 'query', schema: { type: 'string', enum: ['json', 'markdown', 'opml', 'mermaid', 'excalidraw', 'svg', 'png'] } },
            { name: 'theme', in: 'query', schema: { type: 'string', enum: ['light', 'dark'] } },
            { name: 'download', in: 'query', schema: { type: 'boolean' } },
          ],
          responses: { 200: { description: 'File in the requested format' } },
        },
      },
      '/projects/{id}/activity': {
        parameters: [pid],
        get: { tags: ['Projects'], summary: 'Recent changes, newest first', responses: { 200: ok('Activity entries') } },
      },
      '/projects/{id}/events': {
        parameters: [pid],
        get: {
          tags: ['Projects'],
          summary: 'Live changes (Server-Sent Events)',
          responses: { 200: { description: 'text/event-stream with hello, change and ping events' } },
        },
      },
      '/search': {
        get: {
          tags: ['Search'],
          summary: 'Search nodes across projects',
          parameters: [
            { name: 'q', in: 'query', schema: { type: 'string' } },
            { name: 'projectId', in: 'query', schema: { type: 'string' } },
            { name: 'status', in: 'query', schema: { type: 'string', enum: ['open', 'done', 'all'] } },
            { name: 'dueBefore', in: 'query', schema: { type: 'string' } },
            { name: 'tag', in: 'query', schema: { type: 'string' } },
            { name: 'limit', in: 'query', schema: { type: 'integer' } },
          ],
          responses: { 200: ok('Matching nodes') },
        },
      },
      '/deadlines': {
        get: {
          tags: ['Search'],
          summary: 'Open tasks overdue or due within N days',
          parameters: [{ name: 'days', in: 'query', schema: { type: 'integer', default: 14 } }],
          responses: { 200: ok('Tasks sorted by due date') },
        },
      },
      '/me': { get: { tags: ['Account'], summary: 'Who this token belongs to and what it can do', responses: { 200: ok('User and token info') } } },
    },
  };
}

export function docsPage(appName: string) {
  return `<!doctype html>
<html><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>${appName} API</title></head>
<body>
<script id="api-reference" data-url="/api/openapi.json"></script>
<script src="https://cdn.jsdelivr.net/npm/@scalar/api-reference@1.72.3"></script>
</body></html>`;
}

export function llmsTxt(baseUrl: string) {
  return `# ${config.appName}

> Self-hosted planner for long-running projects. Each project is a top-down tree ("waterfall") of shapes and text: one root idea, branches of tasks and sub-tasks. Tasks can be checked off (they fade but stay visible), and carry due dates, notes, tags and key/value metadata.

## Connecting an agent

- MCP (Streamable HTTP): ${baseUrl}/mcp, with header \`Authorization: Bearer <token>\`.
  Clients that cannot set headers can use ${baseUrl}/mcp/t/<token> (keep that URL secret).
- REST: ${baseUrl}/api/v1, with the same bearer token. OpenAPI: ${baseUrl}/api/openapi.json. Interactive docs: ${baseUrl}/api/docs
- Tokens are created by a person in Settings → API tokens. They are read-only unless write access is turned on, and can be limited to chosen projects.

## Useful endpoints

- GET /api/v1/projects: list projects
- GET /api/v1/projects/{id}: every node as JSON (add ?include=deadlines for a deadline report)
- GET /api/v1/projects/{id}/outline: Markdown checklist
- GET /api/v1/projects/{id}/export?format=png: picture of the project
- GET /api/v1/projects/{id}/export?format=mermaid: Mermaid flowchart
- GET /api/v1/deadlines?days=14: open tasks due soon or overdue
- People watching a project see your reads and edits live, labelled with your token's name.
- POST /api/v1/projects/{id}/ops: atomic batch of {op:"create"|"update"|"delete"} (needs write access)

## Rules

- The root node cannot be moved or deleted.
- Each project limits depth (maxDepth) and children per node (maxChildren); exceeding them returns 422.
- Prefer marking work done ("done": true) over deleting it.
`;
}
