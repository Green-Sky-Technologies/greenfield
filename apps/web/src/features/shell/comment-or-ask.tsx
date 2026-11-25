'use client';

/**
 * "Comment or ask" from the top bar or C (Stories 5.1, 5.4, 6.2): the comment composer on the
 * selection, beside its first layer, pinned at that layer's top-right corner. With nothing
 * selected it sits under the top bar and pins to the middle of the view.
 */
import { useNode, useSelection, useViewport } from '@greenfield/editor-state/react';
import {
  layersName,
  canvasFrame,
  ComposerCard,
  placeBeside,
  type CommentTarget,
} from '@/features/comments/composer';

interface Props {
  canComment: boolean;
  onClose: () => void;
}

interface Bounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export function CommentOrAsk({ canComment, onClose }: Props) {
  const selection = useSelection();
  const node = useNode(selection[0]);
  const viewport = useViewport();
  const frame = canvasFrame()?.getBoundingClientRect();
  const bounds = node?.absoluteBounds as Bounds | undefined;

  let target: CommentTarget | null = null;
  let at: { left: number; top: number } | undefined;
  if (node && bounds) {
    target = {
      x: bounds.x + bounds.width,
      y: bounds.y,
      nodeIds: selection,
      name: layersName(node.name ?? null, selection.length),
    };
    if (viewport && frame) {
      const screen = {
        x: (target.x - viewport.x) * viewport.zoom,
        y: (target.y - viewport.y) * viewport.zoom,
      };
      at = placeBeside(screen, frame, { width: window.innerWidth, height: window.innerHeight });
    }
  } else if (viewport && frame) {
    target = {
      x: viewport.x + frame.width / 2 / viewport.zoom,
      y: viewport.y + frame.height / 2 / viewport.zoom,
      nodeIds: [],
      name: null,
    };
  }

  return <ComposerCard target={target} at={at} canComment={canComment} onClose={onClose} />;
}
