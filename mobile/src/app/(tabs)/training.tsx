import { loadTrainingFacts } from '@/data/facts-source';
import { TrainingScreen } from '@/features/training/training-screen';
import { useQuery } from '@/store/data-store';

export default function TrainingRoute() {
  const { data } = useQuery(loadTrainingFacts, 'training');
  return data ? <TrainingScreen facts={data} /> : null;
}
