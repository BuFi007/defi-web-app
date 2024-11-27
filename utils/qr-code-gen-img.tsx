import * as htmlToImage from 'html-to-image';

export async function generateQRImage(element: HTMLElement): Promise<string> {
  try {
    const dataUrl = await htmlToImage.toPng(element);
    return dataUrl;
  } catch (error) {
    console.error('Error generating QR code image:', error);
    throw error;
  }
}