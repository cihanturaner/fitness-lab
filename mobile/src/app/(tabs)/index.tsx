import { loadHomeFacts } from '@/data/home-source';
import { HomeScreen } from '@/features/home/home-screen';

export default function HomeRoute() {
  return <HomeScreen facts={loadHomeFacts()} />;
}
