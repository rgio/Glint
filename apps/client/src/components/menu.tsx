import { useState, type ReactNode } from 'react';
import { Modal, Pressable, StyleSheet, useWindowDimensions, View } from 'react-native';

import { Icon } from './icon';
import { ThemedText } from './themed-text';
import { ThemedView } from './themed-view';

import { Spacing } from '@/constants/theme';

export type MenuOption<T> = { value: T; label: string };

const MENU_WIDTH = 220;
const ROW_HEIGHT = 44;

type Anchor = { x: number; y: number; width: number; height: number };

/**
 * A button that opens a list of choices just above it, like a dropdown. Choosing one, tapping
 * outside or pressing Escape closes it. `trigger` renders the button; it gets `open` for styling.
 */
export function ChoiceMenu<T>({
  label,
  options,
  selected,
  onChoose,
  trigger,
}: {
  /** Names the list for screen readers, e.g. "Playback speed". */
  label: string;
  options: MenuOption<T>[];
  selected: T;
  onChoose: (value: T) => void;
  trigger: (props: { open: boolean; onPress: () => void }) => ReactNode;
}) {
  const [anchorView, setAnchorView] = useState<View | null>(null);
  const [anchor, setAnchor] = useState<Anchor | null>(null);
  const window = useWindowDimensions();

  const open = () =>
    anchorView?.measureInWindow((x, y, width, height) => setAnchor({ x, y, width, height }));
  const close = () => setAnchor(null);

  const menuHeight = options.length * ROW_HEIGHT + Spacing.two * 2;
  const position = anchor && {
    left: Math.max(Spacing.two, Math.min(window.width - MENU_WIDTH - Spacing.two, anchor.x + anchor.width / 2 - MENU_WIDTH / 2)),
    // Above the button when there's room, otherwise below it.
    top: anchor.y - menuHeight - Spacing.two >= Spacing.five ? anchor.y - menuHeight - Spacing.two : anchor.y + anchor.height + Spacing.two,
  };

  return (
    <>
      <View ref={setAnchorView} collapsable={false}>
        {trigger({ open: anchor !== null, onPress: open })}
      </View>
      <Modal visible={anchor !== null} transparent animationType="fade" onRequestClose={close}>
        <Pressable style={StyleSheet.absoluteFill} accessibilityLabel="Close menu" onPress={close} />
        {position && (
          <ThemedView type="backgroundSelected" role="radiogroup" aria-label={label} style={[styles.menu, position]}>
            {options.map((option) => {
              const active = option.value === selected;
              return (
                <Pressable
                  key={option.label}
                  role="radio"
                  aria-checked={active}
                  aria-label={option.label}
                  onPress={() => {
                    onChoose(option.value);
                    close();
                  }}
                  style={({ pressed }) => [styles.row, pressed && styles.pressed]}>
                  <ThemedText type={active ? 'smallBold' : 'small'} style={styles.rowText}>
                    {option.label}
                  </ThemedText>
                  {active && <Icon name="checkmark" size={16} />}
                </Pressable>
              );
            })}
          </ThemedView>
        )}
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  menu: {
    position: 'absolute',
    width: MENU_WIDTH,
    paddingVertical: Spacing.two,
    borderRadius: Spacing.three,
    shadowColor: '#000',
    shadowOpacity: 0.3,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 4 },
    elevation: 8,
  },
  row: { height: ROW_HEIGHT, flexDirection: 'row', alignItems: 'center', paddingHorizontal: Spacing.three },
  rowText: { flex: 1 },
  pressed: { opacity: 0.6 },
});
