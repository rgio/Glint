import { SKIP_INTERVALS, type SkipInterval } from '@podcast/shared';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { useAuth } from '@/auth/session';
import { AccountCard, SignInForm } from '@/components/account';
import { SectionTitle, useContentInsets } from '@/components/screen';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { MaxContentWidth, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { usePlayer } from '@/player/store';

export default function SettingsScreen() {
  const insets = useContentInsets();
  const signedIn = useAuth((s) => s.user !== null);
  return (
    <ThemedView style={styles.fill}>
      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: insets.paddingBottom }]}>
        <View style={styles.column}>
          <SectionTitle>Account</SectionTitle>
          {signedIn ? <AccountCard /> : <SignInForm />}

          <SectionTitle>Playback</SectionTitle>
          <ThemedView type="backgroundElement" style={styles.card}>
            <SkipChoice edge="back" />
            <SkipChoice edge="forward" />
            <ThemedText type="small" themeColor="textSecondary">
              {"Speed is set from the player. These settings sync to your other devices when you're signed in."}
            </ThemedText>
          </ThemedView>
        </View>
      </ScrollView>
    </ThemedView>
  );
}

function SkipChoice({ edge }: { edge: 'back' | 'forward' }) {
  const theme = useTheme();
  const value = usePlayer((s) => (edge === 'back' ? s.skipBackSec : s.skipForwardSec));
  const label = edge === 'back' ? 'Skip back' : 'Skip forward';
  const choose = (sec: SkipInterval) => usePlayer.getState().setSkipIntervals({ [edge]: sec });

  return (
    <View style={styles.choiceRow}>
      <ThemedText style={styles.choiceLabel}>{label}</ThemedText>
      <View role="radiogroup" aria-label={label} style={styles.choices}>
        {SKIP_INTERVALS.map((sec) => {
          const active = sec === value;
          return (
            <Pressable
              key={sec}
              role="radio"
              aria-checked={active}
              aria-label={`${sec} seconds`}
              onPress={() => choose(sec)}
              style={({ pressed }) => [
                styles.choice,
                { backgroundColor: active ? theme.tint : theme.backgroundSelected },
                pressed && styles.pressed,
              ]}>
              <ThemedText type="smallBold" style={active ? { color: theme.background } : undefined}>
                {`${sec} s`}
              </ThemedText>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  content: { paddingHorizontal: Spacing.three, alignItems: 'center' },
  column: { width: '100%', maxWidth: MaxContentWidth, gap: Spacing.two },
  card: { gap: Spacing.three, padding: Spacing.three, borderRadius: Spacing.three },
  choiceRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: Spacing.two },
  choiceLabel: { flex: 1, minWidth: 120 },
  choices: { flexDirection: 'row', gap: Spacing.two },
  choice: { minWidth: 56, minHeight: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', paddingHorizontal: Spacing.two },
  pressed: { opacity: 0.6 },
});
