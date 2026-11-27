/**
 * The gtfs.zone tools, read from `src/tools.json` and checked with Zod at
 * load. The JSON is the one list of hosts and URLs: the tool switcher in
 * `app-shell.ts` and the links in `about-links.ts` both read it here.
 */

import { z } from 'zod';
import toolsJson from '../tools.json';
import { t } from '../i18n/messages';

const TOOL_IDS = [
  'home',
  'edit',
  'viz-rt',
  'diff',
  'sites',
  'accuracy-rt',
  'manage-rt',
] as const;

export type ToolId = (typeof TOOL_IDS)[number];

const toolSchema = z.object({
  id: z.enum(TOOL_IDS),
  host: z.string().min(1),
  url: z.url(),
});

export type Tool = z.infer<typeof toolSchema>;

/** Every tool, in menu order. Throws at load if the JSON drifts. */
export const TOOLS: readonly Tool[] = z
  .array(toolSchema)
  .refine(
    (tools) => new Set(tools.map((tool) => tool.id)).size === tools.length,
    {
      message: 'duplicate tool id',
    }
  )
  .parse(toolsJson);

/** The tool with `id`. */
export function getTool(id: ToolId): Tool {
  const tool = TOOLS.find((entry) => entry.id === id);
  if (!tool) {
    throw new Error(`[tools] no tool with id ${id}`);
  }
  return tool;
}

/** The tool served at `host`, if any. */
export function findToolByHost(host: string): Tool | undefined {
  return TOOLS.find((tool) => tool.host === host);
}

/** One line saying what the tool does, in the active locale. */
export function toolDescription(id: ToolId): string {
  switch (id) {
    case 'home':
      return t('tool.home');
    case 'edit':
      return t('tool.edit');
    case 'viz-rt':
      return t('tool.vizRt');
    case 'diff':
      return t('tool.diff');
    case 'sites':
      return t('tool.sites');
    case 'accuracy-rt':
      return t('tool.accuracyRt');
    case 'manage-rt':
      return t('tool.manageRt');
  }
}
