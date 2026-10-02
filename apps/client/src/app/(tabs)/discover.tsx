import { useMutation, useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, TextInput, View } from 'react-native';

import { api } from '@/api/client';
import { Button } from '@/components/button';
import { SectionTitle, TabScreen } from '@/components/screen';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

// Until catalog search (F-02) and trending charts (F-01) land, offer a few known-good feeds.
const STARTER_FEEDS = [
  { title: 'Podnews Daily', feedUrl: 'https://podnews.net/rss' },
  { title: 'The Vergecast', feedUrl: 'https://feeds.megaphone.fm/vergecast' },
];

export default function DiscoverScreen() {
  const theme = useTheme();
  const queryClient = useQueryClient();
  const [feedUrl, setFeedUrl] = useState('');

  const resolve = useMutation({
    mutationFn: api.resolvePodcast,
    onSuccess: ({ podcast }) => {
      queryClient.setQueryData(['podcast', podcast.id], { podcast });
      setFeedUrl('');
      router.push({ pathname: '/podcast/[id]', params: { id: podcast.id } });
    },
  });

  return (
    <TabScreen title="Discover">
      <SectionTitle>Add by RSS URL</SectionTitle>
      <View style={styles.form}>
        <TextInput
          value={feedUrl}
          onChangeText={setFeedUrl}
          onSubmitEditing={() => feedUrl && resolve.mutate(feedUrl)}
          placeholder="https://example.com/feed.xml"
          placeholderTextColor={theme.textSecondary}
          accessibilityLabel="Podcast RSS feed URL"
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
          returnKeyType="go"
          style={[styles.input, { color: theme.text, borderColor: theme.border }]}
        />
        <Button
          title="Add"
          loading={resolve.isPending}
          disabled={!feedUrl.trim()}
          onPress={() => resolve.mutate(feedUrl)}
        />
      </View>
      {resolve.error && (
        <ThemedText type="small" style={{ color: theme.danger }} accessibilityLiveRegion="polite">
          {resolve.error.message}
        </ThemedText>
      )}

      <SectionTitle>Try these</SectionTitle>
      {STARTER_FEEDS.map((feed) => (
        <Button
          key={feed.feedUrl}
          title={feed.title}
          variant="secondary"
          disabled={resolve.isPending}
          onPress={() => resolve.mutate(feed.feedUrl)}
        />
      ))}
    </TabScreen>
  );
}

const styles = StyleSheet.create({
  form: { flexDirection: 'row', gap: Spacing.two },
  input: {
    flex: 1,
    minHeight: 44,
    borderWidth: 1,
    borderRadius: Spacing.three,
    paddingHorizontal: Spacing.three,
    fontSize: 16,
  },
});
