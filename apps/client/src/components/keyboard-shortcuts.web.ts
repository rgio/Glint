import { useEffect } from 'react';

import { useHighlights } from '@/highlights/store';

/** Web: H highlights the last 30 seconds; Shift+H also opens the note. Ignored while typing. */
export function useKeyboardShortcuts() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || e.repeat || e.key.toLowerCase() !== 'h') return;
      const target = e.target as HTMLElement | null;
      if (target && (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName))) return;
      const highlight = useHighlights.getState().capture('keyboard');
      if (highlight && e.shiftKey) useHighlights.getState().openNote(highlight.id);
      if (highlight) e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}
