/**
 * A color input: a hex text box with a swatch that opens our own palette.
 *
 * The native `<input type="color">` is the obvious control and it is the wrong
 * one here. It has no empty state, so a field with no color shows as black and
 * closing the editor writes `000000`; it hands the value to the OS dialog,
 * which on Chrome needs a second click to land and on Firefox never lands at
 * all when the anchor commits on blur; and it streams `input` events while the
 * dialog is open, so dragging in it records a patch per pixel.
 *
 * So the box stays a text box. The anchor `<input>` holds and shows the stored
 * string verbatim, which keeps it typeable and keeps whatever already reads
 * `input.value` working, and the swatch popover is an additional way to fill it
 * in. Same division of labour as `calendar-input.ts`, for the same reasons.
 *
 * It takes focus from nobody. Every mousedown inside the popover is prevented,
 * so an anchor that commits on blur does not commit out from under a click on a
 * swatch. `Custom...` still reaches the OS picker through a hidden native
 * input, and commits on `change` only.
 *
 * Every string it renders is a constant or a hex triple that `normalizeHex` has
 * already validated, so it needs no escaping helper to be safe.
 */

import { moduleState } from '../util/module-state';

/**
 * How the caller's stored color strings become `#rrggbb`, and back.
 *
 * GTFS stores `rrggbb` with no hash, CSS wants the hash, and a field could
 * store either, so the conversion is the caller's to declare.
 */
export interface ColorCodec {
  /** The stored string as `#rrggbb`, or null when it is not a color. */
  parse: (value: string) => string | null;
  /** `#rrggbb` as the stored string. */
  format: (hex: string) => string;
}

/**
 * `#rrggbb`, or null. Accepts a missing hash and the three-digit short form,
 * both of which people type, and lowercases the result so two spellings of one
 * color compare equal.
 */
export function normalizeHex(value: string): string | null {
  const raw = String(value ?? '')
    .trim()
    .replace(/^#/, '');
  if (/^[0-9a-f]{6}$/i.test(raw)) {
    return `#${raw.toLowerCase()}`;
  }
  if (/^[0-9a-f]{3}$/i.test(raw)) {
    const [r, g, b] = raw.toLowerCase();
    return `#${r}${r}${g}${g}${b}${b}`;
  }
  return null;
}

/** `#rrggbb`, which is what CSS and a native color input speak. */
export const HEX_COLOR_CODEC: ColorCodec = {
  parse: (value) => normalizeHex(value),
  format: (hex) => hex.toLowerCase(),
};

/** `rrggbb`, which is what GTFS stores. Uppercase, as the reference writes it. */
export const BARE_HEX_CODEC: ColorCodec = {
  parse: (value) => normalizeHex(value),
  format: (hex) => hex.replace(/^#/, '').toUpperCase(),
};

/**
 * The swatches offered when the caller names no palette.
 *
 * Twelve hues at two lightnesses plus black and white: enough that most route
 * colors are one click away, small enough to stay a glance rather than a
 * search. `Custom...` covers the rest.
 */
export const DEFAULT_PALETTE: string[] = [
  '#e53935',
  '#d81b60',
  '#8e24aa',
  '#5e35b1',
  '#3949ab',
  '#1e88e5',
  '#039be5',
  '#00897b',
  '#43a047',
  '#7cb342',
  '#fb8c00',
  '#6d4c41',
  '#ff8a80',
  '#f48fb1',
  '#ce93d8',
  '#b39ddb',
  '#9fa8da',
  '#90caf9',
  '#81d4fa',
  '#80cbc4',
  '#a5d6a7',
  '#c5e1a5',
  '#ffcc80',
  '#bcaaa4',
  '#000000',
  '#424242',
  '#757575',
  '#bdbdbd',
  '#e0e0e0',
  '#ffffff',
];

export interface ColorInputOptions {
  /** How to read and write the stored value. Required: there is no default. */
  codec: ColorCodec;
  /** Swatch grid. Defaults to `DEFAULT_PALETTE`. */
  palette?: string[];
  /** Offer a Clear row, for a field that is allowed to be empty. */
  allowEmpty?: boolean;
  /** A color was picked. Given the stored string, or '' from Clear. */
  onPick: (value: string) => void;
  /** The popover went away, for any reason, including a pick. */
  onClose?: () => void;
}

/** Class on the popover, for anyone styling or querying it. */
const POPOVER_CLASS = 'color-input-popover';

/** Diagonal hatching, painted on the swatch when the value is not a color. */
const NO_COLOR_FILL =
  'repeating-linear-gradient(45deg, transparent, transparent 3px, ' +
  'currentColor 3px, currentColor 4px)';

const shared = moduleState('ui/color-input', () => ({
  /**
   * The open popover's closer. Held here rather than found by class, so a
   * second open tears the first one's document listeners down with its DOM.
   */
  activeClose: null as (() => void) | null,
}));

/** Paint an element with a color, or with the hatching when there is none. */
function paint(element: HTMLElement, hex: string | null): void {
  element.style.background = hex ?? NO_COLOR_FILL;
  element.style.backgroundColor = hex ?? '';
}

function renderPopover(palette: string[], allowEmpty: boolean): string {
  const swatches = palette
    .map((hex) => {
      const value = normalizeHex(hex);
      if (!value) {
        return '';
      }
      return `<button type="button" class="w-6 h-6 rounded border border-base-300 hover:ring-2 hover:ring-primary" style="background:${value}" data-color="${value}" title="${value}" aria-label="${value}"></button>`;
    })
    .join('');

  const clearRow = allowEmpty
    ? '<button type="button" class="btn btn-xs btn-ghost w-full justify-start" data-nav="clear">Clear</button>'
    : '';

  return `
    <div class="grid grid-cols-6 gap-1">${swatches}</div>
    <div class="flex flex-col pt-1">
      <button type="button" class="btn btn-xs btn-ghost w-full justify-start" data-nav="custom">Custom&hellip;</button>
      ${clearRow}
    </div>
  `;
}

export interface OpenColorPickerOptions extends ColorInputOptions {
  /** The currently stored value. Its swatch opens marked as the current one. */
  value: string;
  /** Opens the OS picker on this element's behalf. */
  nativeInput: HTMLInputElement;
}

/**
 * Open the palette anchored to an element, and return a function that closes
 * it. Any popover already open is closed first.
 */
export function openColorPicker(
  anchor: HTMLElement,
  options: OpenColorPickerOptions
): () => void {
  shared.activeClose?.();

  const palette = options.palette ?? DEFAULT_PALETTE;
  const current = options.codec.parse(options.value);

  const popover = document.createElement('div');
  // Above the modal layer: this is a body child, so a z-index below a modal's
  // would hide it behind the modal whose form opened it.
  popover.className = `${POPOVER_CLASS} fixed z-[2000] w-56 p-2 bg-base-100 border border-base-300 rounded-lg shadow-lg`;
  popover.innerHTML = renderPopover(palette, options.allowEmpty === true);
  document.body.appendChild(popover);

  const currentSwatch = current
    ? popover.querySelector<HTMLElement>(`[data-color="${current}"]`)
    : null;
  currentSwatch?.classList.add('ring-2', 'ring-primary');

  // Below the anchor, or above it when there is no room. Viewport coordinates,
  // since the popover is positioned `fixed`.
  const anchorRect = anchor.getBoundingClientRect();
  const height = popover.getBoundingClientRect().height;
  const below = anchorRect.bottom + 2;
  popover.style.top = `${
    below + height > window.innerHeight && anchorRect.top - height - 2 > 0
      ? anchorRect.top - height - 2
      : below
  }px`;
  popover.style.left = `${Math.max(
    4,
    Math.min(anchorRect.left, window.innerWidth - popover.offsetWidth - 4)
  )}px`;

  let closed = false;
  const close = (): void => {
    if (closed) {
      return;
    }
    closed = true;
    if (shared.activeClose === close) {
      shared.activeClose = null;
    }
    popover.remove();
    document.removeEventListener('mousedown', onOutside, true);
    document.removeEventListener('keydown', onKeydown, true);
    document.removeEventListener('scroll', close, true);
    options.nativeInput.removeEventListener('change', onNativeChange);
    options.onClose?.();
  };

  const onOutside = (e: MouseEvent): void => {
    const target = e.target as Node;
    if (!popover.contains(target) && !anchor.contains(target)) {
      close();
    }
  };
  const onKeydown = (e: KeyboardEvent): void => {
    if (e.key === 'Escape') {
      // Closes the popover only. Escape belongs to the innermost thing it can
      // dismiss, and inside a modal the same key closes the modal.
      e.preventDefault();
      e.stopPropagation();
      close();
    }
  };
  // `change` only, never `input`: Firefox streams `input` while the OS dialog
  // is open, so dragging in it would record one edit per pixel.
  const onNativeChange = (): void => {
    const hex = normalizeHex(options.nativeInput.value);
    if (!hex) {
      return;
    }
    close();
    options.onPick(options.codec.format(hex));
  };
  options.nativeInput.addEventListener('change', onNativeChange);

  // Keeps the anchor focused, so a click on a swatch is not swallowed by the
  // anchor's blur handler committing the edit first.
  popover.addEventListener('mousedown', (e) => e.preventDefault());

  popover.addEventListener('click', (e) => {
    const button = (e.target as Element).closest(
      'button'
    ) as HTMLButtonElement | null;
    if (!button) {
      return;
    }

    const nav = button.dataset.nav;
    if (nav === 'clear') {
      close();
      options.onPick('');
      return;
    }
    if (nav === 'custom') {
      // The popover stays up behind the OS dialog: closing it here would take
      // the `change` listener with it, and cancelling the dialog would then
      // leave nothing to come back to.
      options.nativeInput.value = current ?? '#000000';
      options.nativeInput.click();
      return;
    }

    const hex = button.dataset.color;
    if (!hex) {
      return;
    }
    close();
    options.onPick(options.codec.format(hex));
  });

  shared.activeClose = close;
  document.addEventListener('mousedown', onOutside, true);
  document.addEventListener('keydown', onKeydown, true);
  // A scrolling ancestor would leave the popover behind, anchored to nothing.
  // A frame late, because focusing the anchor can scroll it into view and that
  // scroll must not close the popover the same focus just opened.
  requestAnimationFrame(() => {
    if (!closed) {
      document.addEventListener('scroll', close, true);
    }
  });

  return close;
}

/**
 * Wire an `<input>` as a hex box with a swatch button on its right.
 *
 * The swatch paints whatever is in the box as the user types, and opens the
 * palette. The input keeps its own type, classes and value; it is wrapped in a
 * positioned container so the swatch can sit inside it.
 *
 * Returns a teardown that closes the popover and unwraps the input, for an
 * owner that re-renders around it.
 */
export function attachColorInput(
  input: HTMLInputElement,
  options: ColorInputOptions
): () => void {
  const parent = input.parentElement;
  const wrapper = document.createElement('div');
  wrapper.className = 'relative flex items-center w-full';
  parent?.insertBefore(wrapper, input);
  wrapper.appendChild(input);

  const previousPadding = input.style.paddingRight;
  input.style.paddingRight = '1.75rem';

  const swatch = document.createElement('button');
  swatch.type = 'button';
  swatch.className =
    'absolute right-1 w-5 h-5 rounded border border-base-300 text-base-content/40';
  swatch.setAttribute('aria-label', 'Pick a color');
  wrapper.appendChild(swatch);

  // Off-screen rather than `display:none`: Firefox will not open the OS dialog
  // for an input that is not rendered.
  const nativeInput = document.createElement('input');
  nativeInput.type = 'color';
  nativeInput.className = 'sr-only absolute';
  nativeInput.tabIndex = -1;
  wrapper.appendChild(nativeInput);

  const repaint = (): void => paint(swatch, options.codec.parse(input.value));
  repaint();

  let close: (() => void) | null = null;

  const open = (): void => {
    if (close) {
      close();
      return;
    }
    close = openColorPicker(swatch, {
      ...options,
      value: input.value,
      nativeInput,
      onPick: (value) => {
        input.value = value;
        repaint();
        options.onPick(value);
      },
      onClose: () => {
        close = null;
        options.onClose?.();
      },
    });
  };

  // Prevented so the anchor keeps focus, for the same reason the popover's own
  // mousedowns are: the inline editor commits on blur.
  const onSwatchMousedown = (e: MouseEvent): void => e.preventDefault();

  input.addEventListener('input', repaint);
  swatch.addEventListener('mousedown', onSwatchMousedown);
  swatch.addEventListener('click', open);

  return () => {
    close?.();
    input.removeEventListener('input', repaint);
    swatch.removeEventListener('mousedown', onSwatchMousedown);
    swatch.removeEventListener('click', open);
    input.style.paddingRight = previousPadding;
    wrapper.parentElement?.insertBefore(input, wrapper);
    wrapper.remove();
  };
}
