import { useLocalSearchParams } from 'expo-router';

import { loadTrainingFacts } from '@/data/training-source';
import { SessionPlanScreen } from '@/features/training/session-plan-screen';

export default function PlanRoute() {
  const { date } = useLocalSearchParams<{ date: string }>();
  return <SessionPlanScreen facts={loadTrainingFacts()} date={typeof date === 'string' ? date : ''} />;
}
