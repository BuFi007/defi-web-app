
import useRealtimeClient from '@/hooks/realtime-open-ai/use-realtime-client';
import { SkeletonGradient } from '@/components/ui/skeleton-gradient';
import { BooFiConsole } from './console';
import '@/components/boofi-ghost-card/styles.scss';

export default function BooFiGhostCard() {
  const {
    isReady,
  } = useRealtimeClient();

  if (!isReady) {
    return <SkeletonGradient />;
  }

  return (
    <div className="flex flex-col items-center h-full">
      <BooFiConsole />
    </div>
  );
}
