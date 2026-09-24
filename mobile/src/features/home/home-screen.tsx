import { useRouter } from 'expo-router';
import { useMemo } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import type { HomeFacts } from '@/data/home-facts';
import { tabBarClearance } from '@/features/shell/tab-bar';
import { color, gutter, space } from '@/theme/tokens';
import { Text } from '@/ui/text';

import { HomeHeader } from './components/home-header';
import { NutritionCard } from './components/nutrition-card';
import { BodyweightCard, WeekCard } from './components/summary-cards';
import { WeekStrip } from './components/week-strip';
import { WorkoutHero } from './components/workout-hero';
import { buildHomeView } from './home-view';

export function HomeScreen({ facts }: { facts: HomeFacts }) {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const view = useMemo(() => buildHomeView(facts), [facts]);

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={[
        styles.content,
        { paddingTop: insets.top + space.md, paddingBottom: tabBarClearance(insets.bottom) },
      ]}
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
        onOpenWorkout={() => router.navigate('/training')}
      />

      <Text variant="title" accessibilityRole="header" style={styles.section}>
        Today
      </Text>
      <NutritionCard nutrition={view.nutrition} />
      <View style={styles.pair}>
        <BodyweightCard bodyweight={view.bodyweight} />
        <WeekCard week={view.week} />
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: color.paper },
  content: { paddingHorizontal: gutter },
  strip: { marginTop: space.xl, marginBottom: space.xl },
  section: { marginTop: space.xxxl, marginBottom: space.md },
  pair: { flexDirection: 'row', gap: space.md, marginTop: space.md },
});
