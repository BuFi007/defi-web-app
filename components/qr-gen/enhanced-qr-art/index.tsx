import React, { forwardRef } from 'react';
import { FramedQRCode } from "@/components/qr-gen/framed-qr-art";
import { Card, CardContent } from "@/components/ui/card";
import { ArrowDownToLine, ArrowUpFromLine, Wallet } from 'lucide-react';
import { truncateAddress } from "@/utils";

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
}

export const EnhancedQRCode = forwardRef<HTMLDivElement, EnhancedQRCodeProps>(
  ({ link, image, frameText, action, copyLink, amount, ensName, userAddress, token }, ref) => {
    const actionConfig = {
      pay: {
        icon: <ArrowUpFromLine className="w-6 h-6 text-green-500" />,
        text: "Get Paid",
        bgColor: "bg-green-100",
        textColor: "text-green-700",
      },
      request: {
        icon: <ArrowDownToLine className="w-6 h-6 text-blue-500" />,
        text: "Request Payment",
        bgColor: "bg-blue-100",
        textColor: "text-blue-700",
      },
    };

    const config = actionConfig[action];

    return (
      <Card className="w-full max-w-sm mx-auto" ref={ref}>
        <CardContent className="p-6">
          <div className="flex items-center justify-center mb-4">
            <Wallet className="w-8 h-8 text-primary mr-2" />
            <h2 className="text-2xl font-bold text-primary">BooFi</h2>
          </div>
          <div className={`rounded-lg ${config.bgColor} p-4 mb-4 flex items-center justify-center`}>
            {config.icon}
            <span className={`ml-2 font-semibold ${config.textColor}`}>{config.text}</span>
          </div>
          {amount && (
            <div className="text-center mb-4">
              <span className="text-2xl font-bold">{amount} {token || 'ETH'}</span>
            </div>
          )}
          <div className="relative">
            <FramedQRCode
              image={image}
              link={link}
              frameText={frameText}
              copyLink={copyLink}
            />
            <div className="absolute inset-0 flex items-center justify-center opacity-0 hover:opacity-100 transition-opacity duration-300 bg-black bg-opacity-50 rounded-lg">
              <span className="text-white text-sm font-medium">Click to copy link</span>
            </div>
          </div>
          <p className="text-center text-sm text-gray-500 mt-4">
            Scan this QR code to {action === 'pay' ? 'pay' : 'request payment from'} this BooFi user
          </p>
          {(ensName || userAddress) && (
            <p className="text-center text-sm text-gray-500 mt-2">
              {ensName || truncateAddress(userAddress || '')}
            </p>
          )}
        </CardContent>
      </Card>
    );
  }
);

EnhancedQRCode.displayName = 'EnhancedQRCode';

