import { useLocalSearchParams } from 'expo-router';

import { loadTrainingFacts } from '@/data/facts-source';
import { SessionPlanScreen } from '@/features/training/session-plan-screen';
import { useQuery } from '@/store/data-store';

export default function PlanRoute() {
  const { date } = useLocalSearchParams<{ date: string }>();
  const { data } = useQuery(loadTrainingFacts, 'training');
  return data ? <SessionPlanScreen facts={data} date={typeof date === 'string' ? date : ''} /> : null;
}
