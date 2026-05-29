// Additive protocol surface — a separate route so the precious TradeIsland /
// HomeContent UX is untouched. Read-only views of the MCP protocol families.
import { ProtocolDashboard } from "@/components/protocol/dashboard";

export const metadata = { title: "Protocol · BU.FI" };

export default function ProtocolPage() {
  return <ProtocolDashboard />;
}
