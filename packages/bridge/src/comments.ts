/**
 * Comment threads in the open document (Story 6.1): typed helpers over the editor's `comment.*`
 * commands. Comments live in the `.figcraft` file (D23); the server mirrors them from the saved
 * file with `readFileComments` (`@greenfield/bridge/file`).
 *
 * A thread pinned to a layer (`anchor`) stores its position relative to that layer, so it follows
 * the layer when it moves. Thread ids are per document and reused after a delete.
 *
 * The editor acts as the `author` the bridge was created with unless a call passes another one,
 * and only a message's author may edit or delete it.
 */
import type { Editor, NodeId } from './types';

export interface CommentMention {
  name: string;
  /** Someone who wrote or reacted in a comment. */
  known: boolean;
  you: boolean;
}

export interface CommentReaction {
  emoji: string;
  users: string[];
}

/** One message, as `comment.list` reports it. Times are Unix seconds; `edited` 0 = never. */
export interface CommentMessage {
  author: string;
  text: string;
  created: number;
  edited: number;
  agent: boolean;
  mentions: CommentMention[];
  reactions: CommentReaction[];
}

/** A thread, as `comment.list` reports it: the first message plus its replies. */
export interface CommentThread extends CommentMessage {
  id: number;
  /** `figcraft://comment/<id>` */
  link: string;
  page: NodeId;
  pageName: string;
  /** The layer the pin follows, or null when it's pinned to the page. */
  anchor: NodeId | null;
  /** The top-level frame the pin is in. */
  frame: NodeId | null;
  frameName: string | null;
  /** Where the pin is now, in page coordinates. */
  x: number;
  y: number;
  resolved: boolean;
  unread: boolean;
  replies: CommentMessage[];
}

export interface AddCommentInput {
  /** Page coordinates of the pin. */
  x: number;
  y: number;
  text: string;
  /** The layer to pin to; omit to pin to the page. */
  anchor?: NodeId;
  page?: NodeId;
  author?: string;
}

export interface ListCommentsOptions {
  /** Default every page. */
  page?: NodeId | 'all';
  filter?: 'all' | 'open' | 'resolved' | 'mine' | 'unread';
  author?: string;
}

export async function addComment(
  editor: Editor,
  input: AddCommentInput,
): Promise<{ id: number; link: string }> {
  return (await editor.execute('comment.add', { ...input })) as { id: number; link: string };
}

/** Returns the reply's index in the thread. */
export async function replyToComment(
  editor: Editor,
  id: number,
  text: string,
  opts: { author?: string } = {},
): Promise<{ reply: number }> {
  return (await editor.execute('comment.reply', { id, text, ...opts })) as { reply: number };
}

export async function resolveComment(editor: Editor, id: number, resolved = true): Promise<void> {
  await editor.execute('comment.resolve', { id, resolved });
}

/** Delete the thread, or one reply (`reply`: its index). Only its author may. */
export async function deleteComment(
  editor: Editor,
  id: number,
  opts: { reply?: number; author?: string } = {},
): Promise<void> {
  await editor.execute('comment.delete', { id, ...opts });
}

export async function listComments(
  editor: Editor,
  opts: ListCommentsOptions = {},
): Promise<CommentThread[]> {
  const r = (await editor.execute('comment.list', { page: 'all', ...opts })) as {
    comments: CommentThread[];
  };
  return r.comments;
}
