import { useRouter } from 'expo-router';
import { useMemo } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import type { HomeFacts } from '@/data/home-facts';
import { tabBarClearance } from '@/features/shell/tab-bar';
import { color, gutter, space } from '@/theme/tokens';
import { Text } from '@/ui/text';

import { HomeHeader } from './components/home-header';
import { ProgressCards } from './components/progress-cards';
import { WeekStrip } from './components/week-strip';
import { WorkoutHero } from './components/workout-hero';
import { buildHomeView } from './home-view';

export function HomeScreen({ facts }: { facts: HomeFacts }) {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const view = useMemo(() => buildHomeView(facts), [facts]);

  // The top inset is applied to a non-scrolling frame, not to the scroll content, so the
  // scroll viewport itself starts below the status bar and nothing scrolls under it.
  return (
    <View style={[styles.screen, { paddingTop: insets.top }]}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[styles.content, { paddingBottom: tabBarClearance(insets.bottom) }]}
        showsVerticalScrollIndicator={false}>
        <HomeHeader
          dateLabel={view.dateLabel}
          blockLabel={view.blockLabel}
          onOpenSettings={() => router.push('/settings')}
        />
        <View style={styles.strip}>
          <WeekStrip days={view.strip} />
        </View>
        <WorkoutHero
          hero={view.hero}
          focusGroups={facts.todayWorkout?.focus ?? []}
          onOpenWorkout={() => router.push({ pathname: '/workout/[date]', params: { date: facts.today } })}
          onOpenSettings={() => router.push('/settings')}
        />

        <Text variant="section" accessibilityRole="header" style={styles.section}>
          Progress
        </Text>
        <ProgressCards nutrition={view.nutrition} bodyweight={view.bodyweight} week={view.week} />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: color.paper },
  scroll: { flex: 1 },
  content: { paddingHorizontal: gutter, paddingTop: space.xs },
  strip: { marginTop: space.sm, marginBottom: space.md },
  section: { marginTop: space.xl, marginBottom: space.md },
});
