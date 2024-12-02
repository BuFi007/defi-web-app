import { ImageResponse } from "next/og";
import { NextRequest } from "next/server";

// Especificar que este endpoint se ejecuta en el runtime de Edge
export const runtime = "edge";

export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;

  // Obtener y validar los parámetros de búsqueda con valores predeterminados
  const amount = searchParams.get("amount") ?? "0";
  const token = searchParams.get("token") ?? "ETH";
  const chain = searchParams.get("chain") ?? "1";

  const baseUrl = origin;

  return new ImageResponse(
    (
      <div
        style={{
          height: "100%",
          width: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: "white",
          padding: "40px",
        }}
      >
        <img
          src={`${baseUrl}/images/BooFi-icon.png`}
          alt="Bu.fi"
          width="128"
          height="128"
        />
        <h1 style={{ fontSize: 60, margin: "20px 0" }}>¡Reclama Tus Tokens!</h1>
        <h2 style={{ fontSize: 48, margin: "0 0 20px" }}>
          {amount} {token}
        </h2>
        <p style={{ fontSize: 32, color: "#666" }}>
          Alguien te envió tokens en Bu.fi
        </p>
      </div>
    ),
    {
      width: 1200,
      height: 630,
    }
  );
}
