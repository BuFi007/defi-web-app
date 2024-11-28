import { ImageResponse } from 'next/og';
import { NextRequest } from 'next/server';

export const runtime = 'edge';

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const amount = searchParams.get('amount') || '0';
  const token = searchParams.get('token') || 'ETH';
  const chain = searchParams.get('chain') || '1';

  return new ImageResponse(
    (
      <div
        style={{
          height: '100%',
          width: '100%',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: 'white',
          padding: '40px',
        }}
      >
        <img
          src={`${process.env.NEXT_PUBLIC_URL}/images/BooFi-icon.png`}
          alt="Bu.fi"
          width="128"
          height="128"
        />
        <h1 style={{ fontSize: 60, margin: '20px 0' }}>Claim Your Tokens!</h1>
        <h2 style={{ fontSize: 48, margin: '0 0 20px' }}>
          {amount} {token}
        </h2>
        <p style={{ fontSize: 32, color: '#666' }}>
          Someone sent you tokens on Bu.fi
        </p>
      </div>
    ),
    {
      width: 1200,
      height: 630,
    }
  );
}
