import PayId from '@/components/pay-id';
import { generateMetadata } from '@/lib/seo/pay-open-graph';
type Props = {
  params: { id: string; locale: string }
  searchParams: { amount?: string; token?: string; chain?: string }
}

export { generateMetadata as Metadata };


export default function Page({ params, searchParams }: Props) {
  return <PayId params={params} searchParams={searchParams} />;
}