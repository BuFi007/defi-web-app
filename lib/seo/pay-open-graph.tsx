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

  try {
    const amount = searchParams.amount || '0';
    const token = searchParams.token || 'ETH';
    const chain = searchParams.chain || 'base';
    
    // Generate OG image URL
    // const ogImageUrl = `${baseUrl}/api/${params.id}?amount=${amount}&token=${token}&chain=${chain}`;
    const ogImageUrl = `${baseUrl}/api/${encodeURIComponent(params.id)}?amount=${encodeURIComponent(amount)}&token=${encodeURIComponent(token)}&chain=${encodeURIComponent(chain)}`;

    console.log("here is the ogImageUrl", ogImageUrl);

    // Construct metadata
    const title = `Payment Request for ${amount} ${token}`;
    const description = `Send ${amount} ${token} to ${params.id} using Bu.fi`;

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
    const fallbackTitle = "Send or receive tokens with Bu.fi";
    const fallbackDescription = "Send tokens easily with Bu.fi";
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