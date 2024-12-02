'use client';

import { useState, useCallback } from 'react';
import { generateQRImage } from '@/utils/qr-code-gen-img';
import { ShareOptions } from '@/lib/types';

export function useQRCodeSharing() {
  const [isSharing, setIsSharing] = useState(false);

  const shareOnWhatsApp = useCallback(async (qrCodeElement: HTMLElement, options: ShareOptions) => {
    setIsSharing(true);
    try {
      const whatsappUrl = `https://api.whatsapp.com/send?text=${encodeURIComponent(
        `${options.message}\n${options.link}`
      )}`;
      window.open(whatsappUrl, '_blank');
    } catch (error) {
      console.error('Error sharing on WhatsApp:', error);
    } finally {
      setIsSharing(false);
    }
  }, []);

  const shareOnTelegram = useCallback(async (qrCodeElement: HTMLElement, options: ShareOptions) => {
    setIsSharing(true);
    try {
      const telegramUrl = `https://t.me/share/url?url=${encodeURIComponent(options.link)}&text=${encodeURIComponent(options.message)}`;
      window.open(telegramUrl, '_blank');
    } catch (error) {
      console.error('Error sharing on Telegram:', error);
    } finally {
      setIsSharing(false);
    }
  }, []);

  const shareOnDownload = useCallback(async (qrCodeElement: HTMLElement) => {
    setIsSharing(true);
    try {
      const imageDataUrl = await generateQRImage(qrCodeElement);
      const a = document.createElement('a');
      a.href = imageDataUrl;
      a.download = 'bu-pay-qr-code.png';
      a.click();
    } catch (error) {
      console.error('Error sharing on Telegram:', error);
    } finally {
      setIsSharing(false);
    }
  }, []);

  return { isSharing, shareOnWhatsApp, shareOnTelegram, shareOnDownload };
}

