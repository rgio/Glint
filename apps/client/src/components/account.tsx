import { useState } from 'react';
import { StyleSheet, TextInput, View } from 'react-native';

import { Button } from './button';
import { ThemedText } from './themed-text';
import { ThemedView } from './themed-view';

import { deleteAccount, signOut, startEmailSignIn, useAuth, verifySignIn } from '@/auth/session';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { syncNow, useSync } from '@/sync/engine';

/** "Synced at 3:42 PM", or what's happening or went wrong. A clock time stays true without re-rendering. */
export function useSyncStatusText(): string {
  const { status, error, lastSyncedAt } = useSync();
  if (status === 'syncing') return 'Syncing…';
  if (status === 'error') return `Couldn't sync: ${error}`;
  if (!lastSyncedAt) return 'Not synced yet';
  return `Synced at ${new Date(lastSyncedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`;
}

/** F-12: email sign-in. The email carries a code to type here and, for the web, a link. */
export function SignInForm() {
  const theme = useTheme();
  const [email, setEmail] = useState('');
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const send = (address: string) =>
    run(async () => {
      await startEmailSignIn(address);
      setSentTo(address.trim().toLowerCase());
      setCode('');
    });

  const inputStyle = [styles.input, { color: theme.text, borderColor: theme.border }];

  if (!sentTo) {
    return (
      <View style={styles.form}>
        <ThemedText type="small" themeColor="textSecondary">
          Optional: everything works without an account. Signing in keeps your subscriptions, queue and progress in
          step across your devices.
        </ThemedText>
        <TextInput
          value={email}
          onChangeText={setEmail}
          onSubmitEditing={() => email.trim() && send(email)}
          placeholder="you@example.com"
          placeholderTextColor={theme.textSecondary}
          accessibilityLabel="Email address"
          autoCapitalize="none"
          autoComplete="email"
          keyboardType="email-address"
          returnKeyType="send"
          style={inputStyle}
        />
        <Button title="Email me a sign-in code" loading={busy} disabled={!email.trim()} onPress={() => send(email)} />
        {error && <ErrorText message={error} />}
      </View>
    );
  }

  return (
    <View style={styles.form}>
      <ThemedText type="small" themeColor="textSecondary">
        {`We sent a 6-digit code to ${sentTo}. Enter it here, or open the link in the email on this device.`}
      </ThemedText>
      <TextInput
        value={code}
        onChangeText={(text) => setCode(text.replace(/\D/g, '').slice(0, 6))}
        onSubmitEditing={() => code.length === 6 && run(async () => void (await verifySignIn({ email: sentTo, code })))}
        placeholder="123456"
        placeholderTextColor={theme.textSecondary}
        accessibilityLabel="Sign-in code"
        autoComplete="one-time-code"
        keyboardType="number-pad"
        maxLength={6}
        style={[inputStyle, styles.code]}
      />
      <Button
        title="Sign in"
        loading={busy}
        disabled={code.length !== 6}
        onPress={() => run(async () => void (await verifySignIn({ email: sentTo, code })))}
      />
      {error && <ErrorText message={error} />}
      <View style={styles.links}>
        <Button title="Send a new code" variant="secondary" disabled={busy} onPress={() => send(sentTo)} style={styles.grow} />
        <Button title="Use a different email" variant="secondary" disabled={busy} onPress={() => setSentTo(null)} style={styles.grow} />
      </View>
    </View>
  );
}

/** Signed in: who, sync status, and the account actions. */
export function AccountCard() {
  const user = useAuth((s) => s.user);
  const syncing = useSync((s) => s.status === 'syncing');
  const syncText = useSyncStatusText();
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!user) return null;

  return (
    <View style={styles.form}>
      <ThemedText>{`Signed in as ${user.email}`}</ThemedText>
      <ThemedText type="small" themeColor="textSecondary" accessibilityLiveRegion="polite">
        {syncText}
      </ThemedText>
      <View style={styles.links}>
        <Button title="Sync now" variant="secondary" loading={syncing} onPress={() => void syncNow()} style={styles.grow} />
        <Button title="Sign out" variant="secondary" onPress={() => void signOut()} style={styles.grow} />
      </View>

      {confirmingDelete ? (
        <ThemedView type="backgroundElement" style={styles.confirm}>
          <ThemedText type="smallBold">Delete your account?</ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            {"Your account and everything synced to it are removed from our servers for good. What's on this device stays."}
          </ThemedText>
          <View style={styles.links}>
            <Button
              title="Delete account"
              variant="danger"
              onPress={async () => {
                try {
                  await deleteAccount();
                } catch (err) {
                  setError((err as Error).message);
                }
              }}
              style={styles.grow}
            />
            <Button title="Cancel" variant="secondary" onPress={() => setConfirmingDelete(false)} style={styles.grow} />
          </View>
          {error && <ErrorText message={error} />}
        </ThemedView>
      ) : (
        <Button title="Delete account…" variant="secondary" onPress={() => setConfirmingDelete(true)} />
      )}
    </View>
  );
}

function ErrorText({ message }: { message: string }) {
  const theme = useTheme();
  return (
    <ThemedText type="small" style={{ color: theme.danger }} accessibilityLiveRegion="polite">
      {message}
    </ThemedText>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three, padding: Spacing.three, borderRadius: Spacing.three },
  rowText: { flex: 1, gap: Spacing.half },
  pressed: { opacity: 0.6 },
  form: { gap: Spacing.two },
  input: { minHeight: 44, borderWidth: 1, borderRadius: Spacing.three, paddingHorizontal: Spacing.three, fontSize: 16 },
  code: { letterSpacing: 6, fontSize: 20 },
  links: { flexDirection: 'row', gap: Spacing.two },
  grow: { flex: 1 },
  confirm: { padding: Spacing.three, borderRadius: Spacing.three, gap: Spacing.two },
});
