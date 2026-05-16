import React from 'react';
import { Button } from "@/components/ui/button";
import Image from "next/image";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";


interface ShareButtonProps {
  onClick: () => void;
  platform: 'whatsapp' | 'telegram' | 'download';
  isSharing?: boolean;
}

export function ShareButton({ onClick, platform, isSharing }: ShareButtonProps) {
  const platformConfig = {
    whatsapp: {
      color: 'text-green-600',
      hoverColor: 'hover:bg-green-100',
      icon: '/icons/whatsapp.svg',
      text: 'WhatsApp',
      tooltip: 'Share on WhatsApp',
    },
    telegram: {
      color: 'text-blue-600',
      hoverColor: 'hover:bg-blue-100',
      icon: '/icons/telegram.png',
      text: 'Telegram',
      tooltip: 'Share on Telegram',
    },
    download: {
      color: 'text-gray-600',
      hoverColor: 'hover:bg-gray-100',
      icon: '/icons/download.svg',
      text: 'Download',
      tooltip: 'Download QR Code',
    },
  };

  const config = platformConfig[platform];

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            onClick={onClick}
            className={`flex items-center gap-2 px-4 py-2 ${config.color} ${config.hoverColor} dark:hover:bg-gray-700`}
            aria-label={config.tooltip}
            disabled={isSharing}
          >
            <Image
              src={config.icon}
              alt={config.text}
              width={20}
              height={20}
            />
            {isSharing ? 'Sharing...' : config.text}
          </Button>
        </TooltipTrigger>
        <TooltipContent>
          <p>{config.tooltip}</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
