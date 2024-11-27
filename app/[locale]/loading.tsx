import { ContainerSkeleton, MoneyMarketSkeleton } from "@/components/skeleton-card";
import { useAccount } from "wagmi";

export default function Loading() {
  const isConnected = useAccount();
    return isConnected ? <ContainerSkeleton /> : <MoneyMarketSkeleton />
  }
