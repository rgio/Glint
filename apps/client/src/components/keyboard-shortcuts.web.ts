import { useEffect } from 'react';

import { useHighlights } from '@/highlights/store';
import { usePlayer } from '@/player/store';

/**
 * Web shortcuts, ignored while typing:
 * - Space or K: play / pause (Space is left to a focused button or link, which it presses)
 * - ← or J / → or L: skip back / forward
 * - < / >: 0.1x slower / faster
 * - H: highlight the last 30 seconds; Shift+H also opens the note
 */
export function useKeyboardShortcuts() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const target = e.target as HTMLElement | null;
      if (target && (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName))) return;
      const pressable = target?.closest('button, a, [role="button"], [role="link"], [role="radio"], [role="checkbox"]');

      const player = usePlayer.getState();
      if (!player.current) return;
      const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
      const run = (action: () => void) => {
        e.preventDefault();
        action();
      };

      switch (key) {
        case ' ':
          if (pressable || e.repeat) return;
          return run(player.togglePlay);
        case 'k':
          if (e.repeat) return;
          return run(player.togglePlay);
        case 'ArrowLeft':
        case 'j':
          return run(player.skipBack);
        case 'ArrowRight':
        case 'l':
          return run(player.skipForward);
        case '<':
          return run(() => player.stepRate(-1));
        case '>':
          return run(() => player.stepRate(1));
        case 'h': {
          if (e.repeat) return;
          const highlight = useHighlights.getState().capture('keyboard');
          if (highlight && e.shiftKey) useHighlights.getState().openNote(highlight.id);
          return run(() => {});
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}
