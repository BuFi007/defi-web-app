"use client";
import { useLocalStorageStore } from "@/store";
import { useDynamicContext } from "@dynamic-labs/sdk-react-core";

export default function GetClaim() {
  const { links, setLinks } = useLocalStorageStore();

  const { primaryWallet } = useDynamicContext();

  const handleSubmit = () => {
    setLinks(links);
  };

  console.log(links);
  return (
    <section className="flex flex-col gap-4">
      <h1 className="text-2xl font-bold">Get Claim</h1>
      <button onClick={handleSubmit}>Submit</button>
    </section>
  );
}
