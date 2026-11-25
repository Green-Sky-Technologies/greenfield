// @vitest-environment happy-dom
/**
 * The shell against the in-memory editor (`MockEditor`): top bar controls and their labels, and
 * the key and focus rules between the shell and the editor's iframe. The real editor is covered
 * by e2e/editor/shell.spec.ts.
 */
import { platformFromUserAgent, saveChord, type Editor } from '@greenfield/bridge';
import { MockEditor } from '@greenfield/bridge/mock';
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { EditorHandle } from '@/features/editor/editor-embed';

const embed = vi.hoisted(() => ({ handle: null as EditorHandle | null }));

vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

// The real embed loads FigCraft; here the shell gets a MockEditor and a stand-in for the iframe
// whose window is a separate happy-dom window (happy-dom doesn't load iframe pages).
vi.mock('@/features/editor/editor-embed', async () => {
  const { useEffect, useRef } = await import('react');
  const { Window } = await import('happy-dom');
  return {
    EditorEmbed: ({ onEditor }: { onEditor: (h: EditorHandle | null) => void }) => {
      const ref = useRef<HTMLDivElement>(null);
      useEffect(() => {
        const iframe = ref.current as unknown as HTMLIFrameElement; // focusable stand-in
        const inner = new Window();
        Object.defineProperty(iframe, 'contentWindow', { value: inner });
        Object.defineProperty(iframe, 'contentDocument', { value: inner.document });
        const handle = { editor: embed.handle!.editor, iframe };
        embed.handle = handle;
        onEditor(handle);
        return () => onEditor(null);
      }, [onEditor]);
      return <div ref={ref} tabIndex={-1} title="Design canvas" />;
    },
  };
});

const { ProjectShell } = await import('./project-shell');

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
let host: HTMLDivElement;
let editor: MockEditor;
let executed: string[];

async function mount(props: { canShare?: boolean } = {}) {
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  await act(async () => {
    root.render(
      <ProjectShell
        slug="acme"
        project={{ id: 'p1', name: 'Landing page', archived: false }}
        fileName="Landing page.figcraft"
        people={[
          { userId: 'u2', name: 'Grace Hopper', imageUrl: null },
          { userId: 'u1', name: 'Ada Lovelace', imageUrl: null },
        ]}
        meId="u1"
        canShare={props.canShare ?? true}
        canExport={false}
        canRunAgent={false}
        canComment
        author="Ada Lovelace"
        canEdit
        webgl={false}
      />,
    );
  });
  await act(async () => {}); // the first view.get
}

const $ = <T extends Element = HTMLElement>(sel: string) => document.querySelector<T>(sel);
const byName = (name: string) =>
  [...document.querySelectorAll<HTMLElement>('button, a')].find(
    (el) => (el.getAttribute('aria-label') ?? el.textContent?.trim()) === name,
  );
const composer = () => $('[role="dialog"][aria-label="Comment or ask"]');

async function press(target: EventTarget, init: KeyboardEventInit) {
  const view = ((target as Node).ownerDocument?.defaultView ?? target) as typeof window;
  const e = new view.KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init });
  await act(async () => {
    target.dispatchEvent(e);
  });
  return e;
}

beforeEach(() => {
  editor = new MockEditor();
  executed = [];
  const execute = editor.execute.bind(editor);
  vi.spyOn(editor, 'execute').mockImplementation(((command: string, params?: unknown) => {
    executed.push(command);
    if (command === 'view.get') return Promise.resolve({ zoom: 1.5 });
    if (command.startsWith('view.')) return Promise.resolve(null);
    return execute(command as never, params as never);
  }) as Editor['execute']);
  embed.handle = { editor, iframe: null! };
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.restoreAllMocks();
});

describe('top bar', () => {
  it('shows the project, file, people, zoom and Share, every control labelled', async () => {
    await mount();
    const bar = $('header[aria-label="Project"]')!;
    expect(bar.textContent).toContain('Landing page');
    expect(bar.textContent).toContain('Landing page.figcraft');
    expect($('[aria-label^="People with access"]')!.getAttribute('aria-label')).toBe(
      'People with access: You, Grace Hopper',
    );
    expect(byName('Zoom level 150%, zoom options')).toBeTruthy();
    for (const el of bar.querySelectorAll<HTMLElement>('button, a, input, [role="group"]')) {
      const name = el.getAttribute('aria-label') ?? el.textContent?.trim();
      expect(name, el.outerHTML).toBeTruthy();
    }
  });

  it('zooms through the bridge', async () => {
    await mount();
    await act(async () => byName('Zoom in')!.click());
    await act(async () => byName('Zoom out')!.click());
    await act(async () => byName('Zoom level 150%, zoom options')!.click());
    await act(async () => byName('Zoom to fit')!.click());
    expect(executed).toEqual(
      expect.arrayContaining(['view.zoomIn', 'view.zoomOut', 'view.zoomFit']),
    );
  });

  it('offers share links only to roles that may create them', async () => {
    await mount({ canShare: false });
    await act(async () => byName('Share')!.click());
    expect($('[role="dialog"][aria-label="Share"]')!.textContent).toContain(
      'Only editors and admins can create share links.',
    );
    expect(byName('Create share link')).toBeUndefined();
    expect(byName('Copy project link')).toBeTruthy();
  });
});

describe('keys and focus', () => {
  it('C opens "Comment or ask" with focus in it; typing C there is text', async () => {
    await mount();
    await press(document.body, { key: 'c' });
    expect(composer()).toBeTruthy();
    const text = $<HTMLTextAreaElement>('#comment-or-ask')!;
    expect(document.activeElement).toBe(text);
    const e = await press(text, { key: 'c' });
    expect(e.defaultPrevented).toBe(false);
    expect(composer()).toBeTruthy();
  });

  it('Esc closes it and gives the canvas focus', async () => {
    await mount();
    await press(document.body, { key: 'c' });
    await press($('#comment-or-ask')!, { key: 'Escape' });
    expect(composer()).toBeNull();
    expect(document.activeElement).toBe(embed.handle!.iframe);
  });

  it('takes C from the canvas before the editor sees it, and leaves other keys to it', async () => {
    await mount();
    const win = embed.handle!.iframe.contentWindow!;
    const seen: string[] = [];
    win.document.addEventListener('keydown', (e) => seen.push(e.key));
    const c = await press(win.document.body, { key: 'c' });
    expect(c.defaultPrevented).toBe(true);
    expect(composer()).toBeTruthy();
    await press(win.document.body, { key: 'Escape' });
    await press(win.document.body, { key: 'r' });
    expect(seen).toEqual(['Escape', 'r']);
    expect(composer()).toBeTruthy(); // Esc on the canvas is the editor's, not the shell's
  });

  it('F6 and Shift+F6 cycle the top bar, left panel, canvas and edit panel', async () => {
    await mount();
    const { iframe } = embed.handle!;
    const where = () => {
      const a = document.activeElement as HTMLElement;
      if (a === iframe) return 'canvas';
      return `${a.closest('[aria-label]:is(header, aside)')?.getAttribute('aria-label')}: ${a.textContent}`;
    };
    const seen: string[] = [];
    await act(async () => iframe.focus()); // a key in the editor means its iframe has focus
    await press(iframe.contentWindow!.document.body, { key: 'F6' });
    for (let i = 0; i < 4; i++) {
      seen.push(where());
      await press(
        document.activeElement === iframe
          ? iframe.contentWindow!.document.body
          : document.activeElement!,
        { key: 'F6' },
      );
    }
    expect(seen).toEqual([
      'Edit panel: Design',
      'Project: All projects',
      'Left panel: Layers',
      'canvas',
    ]);
    expect(where()).toBe('Edit panel: Design'); // round again
    await press(document.activeElement!, { key: 'F6', shiftKey: true });
    expect(where()).toBe('canvas');
    await press(iframe.contentWindow!.document.body, { key: 'F6', shiftKey: true });
    expect(where()).toBe('Left panel: Layers');
  });

  it('the edit panel chord hides the edit panel, and F6 skips it then', async () => {
    await mount();
    const panel = $('aside[aria-label="Edit panel"]')!;
    const mod = platformFromUserAgent(navigator.userAgent) === 'mac' ? 'metaKey' : 'ctrlKey';
    const { iframe } = embed.handle!;
    await press(iframe.contentWindow!.document.body, { key: '\\', code: 'Backslash', [mod]: true });
    expect(panel.hidden).toBe(true);
    await press(iframe.contentWindow!.document.body, { key: 'F6' });
    expect(document.activeElement?.textContent).toBe('All projects');
    await press(document.body, { key: '\\', code: 'Backslash', [mod]: true });
    expect(panel.hidden).toBe(false);
  });

  it('routes the platform Save chord in the shell to the editor', async () => {
    await mount();
    const save = vi.spyOn(editor, 'save').mockResolvedValue();
    const [mod, k] = saveChord(platformFromUserAgent(navigator.userAgent)).split('+');
    const e = await press(document.body, {
      key: k!.toLowerCase(),
      metaKey: mod === 'Meta',
      ctrlKey: mod === 'Control',
    });
    expect(e.defaultPrevented).toBe(true);
    expect(save).toHaveBeenCalledOnce();
  });
});

describe('panels read the editor store', () => {
  it('a selection on the canvas shows in the Layers and Design stubs', async () => {
    await mount();
    const doc = await editor.inspect({ depth: 0, fields: [] });
    const hero = { id: 2, name: 'Hero', type: 'FRAME', x: 40, y: 0, width: 320, height: 200 };
    // What the editor posts when a frame is drawn and selected (Story 2.3 payloads).
    await act(async () => {
      editor.emitEvent({
        name: 'document.changed',
        data: {
          document: doc.id,
          revision: 2,
          undoDepth: 1,
          agent: null,
          resync: false,
          nodes: [hero],
          added: [{ id: 2, parent: doc.currentPage, index: 0 }],
          removed: [],
          moved: [],
        },
      });
      editor.emitEvent({
        name: 'selection.changed',
        data: { document: doc.id, page: doc.currentPage, ids: [2], nodes: [hero] },
      });
    });
    expect($('[role="treeitem"][aria-selected="true"]')!.getAttribute('aria-label')).toBe('Hero');
    expect($('[data-testid="design-tab-name"]')!.textContent).toBe('Hero');
    expect($<HTMLInputElement>('[data-testid="design-width"]')!.value).toBe('320');
  });

  it('"Editor panels" turns canvas mode off; ours hide until it comes back on', async () => {
    await mount();
    await act(async () => byName('Use editor panels')!.click());
    expect(executed).toContain('view.canvasMode');
    await act(async () => editor.emitEvent({ name: 'canvas.mode', data: { on: false } }));
    expect($('aside[aria-label="Left panel"]')!.hidden).toBe(true);
    expect($('aside[aria-label="Edit panel"]')!.hidden).toBe(true);
    expect(byName('Use editor panels')!.getAttribute('aria-pressed')).toBe('true');
    await act(async () => editor.emitEvent({ name: 'canvas.mode', data: { on: true } }));
    expect($('aside[aria-label="Edit panel"]')!.hidden).toBe(false);
  });
});
