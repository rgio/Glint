import { useRef, useState } from 'react';
import { StyleSheet, View, type GestureResponderEvent } from 'react-native';

import { ThemedText } from './themed-text';

import { useTheme } from '@/hooks/use-theme';
import { formatClock } from '@/lib/format';

const HANDLE_WIDTH = 28;
const TRACK_HEIGHT = 48;

type Edge = 'start' | 'end';

type RangeSelectorProps = {
  /** The stretch of the episode the track shows. */
  windowStartSec: number;
  windowEndSec: number;
  startSec: number;
  endSec: number;
  /** Where playback is, marked on the track when it's in the window. */
  positionSec?: number;
  onChange: (edge: Edge, seconds: number) => void;
  /** Called with true when a drag starts and false when it ends, e.g. to stop a page scrolling. */
  onDragging?: (dragging: boolean) => void;
};

/**
 * A track showing part of an episode, with the selected range shaded between two handles.
 * Drag a handle to move that edge; screen readers adjust each handle by 5 seconds.
 */
export function RangeSelector({ windowStartSec, windowEndSec, startSec, endSec, positionSec, onChange, onDragging }: RangeSelectorProps) {
  const theme = useTheme();
  const [width, setWidth] = useState(0);
  const [dragging, setDragging] = useState<Edge | null>(null);
  // Page x of the track's left edge, captured when a drag starts.
  const originX = useRef(0);

  const span = Math.max(1, windowEndSec - windowStartSec);
  const xOf = (sec: number) => (width * (Math.min(windowEndSec, Math.max(windowStartSec, sec)) - windowStartSec)) / span;
  const secAt = (pageX: number) => windowStartSec + (Math.max(0, Math.min(width, pageX - originX.current)) / width) * span;

  const handle = (edge: Edge) => {
    const sec = edge === 'start' ? startSec : endSec;
    const label = edge === 'start' ? 'Start' : 'End';
    return (
      <View
        key={edge}
        accessible
        accessibilityRole="adjustable"
        accessibilityLabel={`${label} of highlight`}
        accessibilityValue={{ text: formatClock(sec) }}
        accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
        onAccessibilityAction={(e) => onChange(edge, sec + (e.nativeEvent.actionName === 'increment' ? 5 : -5))}
        onStartShouldSetResponder={() => true}
        onResponderTerminationRequest={() => false}
        onResponderGrant={(e: GestureResponderEvent) => {
          // The handle's own offset within the track, from its position.
          originX.current = e.nativeEvent.pageX - e.nativeEvent.locationX - (xOf(sec) - HANDLE_WIDTH / 2);
          setDragging(edge);
          onDragging?.(true);
        }}
        onResponderMove={(e) => onChange(edge, secAt(e.nativeEvent.pageX))}
        onResponderRelease={() => {
          setDragging(null);
          onDragging?.(false);
        }}
        onResponderTerminate={() => {
          setDragging(null);
          onDragging?.(false);
        }}
        style={[styles.handle, { left: xOf(sec) - HANDLE_WIDTH / 2 }]}>
        <View style={[styles.grip, { backgroundColor: dragging === edge ? theme.text : theme.tint }]} />
      </View>
    );
  };

  const inWindow = positionSec !== undefined && positionSec >= windowStartSec && positionSec <= windowEndSec;

  return (
    <View>
      <View style={[styles.track, { backgroundColor: theme.backgroundElement }]} onLayout={(e) => setWidth(e.nativeEvent.layout.width)}>
        {width > 0 && (
          <>
            <View
              pointerEvents="none"
              style={[styles.selected, { left: xOf(startSec), width: Math.max(2, xOf(endSec) - xOf(startSec)), backgroundColor: theme.tint }]}
            />
            {inWindow && <View pointerEvents="none" style={[styles.playhead, { left: xOf(positionSec) - 1, backgroundColor: theme.text }]} />}
            {handle('start')}
            {handle('end')}
          </>
        )}
      </View>
      <View style={styles.labels}>
        <ThemedText type="small" themeColor="textSecondary">
          {formatClock(windowStartSec)}
        </ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          {formatClock(windowEndSec)}
        </ThemedText>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  track: { height: TRACK_HEIGHT, borderRadius: 8, marginHorizontal: HANDLE_WIDTH / 2 },
  selected: { position: 'absolute', top: 0, bottom: 0, opacity: 0.35 },
  playhead: { position: 'absolute', top: 4, bottom: 4, width: 2, opacity: 0.8 },
  handle: { position: 'absolute', top: -8, bottom: -8, width: HANDLE_WIDTH, alignItems: 'center', justifyContent: 'center' },
  grip: { width: 6, height: TRACK_HEIGHT - 8, borderRadius: 3 },
  labels: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 4 },
});
