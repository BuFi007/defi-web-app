"use server";
import PayId from "@/components/pay-id";
import { generateMetadata } from "@/lib/seo/pay-open-graph";

export { generateMetadata };

export default async function Page() {
  return <PayId />;
}
