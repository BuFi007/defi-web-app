import React, { forwardRef } from 'react';
import { FramedQRCode } from "@/components/qr-gen/framed-qr-art";
import { Card, CardContent } from "@/components/ui/card";
import { DollarSign } from 'lucide-react';
import { truncateAddress } from "@/utils";
import Image from 'next/image';

interface EnhancedQRCodeProps {
  link: string;
  image: string;
  frameText?: string;
  action: 'pay' | 'request';
  copyLink: () => void;
  amount?: string;
  ensName?: string;
  userAddress?: string;
  token?: string;
  title?: string;
}

export const EnhancedQRCode = forwardRef<HTMLDivElement, EnhancedQRCodeProps>(
  ({ link, image, frameText, action, copyLink, amount, ensName, userAddress, token, title }, ref) => {
    const actionConfig = {
      pay: {
        icon: <DollarSign className="w-6 h-6 text-green-500 mr-2" />,
        text: "Get Paid",
        bgColor: "bg-green-100",
        textColor: "text-green-700",
      },
      request: {
        icon: <DollarSign className="w-6 h-6 text-blue-500 mr-2" />,
        text: "Request Payment",
        bgColor: "bg-blue-100",
        textColor: "text-blue-700",
      },
    };

    const config = actionConfig[action];

    return (
      <Card className="w-full" ref={ref}>
        <CardContent className="p-6">
          <div className="flex items-center justify-center mb-4">
            <Image src="/images/BooFi-icon.png" alt="BooFi" width={64} height={64} />
            <span className="inline-block font-clash bg-gradient-to-r text-xl from-indigo-300 via-purple-400 to-cyan-300 bg-clip-text text-transparent">
              bu.fi
            </span>
          </div>
          <div className={`rounded-lg ${config.bgColor} p-2 items-center justify-center inline-flex`}>
            {config.icon}
            <span className={`font-semibold ${config.textColor}`}>{config.text}</span>
            {amount && (
              <span className="inline-block font-clash bg-gradient-to-r text-xl from-indigo-300 via-purple-400 to-cyan-300 bg-clip-text text-transparent ml-4">{amount} {token || 'ETH'}</span>
          )}
          </div>
          <div className="relative">
            <FramedQRCode
              image={image}
              link={link}
              frameText={frameText}
              copyLink={copyLink}
            />
         
          </div>
          <p className="text-center text-sm text-gray-500">
            Scan this QR code to {action === 'pay' ? 'pay' : 'request payment from'} this Bu user:
          </p>
          {(ensName || userAddress) && (
            <p className="text-center text-sm text-gray-500">
              {ensName && ensName.length > 12 ? truncateAddress(ensName) : truncateAddress(userAddress || '')}
            </p>
          )}
        </CardContent>
      </Card>
    );
  }
);

EnhancedQRCode.displayName = 'EnhancedQRCode';

