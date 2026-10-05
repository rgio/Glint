import { ScrollView, StyleSheet, View } from 'react-native';

import { useAuth } from '@/auth/session';
import { AccountCard, SignInForm } from '@/components/account';
import { SectionTitle, useContentInsets } from '@/components/screen';
import { ThemedView } from '@/components/themed-view';
import { MaxContentWidth, Spacing } from '@/constants/theme';

export default function SettingsScreen() {
  const insets = useContentInsets();
  const signedIn = useAuth((s) => s.user !== null);
  return (
    <ThemedView style={styles.fill}>
      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: insets.paddingBottom }]}>
        <View style={styles.column}>
          <SectionTitle>Account</SectionTitle>
          {signedIn ? <AccountCard /> : <SignInForm />}
        </View>
      </ScrollView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  content: { paddingHorizontal: Spacing.three, alignItems: 'center' },
  column: { width: '100%', maxWidth: MaxContentWidth, gap: Spacing.two },
});
