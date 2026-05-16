import { Suspense } from "react";
import { AlphaForm } from "./alpha-form";

export default function AlphaPage() {
  return (
    <Suspense fallback={null}>
      <AlphaForm />
    </Suspense>
  );
}
