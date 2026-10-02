/**
 * Page-state schema: an app's page-state union described as data, from which
 * the hash codec and the runtime guard `PageStateManager` needs are built.
 *
 * A state is a page location plus an optional modal over it. Each page variant
 * other than `home`, and each modal, maps its keys to hash params. Every value
 * is a string; a key whose type admits `undefined` must be marked optional.
 *
 * Hash layout: the page's params, then `modal=<type>` and the modal's params.
 * With `typeParam` set, the page type is written explicitly; without it, the
 * page is told apart by which params are present, in `pages` order.
 */

import type { PageStateCodec } from './page-state-manager';

type Variant<U, T> = Extract<U, { type: T }>;

type FieldKey<V> = Exclude<keyof V, 'type' | 'modal'>;

/** A required key maps to its param; an optional one says so. */
type FieldSpec<V, K extends keyof V> = undefined extends V[K]
  ? { param: string; optional: true }
  : string;

type VariantSpecs<U extends { type: string }, T extends string> = {
  [P in T]: {
    [K in FieldKey<Variant<U, P>>]-?: FieldSpec<Variant<U, P>, K>;
  };
};

/** Distributed so that narrowing on `type` still works through the modal field. */
export type WithModal<L, M> = L extends unknown ? L & { modal?: M } : never;

export interface PageStateSchema<
  L extends { type: string },
  M extends { type: string },
> {
  /** Every page but `home`, which names no object and is the fallback. */
  pages: VariantSpecs<L, Exclude<L['type'], 'home'>>;
  /** Every modal that lives in the hash. */
  modals: VariantSpecs<M, M['type']>;
  /** Param naming the page type; omitted, the page is sniffed. */
  typeParam?: string;
}

type RuntimeField = string | { param: string; optional: true };
type RuntimeSpecs = Record<string, Record<string, RuntimeField>>;

const MODAL_PARAM = 'modal';

function paramOf(field: RuntimeField): string {
  return typeof field === 'string' ? field : field.param;
}

function isOptional(field: RuntimeField): boolean {
  return typeof field !== 'string';
}

function writeFields(
  params: URLSearchParams,
  fields: Record<string, RuntimeField>,
  value: Record<string, unknown>
): void {
  for (const [key, field] of Object.entries(fields)) {
    const v = value[key];
    if (typeof v === 'string') {
      params.set(paramOf(field), v);
    }
  }
}

/** The variant's keys read from the hash, or null when a required one is missing. */
function readFields(
  params: URLSearchParams,
  fields: Record<string, RuntimeField>
): Record<string, string> | null {
  const out: Record<string, string> = {};
  for (const [key, field] of Object.entries(fields)) {
    const v = params.get(paramOf(field));
    if (v !== null) {
      out[key] = v;
    } else if (!isOptional(field)) {
      return null;
    }
  }
  return out;
}

/** Each spec'd key is a string (or absent, when optional) and nothing else is set. */
function fieldsValid(
  value: Record<string, unknown>,
  fields: Record<string, RuntimeField>,
  allowed: readonly string[]
): boolean {
  for (const [key, field] of Object.entries(fields)) {
    const v = value[key];
    if (!(typeof v === 'string' || (v === undefined && isOptional(field)))) {
      return false;
    }
  }
  return Object.keys(value).every((k) => k in fields || allowed.includes(k));
}

export function createPageStateCodec<
  L extends { type: string },
  M extends { type: string },
>(schema: PageStateSchema<L, M>): PageStateCodec<WithModal<L, M>> {
  type S = WithModal<L, M>;
  const pages = schema.pages as unknown as RuntimeSpecs;
  const modals = schema.modals as unknown as RuntimeSpecs;
  const { typeParam } = schema;

  const isModalState = (value: unknown): boolean => {
    if (!value || typeof value !== 'object') {
      return false;
    }
    const modal = value as Record<string, unknown>;
    const fields =
      typeof modal.type === 'string' && Object.hasOwn(modals, modal.type)
        ? modals[modal.type]
        : null;
    return fields !== null && fieldsValid(modal, fields, ['type']);
  };

  /** An unknown modal name is dropped rather than throwing: the hash is user-editable. */
  const readModal = (
    params: URLSearchParams
  ): Record<string, string> | null => {
    const type = params.get(MODAL_PARAM);
    if (type === null) {
      return null;
    }
    if (!Object.hasOwn(modals, type)) {
      console.warn(`[PageStateManager] unknown modal in hash: ${type}`);
      return null;
    }
    const fields = readFields(params, modals[type]);
    return fields && { type, ...fields };
  };

  const readPage = (params: URLSearchParams): Record<string, string> => {
    if (typeParam !== undefined) {
      const type = params.get(typeParam);
      const fields =
        type !== null && Object.hasOwn(pages, type)
          ? readFields(params, pages[type])
          : null;
      return fields ? { type: type!, ...fields } : { type: 'home' };
    }
    for (const [type, spec] of Object.entries(pages)) {
      const fields = readFields(params, spec);
      if (fields && Object.keys(fields).length > 0) {
        return { type, ...fields };
      }
    }
    return { type: 'home' };
  };

  return {
    isPageState(value: unknown): value is S {
      if (!value || typeof value !== 'object') {
        return false;
      }
      const state = value as Record<string, unknown>;
      if (state.modal !== undefined && !isModalState(state.modal)) {
        return false;
      }
      if (state.type === 'home') {
        return fieldsValid(state, {}, ['type', 'modal']);
      }
      return (
        typeof state.type === 'string' &&
        Object.hasOwn(pages, state.type) &&
        fieldsValid(state, pages[state.type], ['type', 'modal'])
      );
    },

    toParams(state) {
      const params = new URLSearchParams();
      const page = state as Record<string, unknown> & { type: string };
      if (page.type !== 'home') {
        if (typeParam !== undefined) {
          params.set(typeParam, page.type);
        }
        writeFields(params, pages[page.type], page);
      }

      // The modal rides on top of whatever page is beneath it, home included.
      const modal = state.modal as
        (Record<string, unknown> & { type: string }) | undefined;
      if (modal) {
        params.set(MODAL_PARAM, modal.type);
        writeFields(params, modals[modal.type], modal);
      }
      return params;
    },

    /**
     * A variant missing a required param, or an unknown type, falls back to
     * home. The modal is carried onto whichever page results: it names no
     * object, so nothing the page half fails to resolve can invalidate it.
     */
    fromParams(params) {
      const page = readPage(params);
      const modal = readModal(params);
      return (modal ? { ...page, modal } : page) as unknown as S;
    },
  };
}
