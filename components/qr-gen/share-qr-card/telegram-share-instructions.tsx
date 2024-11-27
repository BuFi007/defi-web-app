import React from 'react';
import { Share, MessageCircle, Image, Send, X } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface TelegramShareInstructionsProps {
  isOpen: boolean;
  onClose: () => void;
}

export function TelegramShareInstructions({ isOpen, onClose }: TelegramShareInstructionsProps) {
  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent size="sm">
        <DialogHeader className="space-y-4">
          <div className="flex items-center space-x-2">
            <div className="p-2 rounded-full bg-blue-100">
              <Share className="w-5 h-5 text-blue-600" />
            </div>
            <DialogTitle className="text-xl font-semibold">
              Share QR Code on Telegram
            </DialogTitle>
          </div>
          <DialogDescription className="text-base text-gray-600">
            Follow these simple steps to share your QR code on Telegram
          </DialogDescription>
        </DialogHeader>
        
        <div className="mt-6 space-y-6">
          {[
            {
              icon: <Image className="w-5 h-5 text-gray-600" />,
              title: "QR Code Downloaded",
              description: "The QR code image is now saved on your device"
            },
            {
              icon: <MessageCircle className="w-5 h-5 text-gray-600" />,
              title: "Open Telegram Chat",
              description: "Navigate to the chat where you want to share the code"
            },
            {
              icon: <Share className="w-5 h-5 text-gray-600" />,
              title: "Access Gallery or Downloads",
              description: "Tap the attachment icon and select 'Gallery' or 'Photos' if on Mobile or Downloads if on Desktop"
            },
            {
              icon: <Send className="w-5 h-5 text-gray-600" />,
              title: "Send QR Code",
              description: "Select the QR code and add an optional message"
            }
          ].map((step, index) => (
            <div key={index} className="flex items-start space-x-4">
              <div className="flex-shrink-0 w-8 h-8 rounded-full bg-blue-50 flex items-center justify-center">
                {step.icon}
              </div>
              <div className="flex-1 space-y-1">
                <h3 className="font-medium text-gray-900">{step.title}</h3>
                <p className="text-sm text-gray-500">{step.description}</p>
              </div>
            </div>
          ))}
        </div>

        <button
          onClick={onClose}
          className="mt-6 w-full inline-flex items-center justify-center px-4 py-2.5 border border-transparent text-sm font-medium rounded-lg text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 transition-colors"
        >
          Got it
        </button>
      </DialogContent>
    </Dialog>
  );
}

export default TelegramShareInstructions;