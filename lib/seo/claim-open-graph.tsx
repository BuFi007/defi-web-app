// lib/seo/claim-open-graph.tsx
import { Metadata, ResolvingMetadata } from 'next';
import { headers } from 'next/headers';
import { fetchLinkDetails } from "@/utils";
import { IGetLinkDetailsResponse } from "@/lib/types";

type Props = {
  params: { locale: string }
  searchParams: { 
    v?: string;
    l?: string;
    chain?: string;
  }
}

// Create a simplified version of fetchLinkDetails for metadata
async function getClaimDetails(url: string): Promise<IGetLinkDetailsResponse> {
  return new Promise((resolve, reject) => {
    fetchLinkDetails(
      url,
      (details: IGetLinkDetailsResponse) => resolve(details),
      () => {}, // setPaymentInfo
      {} as any // translations
    );
  });
}

export async function generateMetadata(
  { params, searchParams }: Props,
  parent: ResolvingMetadata
): Promise<Metadata> {
  const headersList = headers();
  const domain = headersList.get('host') || process.env.NEXT_PUBLIC_URL;
  const protocol = process.env.NODE_ENV === 'development' ? 'http' : 'https';
  const baseUrl = `${protocol}://${domain}`;

  // Get claim details
  try {
    const url = `${baseUrl}/claim?v=${searchParams.v}&l=${searchParams.l}&chain=${searchParams.chain}`;
    const details = await getClaimDetails(url);
    
    if (!details) throw new Error('No details found');

    const amount = details.tokenAmount?.toString() || '0';
    const token = details.tokenSymbol || 'ETH';
    const chain = searchParams.chain || '1';
    
    // Generate OG image URL
    const ogImageUrl = `${baseUrl}/api/og/claim?amount=${amount}&token=${token}&chain=${chain}`;
    
    // Construct metadata
    const title = `Claim ${amount} ${token} on Bu.fi`;
    const description = `Someone sent you ${amount} ${token}. Click to claim your tokens!`;

    return {
      title,
      description,
      openGraph: {
        title,
        description,
        images: [ogImageUrl],
        url: `${baseUrl}/${params.locale}/claim`,
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
  } catch (error) {
    // Fallback metadata if we can't fetch claim details
    return {
      title: "Claim your tokens on Bu.fi",
      description: "Someone sent you tokens. Click to claim them!",
      openGraph: {
        title: "Claim your tokens on Bu.fi",
        description: "Someone sent you tokens. Click to claim them!",
        images: [`${baseUrl}/images/BooFi-icon.png`],
        url: `${baseUrl}/${params.locale}/claim`,
        siteName: 'Bu.fi',
        type: 'website',
      },
      twitter: {
        card: 'summary_large_image',
        title: "Claim your tokens on Bu.fi",
        description: "Someone sent you tokens. Click to claim them!",
        images: [`${baseUrl}/images/BooFi-icon.png`],
      },
    }
  }
}