import Claim from "@/components/claim-og";
import { generateMetadata } from "@/lib/seo/claim-open-graph";

export { generateMetadata };

export default function Page() {
  return <Claim />;
}