/**
 * Opens the guide with its open page kept in the hash. A sidebar click
 * replaces the hash rather than pushing, so Back still closes the guide; a
 * navigation that names another page (a hand-edited hash) switches to it.
 *
 * The app's modal union must have a `{ type: 'help'; page?: string }` member.
 */

import { showHelpModal } from './help-modal';
import type {
  AnyPageState,
  NavigationEvent,
  PageStateManager,
} from './page-state-manager';

interface HelpModalState {
  type: 'help';
  page?: string;
}

function helpModal(state: AnyPageState): HelpModalState | null {
  return state.modal?.type === 'help' ? (state.modal as HelpModalState) : null;
}

export async function showRoutedHelpModal<S extends AnyPageState, C>(
  pages: PageStateManager<S, C>,
  page: string | undefined
): Promise<void> {
  const selectRef = { select: async (_page?: string): Promise<void> => {} };
  const onNavigate = (event: NavigationEvent<S>) => {
    const modal = helpModal(event.to);
    if (modal) {
      void selectRef.select(modal.page);
    }
  };
  pages.addNavigationHandler(onNavigate);

  try {
    await showHelpModal(page, {
      onSelect: (id) => {
        console.log(`[RoutedHelp] switching to ${id}`);
        pages.rewrite((state) =>
          helpModal(state)
            ? ({ ...state, modal: { type: 'help', page: id } } as S)
            : null
        );
        void selectRef.select(id);
      },
      selectRef,
    });
  } finally {
    pages.removeNavigationHandler(onNavigate);
  }
}
