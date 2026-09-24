import { loadHomeFacts } from '@/data/facts-source';
import { HomeScreen } from '@/features/home/home-screen';
import { useQuery } from '@/store/data-store';

export default function HomeRoute() {
  const { data } = useQuery(loadHomeFacts, 'home');
  return data ? <HomeScreen facts={data} /> : null;
}
