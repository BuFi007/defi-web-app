import { useId } from "react";
import { cn } from "@/utils";

interface SpiderwebPatternProps {
  width?: number;
  height?: number;
  x?: number;
  y?: number;
  strokeDasharray?: number | string;
  className?: string;
  [key: string]: any;
}

export function SpiderwebPattern({
  width = 80,
  height = 80,
  x = -1,
  y = -1,
  strokeDasharray = 0,
  className,
  ...props
}: SpiderwebPatternProps) {
  const id = useId();

  const cx = width / 2;
  const cy = height / 2;
  const maxR = Math.min(width, height) / 2;
  const rings = [0.32, 0.58, 0.84].map((t) => t * maxR);
  const sin45 = Math.SQRT1_2;

  const ringPath = (r: number) => {
    const px = (cx + r * sin45).toFixed(2);
    const py = (cy + r * sin45).toFixed(2);
    const nx = (cx - r * sin45).toFixed(2);
    const ny = (cy - r * sin45).toFixed(2);
    return [
      `M${cx - r} ${cy}`,
      `L${nx} ${ny}`,
      `L${cx} ${cy - r}`,
      `L${px} ${ny}`,
      `L${cx + r} ${cy}`,
      `L${px} ${py}`,
      `L${cx} ${cy + r}`,
      `L${nx} ${py}`,
      "Z",
    ].join(" ");
  };

  const spokes = [
    `M${cx} ${cy} L0 0`,
    `M${cx} ${cy} L${width} 0`,
    `M${cx} ${cy} L0 ${height}`,
    `M${cx} ${cy} L${width} ${height}`,
    `M${cx} ${cy} L${cx} 0`,
    `M${cx} ${cy} L${cx} ${height}`,
    `M${cx} ${cy} L0 ${cy}`,
    `M${cx} ${cy} L${width} ${cy}`,
  ].join(" ");

  const d = [spokes, ...rings.map(ringPath)].join(" ");

  return (
    <svg
      aria-hidden="true"
      className={cn(
        "pointer-events-none absolute inset-0 h-full w-full fill-none stroke-purpleDanis/30 dark:stroke-violetDanis/75",
        className,
      )}
      {...props}
    >
      <defs>
        <pattern
          id={id}
          width={width}
          height={height}
          patternUnits="userSpaceOnUse"
          x={x}
          y={y}
        >
          <path
            d={d}
            fill="none"
            strokeWidth={0.9}
            strokeLinejoin="round"
            strokeLinecap="round"
            strokeDasharray={strokeDasharray}
          />
        </pattern>
      </defs>
      <rect width="100%" height="100%" strokeWidth={0} fill={`url(#${id})`} />
    </svg>
  );
}

export default SpiderwebPattern;
