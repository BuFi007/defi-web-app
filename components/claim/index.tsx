import { useSearchParams } from "next/navigation";

export default function Claim() {
  const searchParams = useSearchParams();
  const links = searchParams.get("claim");
  console.log(links);
  return <div>Claim</div>;
}
