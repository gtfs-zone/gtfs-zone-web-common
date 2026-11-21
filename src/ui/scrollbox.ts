/**
 * A list capped in height that scrolls on its own, for a page holding several
 * lists. One `.scroll-rows` region would take all the height left over, so a
 * page with more than one list caps each with this instead.
 */
export function renderScrollbox(body: string): string {
  return `<div class="max-h-96 overflow-y-auto overflow-x-hidden px-2">${body}</div>`;
}
