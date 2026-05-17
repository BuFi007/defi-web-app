'use client';

import type { WidgetConfig } from '@lifi/widget';
import dynamic from 'next/dynamic';
import { ClientOnly } from './ClientOnly';
import { usePathname } from 'next/navigation';
import { useMemo } from 'react';
import {
  AvalancheTokens,
  BaseTokens,
  ArbitrumTokens,
} from '@/constants/Tokens';

const LiFiWidget = dynamic(
  () => import('@lifi/widget').then((m) => ({ default: m.LiFiWidget })),
  { ssr: false },
);

const WidgetSkeleton = dynamic(
  () => import('@lifi/widget').then((m) => ({ default: m.WidgetSkeleton })),
  { ssr: false },
);

type SupportedLanguage = "en" | "es" | "pt";

const FEATURED_TOKENS = [
  ...AvalancheTokens.map(token => ({
    chainId: token.chainId,
    address: token.address,
    symbol: token.symbol,
    decimals: token.decimals,
    name: token.name,
  })),
  ...BaseTokens.map(token => ({
    chainId: token.chainId,
    address: token.address,
    symbol: token.symbol,
    decimals: token.decimals,
    name: token.name,
  })),
  ...ArbitrumTokens.map(token => ({
    chainId: token.chainId,
    address: token.address,
    symbol: token.symbol,
    decimals: token.decimals,
    name: token.name,
  })),
];

export const LiFiSwap = () => {
  const pathname = usePathname();

  const language: SupportedLanguage = useMemo(() => {
    const pathSegments = pathname?.split('/') || [];
    const langCode = pathSegments[1]?.toLowerCase();
    if (langCode === 'es') return 'es';
    if (langCode === 'pt') return 'pt';
    return 'en';
  }, [pathname]);

  const widgetConfig: WidgetConfig = useMemo(() => ({
    integrator: 'bu.finance',
    theme: {
      palette: {
        primary: { main: 'hsl(var(--primary))' },
        secondary: { main: 'hsl(var(--secondary))' },
        background: {
          default: 'hsl(var(--background))',
          paper: 'hsl(var(--card))'
        },
        text: {
          primary: 'hsl(var(--foreground))',
          secondary: 'hsl(var(--muted-foreground))'
        },
        grey: {
          200: 'hsl(var(--muted))',
          300: 'hsl(var(--border))',
          700: 'hsl(var(--muted-foreground))',
          800: 'hsl(var(--foreground))'
        }
      },
      shape: {
        borderRadius: 10,
        borderRadiusSecondary: 8,
        borderRadiusTertiary: 16
      },
      typography: {
        fontFamily: '"Clash Display", sans-serif, "Aeonik", sans-serif, Geist, sans-serif'
      },
      container: {
        boxShadow: '0px 1px 2px 0px rgba(16, 24, 40, 0.05)',
        borderRadius: '16px'
      },
      components: {
        MuiCard: {
          defaultProps: { variant: 'outlined' },
          styleOverrides: {
            root: {
              backgroundColor: 'hsl(var(--card))',
              borderColor: 'hsl(var(--border))'
            }
          }
        },
        MuiInputCard: {
          styleOverrides: {
            root: {
              backgroundColor: 'hsl(var(--card))',
              borderColor: 'hsl(var(--border))'
            }
          }
        },
        MuiButton: {
          styleOverrides: {
            root: {
              borderRadius: 'calc(var(--radius) - 2px)',
              fontWeight: 500
            }
          }
        }
      }
    },
    appearance: 'auto',
    chains: {
      from: {
        allow: [
          42161,  // Arbitrum
          8453,   // Base
          43114,  // Avalanche
        ],
      },
      to: {
        allow: [
          42161,  // Arbitrum
          8453,   // Base
          43114,  // Avalanche
        ],
      }
    },
    tokens: {
      featured: FEATURED_TOKENS,
    },
    languages: {
      default: language,
      allow: ['en', 'es', 'pt'] as const,
    },
    variant: 'compact',
    routePriority: 'FASTEST',
    hiddenUI: ['walletMenu', 'poweredBy', 'drawerCloseButton'],
  }), [language]);

  return (
    <>
      <ClientOnly fallback={<WidgetSkeleton config={widgetConfig} />}>
        <LiFiWidget config={widgetConfig} integrator={'bu.finance'} />
      </ClientOnly>
    </>
  );
};