import { useLocalSearchParams } from 'expo-router';

import { WorkoutScreen } from '@/features/workout/workout-screen';

export default function WorkoutRoute() {
  const { date, id } = useLocalSearchParams<{ date: string; id?: string }>();
  const workoutId = typeof id === 'string' && /^\d+$/.test(id) ? Number(id) : null;
  return <WorkoutScreen date={typeof date === 'string' ? date : ''} workoutId={workoutId} />;
}
