import { router } from 'expo-router';

import { Button } from '@/components/button';
import { PodcastRow } from '@/components/podcast-row';
import { EmptyState, SectionTitle, TabScreen } from '@/components/screen';
import { useLibrary } from '@/library/store';

export default function LibraryScreen() {
  const subscriptions = useLibrary((s) => s.subscriptions);
  const podcasts = Object.values(subscriptions)
    .map((s) => s.podcast)
    .sort((a, b) => a.title.localeCompare(b.title));

  return (
    <TabScreen title="Library">
      <SectionTitle>Subscriptions</SectionTitle>
      {podcasts.length === 0 ? (
        <EmptyState title="No subscriptions yet" body="Shows you subscribe to appear here.">
          <Button title="Find a show" variant="secondary" onPress={() => router.navigate('/discover')} />
        </EmptyState>
      ) : (
        podcasts.map((podcast) => <PodcastRow key={podcast.id} podcast={podcast} />)
      )}
    </TabScreen>
  );
}
