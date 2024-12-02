import { Metadata } from "next";
import { headers } from "next/headers";
import { IGetLinkDetailsResponse } from "@/lib/types";
import { getLinkDetails } from "@squirrel-labs/peanut-sdk";

type Props = {
  params: { locale: string };
  searchParams: {
    v?: string;
    l?: string;
    chain?: string;
  };
};

// Función para obtener los detalles del enlace
async function getClaimDetails(
  linkCode: string
): Promise<IGetLinkDetailsResponse> {
  try {
    const details = await getLinkDetails({ link: linkCode });
    return details as unknown as IGetLinkDetailsResponse;
  } catch (error) {
    console.error("Error fetching link details:", error);
    throw error;
  }
}

// Función para generar los metadatos
export async function generateMetadata({
  params,
  searchParams,
}: Props): Promise<Metadata> {
  const headersList = headers();
  const domain =
    headersList.get("host") || process.env.NEXT_PUBLIC_URL || "localhost";
  const protocol = process.env.NODE_ENV === "development" ? "http" : "https";
  const baseUrl = `${protocol}://${domain}`;

  try {
    const linkCode = searchParams.l;
    if (!linkCode) throw new Error("No se proporcionó el código de enlace");

    const details = await getClaimDetails(linkCode);

    // Asegurar que los valores existen, de lo contrario usar valores predeterminados
    const amount = details.tokenAmount?.toString() ?? "0";
    const token = details.tokenSymbol?.toString() ?? "ETH";
    const chain = searchParams.chain ?? "1";

    // Codificar los parámetros para la URL
    const ogImageUrl = `${baseUrl}/api/og/claim?amount=${encodeURIComponent(
      amount
    )}&token=${encodeURIComponent(token)}&chain=${encodeURIComponent(chain)}`;

    // Construir los metadatos
    const title = `Reclama ${amount} ${token} en Bu.fi`;
    const description = `Alguien te envió ${amount} ${token}. ¡Haz clic para reclamar tus tokens!`;

    return {
      title,
      description,
      openGraph: {
        title,
        description,
        images: [{ url: ogImageUrl }],
        url: `${baseUrl}/${params.locale}/claim`,
        siteName: "Bu.fi",
        type: "website",
      },
      twitter: {
        card: "summary_large_image",
        title,
        description,
        images: [ogImageUrl],
      },
    };
  } catch (error) {
    console.error("Error generating metadata:", error);
    const fallbackTitle = "Reclama tus tokens en Bu.fi";
    const fallbackDescription =
      "Alguien te envió tokens. ¡Haz clic para reclamarlos!";
    const fallbackImage = `${baseUrl}/images/BooFi-icon.png`;

    return {
      title: fallbackTitle,
      description: fallbackDescription,
      openGraph: {
        title: fallbackTitle,
        description: fallbackDescription,
        images: [{ url: fallbackImage }],
        url: `${baseUrl}/${params.locale}/claim`,
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
