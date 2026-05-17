/**
 * Ambient declarations so this package's own `tsc --noEmit` accepts
 * static asset imports. At runtime, Next.js / Turbopack supply the
 * real loader (SVG → URL string, PNG → StaticImageData).
 */

declare module "*.svg" {
  const src: string;
  export default src;
}

declare module "*.png" {
  const src: {
    src: string;
    height: number;
    width: number;
    blurDataURL?: string;
  };
  export default src;
}
