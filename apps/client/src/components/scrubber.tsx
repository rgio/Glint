import { useRef, useState } from 'react';
import { StyleSheet, View, type GestureResponderEvent, type StyleProp, type ViewStyle } from 'react-native';

import { ThemedText } from './themed-text';

import { useTheme } from '@/hooks/use-theme';
import { formatClock } from '@/lib/format';
import { usePlayer } from '@/player/store';

const THUMB_SIZE = 12;

type SeekBarProps = {
  /** Thickness of the visible bar; it grows by 2 while hovered or dragged. */
  trackHeight?: number;
  /** Height of the touch / click target around the bar. */
  hitHeight?: number;
  style?: StyleProp<ViewStyle>;
};

/**
 * Progress bar you can tap, click or drag to seek. On web, hovering thickens
 * the bar and shows a thumb and the time under the pointer. Screen readers
 * adjust it with skip back / forward.
 */
export function SeekBar({ trackHeight = 4, hitHeight = 32, style }: SeekBarProps) {
  const theme = useTheme();
  const [width, setWidth] = useState(0);
  const [hoverX, setHoverX] = useState<number | null>(null);
  const [dragX, setDragX] = useState<number | null>(null);
  // Page x of the bar's left edge, captured when a drag starts so the pointer can leave the bar.
  const originX = useRef(0);
  const positionSec = usePlayer((s) => s.positionSec);
  const durationSec = usePlayer((s) => s.durationSec);
  const { seekTo, skipBack, skipForward } = usePlayer.getState();

  const clamp = (x: number) => Math.max(0, Math.min(width, x));
  const secAt = (x: number) => (durationSec && width > 0 ? (clamp(x) / width) * durationSec : 0);
  const dragXFrom = (e: GestureResponderEvent) => e.nativeEvent.pageX - originX.current;

  const fraction =
    dragX != null && width > 0 ? clamp(dragX) / width : durationSec ? Math.min(1, positionSec / durationSec) : 0;
  const remaining = durationSec ? durationSec - positionSec : null;
  const pointerX = dragX ?? hoverX;
  const active = pointerX != null && !!durationSec;
  const barHeight = active ? trackHeight + 2 : trackHeight;

  return (
    <View
      accessible
      accessibilityRole="adjustable"
      accessibilityLabel="Playback position"
      accessibilityValue={{
        text: `${formatClock(positionSec)} elapsed${remaining != null ? `, ${formatClock(remaining)} remaining` : ''}`,
      }}
      accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
      onAccessibilityAction={(e) => (e.nativeEvent.actionName === 'increment' ? skipForward() : skipBack())}
      onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
      onStartShouldSetResponder={() => !!durationSec}
      // Keep the drag even if the pointer wanders vertically over a scroll view.
      onResponderTerminationRequest={() => false}
      onResponderGrant={(e) => {
        originX.current = e.nativeEvent.pageX - e.nativeEvent.locationX;
        setDragX(e.nativeEvent.locationX);
      }}
      onResponderMove={(e) => setDragX(dragXFrom(e))}
      onResponderRelease={(e) => {
        seekTo(secAt(dragXFrom(e)));
        setDragX(null);
      }}
      onResponderTerminate={() => setDragX(null)}
      // Hover only happens with a mouse; children ignore the pointer, so offsetX is relative to the bar.
      onPointerMove={(e) => setHoverX(e.nativeEvent.offsetX)}
      onPointerLeave={() => setHoverX(null)}
      style={[styles.hitArea, { height: hitHeight }, style]}>
      <View
        style={[
          styles.track,
          { height: barHeight, borderRadius: barHeight / 2, backgroundColor: theme.backgroundSelected },
        ]}>
        <View style={[styles.fill, { width: `${fraction * 100}%`, backgroundColor: theme.tint }]} />
      </View>
      {active && (
        <>
          <View
            style={[
              styles.thumb,
              { left: fraction * width - THUMB_SIZE / 2, top: (hitHeight - THUMB_SIZE) / 2, backgroundColor: theme.text },
            ]}
          />
          <View style={[styles.tooltip, { left: clamp(pointerX), backgroundColor: theme.backgroundSelected }]}>
            <ThemedText type="small">{formatClock(secAt(pointerX))}</ThemedText>
          </View>
        </>
      )}
    </View>
  );
}

/** Full player progress bar with elapsed and remaining times. */
export function Scrubber() {
  const positionSec = usePlayer((s) => s.positionSec);
  const durationSec = usePlayer((s) => s.durationSec);
  const remaining = durationSec ? durationSec - positionSec : null;

  return (
    <View>
      <SeekBar />
      <View style={styles.times}>
        <ThemedText type="small" themeColor="textSecondary">
          {formatClock(positionSec)}
        </ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          {remaining != null ? `-${formatClock(remaining)}` : '--:--'}
        </ThemedText>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  hitArea: { justifyContent: 'center', cursor: 'pointer' },
  // The bar's children ignore the pointer so every event targets the bar itself.
  track: { overflow: 'hidden', pointerEvents: 'none' },
  fill: { height: '100%' },
  thumb: {
    position: 'absolute',
    width: THUMB_SIZE,
    height: THUMB_SIZE,
    borderRadius: THUMB_SIZE / 2,
    pointerEvents: 'none',
  },
  tooltip: {
    position: 'absolute',
    bottom: '100%',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    transform: [{ translateX: '-50%' }],
    pointerEvents: 'none',
  },
  times: { flexDirection: 'row', justifyContent: 'space-between' },
});
