import { Metadata, ResolvingMetadata } from 'next'
import { headers } from 'next/headers'
import { getTranslations } from 'next-intl/server';

type Props = {
  params: { id: string; locale: string }
  searchParams: { amount?: string; token?: string; chain?: string }
}

export async function generateMetadata(
  { params, searchParams }: Props,
  parent: ResolvingMetadata
): Promise<Metadata> {
  const headersList = headers();
  const origin = headersList.get('origin') || '';
  const baseUrl = origin.startsWith('https') 
    ? process.env.NEXT_PUBLIC_MAINNET_URL 
    : process.env.NEXT_PUBLIC_TESTNET_URL;

  const t = await getTranslations('OpenGraphPayment');

  try {
    const amount = searchParams.amount || '0';
    const token = searchParams.token || 'ETH';
    const chain = searchParams.chain || 'base';
    
    // Generate OG image URL
    // const ogImageUrl = `${baseUrl}/api/${params.id}?amount=${amount}&token=${token}&chain=${chain}`;
    const ogImageUrl = `${baseUrl}/api/${encodeURIComponent(params.id)}?amount=${encodeURIComponent(amount)}&token=${encodeURIComponent(token)}&chain=${encodeURIComponent(chain)}`;

    console.log("here is the ogImageUrl", ogImageUrl);

    // Construct metadata
    const title = `${t('paymentTitle')} ${amount} ${token}`;
    const description = `${t('paymentDescription')} ${amount} ${token} ${t('paymentDescription2')}${params.id} ${t('paymentDescription3')}`;

    return {
      title,
      description,
      openGraph: {
        title,
        description,
        url: `${baseUrl}/${params.locale}/${params.id}`,
        images: [ogImageUrl],
        siteName: 'Bu.fi',
        type: 'website',
      },
      twitter: {
        card: 'summary_large_image',
        title,
        description,
        images: [ogImageUrl],
      },
    };
  } catch (error) {
    console.error("Error generating metadata:", error);
    const fallbackTitle = t('paymentFallbackTitle');
    const fallbackDescription = t('paymentFallbackDescription');
    const fallbackImage = `${baseUrl}/images/BooFi-icon.png`;

    return {
      title: fallbackTitle,
      description: fallbackDescription,
      openGraph: {
        title: fallbackTitle,
        description: fallbackDescription,
        images: [{ url: fallbackImage }],
        url: `${baseUrl}/${params.locale}/${params.id}`,
        siteName: "Bu.fi",
        type: "website",
      },
      twitter: {
        card: "summary_large_image",
        title: fallbackTitle,
        description: fallbackDescription,
        images: [fallbackImage],
      },
    };
  }
}