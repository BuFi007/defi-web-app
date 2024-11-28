import { Metadata, ResolvingMetadata } from 'next'
import { headers } from 'next/headers'

type Props = {
  params: { id: string; locale: string }
  searchParams: { amount?: string; token?: string; chain?: string }
}

export async function generateMetadata(
  { params, searchParams }: Props,
  parent: ResolvingMetadata
): Promise<Metadata> {
  const headersList = headers();
  const domain = headersList.get('host') || process.env.NEXT_PUBLIC_URL;
  const protocol = process.env.NODE_ENV === 'development' ? 'http' : 'https';
  const baseUrl = `${protocol}://${domain}`;

  const amount = searchParams.amount || '0';
  const token = searchParams.token || 'ETH';
  const chain = searchParams.chain || 'base';
  
  // Generate OG image URL
  const ogImageUrl = `${baseUrl}/api/og/${params.id}?amount=${amount}&token=${token}&chain=${chain}`;
  
  // Construct metadata
  const title = `Payment Request for ${amount} ${token}`;
  const description = `Send ${amount} ${token} to ${params.id} using Bu.fi`;

  return {
    title,
    description,
    openGraph: {
      title,
      description,
      images: [ogImageUrl],
      url: `${baseUrl}/${params.locale}/${params.id}`,
      siteName: 'Bu.fi',
      type: 'website',
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description,
      images: [ogImageUrl],
    },
  }
}