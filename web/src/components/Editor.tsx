import { useEffect, useRef } from 'react';
import { EditorState, Compartment } from '@codemirror/state';
import { EditorView, keymap, drawSelection, highlightActiveLine, placeholder } from '@codemirror/view';
import { defaultKeymap } from '@codemirror/commands';
import { markdown } from '@codemirror/lang-markdown';
import { yCollab, yUndoManagerKeymap } from 'y-codemirror.next';
import * as Y from 'yjs';
import type { SyncProvider } from '../provider';
import { MAX_TEXT } from '../../../src/shared';

export default function Editor({
  provider,
  readonly,
  onText,
}: {
  provider: SyncProvider;
  readonly: boolean;
  onText: (text: string) => void;
}) {
  const host = useRef<HTMLDivElement>(null),
    view = useRef<EditorView | null>(null),
    editable = useRef(new Compartment()),
    callback = useRef(onText);
  callback.current = onText;
  useEffect(() => {
    if (!host.current) return;
    const text = provider.doc.getText('content'),
      undo = new Y.UndoManager(text);
    const update = () => callback.current(text.toString());
    text.observe(update);
    update();
    const editor = new EditorView({
      parent: host.current,
      state: EditorState.create({
        doc: text.toString(),
        extensions: [
          EditorState.transactionFilter.of((transaction) =>
            transaction.newDoc.length > MAX_TEXT ? [] : transaction,
          ),
          markdown(),
          EditorView.lineWrapping,
          drawSelection(),
          highlightActiveLine(),
          placeholder('Start with a thought. Your changes stay on this device until they sync.'),
          keymap.of([...yUndoManagerKeymap, ...defaultKeymap]),
          yCollab(text, provider.awareness, { undoManager: undo }),
          editable.current.of([EditorState.readOnly.of(readonly), EditorView.editable.of(!readonly)]),
          EditorView.contentAttributes.of({ 'aria-label': 'Document editor', spellcheck: 'true' }),
          EditorView.theme({
            '&': { fontSize: '14px', background: 'transparent' },
            '.cm-content': {
              fontFamily: 'DM Sans, sans-serif',
              lineHeight: '1.95',
              padding: '28px 0 90px',
              minHeight: '600px',
            },
            '.cm-line': { padding: '0 2px' },
            '.cm-scroller': { overflow: 'visible' },
            '&.cm-focused': { outline: 'none' },
            '.cm-activeLine': { background: '#f4f0e9' },
            '.cm-cursor': { borderLeftColor: '#d15c37' },
            '.cm-selectionBackground, &.cm-focused .cm-selectionBackground': { background: '#f4d6c7' },
            '.cm-ySelectionInfo': {
              fontFamily: 'DM Sans, sans-serif',
              borderRadius: '4px',
              padding: '2px 7px',
            },
          }),
        ],
      }),
    });
    view.current = editor;
    return () => {
      view.current = null;
      text.unobserve(update);
      editor.destroy();
      undo.destroy();
    };
    // Editor state is bound to this provider; editability is updated separately.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [provider]);
  useEffect(() => {
    view.current?.dispatch({
      effects: editable.current.reconfigure([
        EditorState.readOnly.of(readonly),
        EditorView.editable.of(!readonly),
      ]),
    });
  }, [readonly]);
  return <div className="editor-host" ref={host} />;
}
