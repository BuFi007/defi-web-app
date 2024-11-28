import { type Metadata } from 'next';
import Claim from '@/components/claim-og';
import { generateMetadata } from '@/lib/seo/claim-open-graph';

type Props = {
  params: { locale: string }
  searchParams: { 
    v?: string;
    l?: string;
    chain?: string;
  }
}

// Export the metadata generator
export { generateMetadata };

export default function Page({ params, searchParams }: Props) {
  return <Claim params={params} searchParams={searchParams} />;
}