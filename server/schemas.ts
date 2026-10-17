import { z } from 'zod';
import { ACCENTS, CHILD_LAYOUTS, COLOR_NAMES, LIMITS, SHAPES, type AccentName, type ColorName } from '../shared/types.js';

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD')
  .describe('Calendar date, YYYY-MM-DD');

export const ColorSchema = z.enum(COLOR_NAMES as [ColorName, ...ColorName[]]).describe('Palette colour name');
export const ShapeSchema = z
  .enum(SHAPES)
  .describe('Node style: "rounded" card (default), "rect" square card, "ellipse" pill, "diamond" milestone card, "text" plain text');
export const ChildLayoutSchema = z
  .enum(CHILD_LAYOUTS)
  .describe('"row" spreads children out below the node; "column" stacks them down its right-hand side');

export const NodeIdSchema = z.string().regex(/^[A-Za-z0-9_-]{6,40}$/, 'Invalid id');

export const NodePatchSchema = z
  .object({
    title: z.string().max(500),
    notes: z.string().max(20_000),
    shape: ShapeSchema,
    color: ColorSchema.nullable(),
    childLayout: ChildLayoutSchema,
    collapsed: z.boolean(),
    done: z.boolean(),
    startDate: isoDate.nullable(),
    dueDate: isoDate.nullable(),
    tags: z.array(z.string().min(1).max(40)).max(20),
    meta: z.record(z.string().max(60), z.string().max(500)),
    parentId: NodeIdSchema.describe('Move the node (and its sub-tree) under another node'),
    sort: z.number().finite().describe('Order among siblings; lower comes first'),
  })
  .partial();

export const NodeCreateSchema = NodePatchSchema.extend({
  id: NodeIdSchema.optional().describe('Optional client-chosen id, so later ops in the same batch can reference it'),
  parentId: NodeIdSchema,
  title: z.string().max(500).default(''),
});

export const OpSchema = z.discriminatedUnion('op', [
  z.object({ op: z.literal('create'), node: NodeCreateSchema }),
  z.object({ op: z.literal('update'), id: NodeIdSchema, patch: NodePatchSchema }),
  z.object({ op: z.literal('delete'), id: NodeIdSchema }),
]);

export const OpsBodySchema = z.object({
  ops: z.array(OpSchema).min(1).max(500),
  clientId: z.string().max(64).optional(),
  baseVersion: z.number().int().optional().describe('Reserved; changes are merged field-by-field, last write wins'),
});

export const SettingsSchema = z
  .object({
    maxDepth: z.number().int().min(1).max(LIMITS.maxDepth),
    maxChildren: z.number().int().min(1).max(LIMITS.maxChildren),
    warnDays: z.number().int().min(0).max(LIMITS.warnDays),
  })
  .partial();

export const ProjectCreateSchema = z.object({
  name: z.string().min(1).max(120),
  icon: z.string().max(16).default('🌊'),
  color: ColorSchema.default('blue'),
  description: z.string().max(2000).default(''),
  settings: SettingsSchema.default({}),
});

export const ProjectPatchSchema = z
  .object({
    name: z.string().min(1).max(120),
    icon: z.string().max(16),
    color: ColorSchema,
    description: z.string().max(2000),
    settings: SettingsSchema,
    archived: z.boolean(),
  })
  .partial();

export const TokenCreateSchema = z.object({
  name: z.string().min(1).max(80),
  canWrite: z.boolean().default(false),
  projectIds: z.array(z.string()).min(1).nullable().default(null),
  expiresAt: z.iso.datetime().nullable().default(null),
});

export const TokenPatchSchema = TokenCreateSchema.partial();

export const PreferencesSchema = z
  .object({
    theme: z.enum(['system', 'light', 'dark']),
    accent: z.enum(Object.keys(ACCENTS) as [AccentName, ...AccentName[]]),
    background: z.enum(['dots', 'grid', 'plain']),
    gridSize: z.number().int().min(12).max(64),
    snapZoom: z.boolean(),
    lockCanvas: z.boolean(),
    doneStyle: z.enum(['fade', 'faint', 'solid']),
    celebrate: z.boolean(),
    motion: z.boolean(),
  })
  .partial()
  .strict();
