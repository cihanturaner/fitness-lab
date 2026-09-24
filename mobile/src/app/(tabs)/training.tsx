import { loadTrainingFacts } from '@/data/training-source';
import { TrainingScreen } from '@/features/training/training-screen';

export default function TrainingRoute() {
  return <TrainingScreen facts={loadTrainingFacts()} />;
}
