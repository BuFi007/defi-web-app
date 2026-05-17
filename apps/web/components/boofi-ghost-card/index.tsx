
import { Loader2 } from 'lucide-react';
import useRealtimeClient from '@/hooks/realtime-open-ai/use-realtime-client';
import { BooFiConsole } from './console';
import '@/components/boofi-ghost-card/styles.scss';

export default function BooFiGhostCard() {
  const {
    isReady,
  } = useRealtimeClient();

  if (!isReady) {
    return (
      <div className="flex items-center justify-center h-full w-full py-6">
        <Loader2 className="h-5 w-5 animate-spin text-purpleDanis/70" />
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center h-full">
      <BooFiConsole />
    </div>
  );
}
