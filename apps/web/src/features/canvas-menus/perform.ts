import type { CommandId, NodeId } from '@greenfield/bridge';
import type { EditorStore } from '@greenfield/editor-state';
import type { MenuAction } from './actions';
import { toPage } from './geometry';

/**
 * Do a menu or toolbar item. A command goes to the editor; "Comment or ask" opens the composer
 * the way the canvas's comment tool does (`ui.request comment.new`, Story 6.2) at `screen` (canvas
 * pixels), with the target layers and whether it starts as a question for Claude.
 */
export function perform(
  store: EditorStore,
  action: MenuAction,
  target: { ids: readonly NodeId[]; screen: { x: number; y: number } | null },
): Promise<unknown> {
  if (action.kind === 'command')
    return store.run(action.command as CommandId, action.params as never);
  const viewport = store.getState().viewport;
  const page = target.screen && viewport ? toPage(target.screen, viewport) : null;
  store.dispatch({
    type: 'ui.request',
    kind: 'comment.new',
    screen: target.screen,
    data: { ...page, ids: [...target.ids], ask: action.ask },
  });
  return Promise.resolve();
}
