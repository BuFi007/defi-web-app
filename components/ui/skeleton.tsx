import React, { forwardRef } from "react";
import { cn } from "@/utils";

const Skeleton = forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => {
    return (
      <div
        ref={ref}
        className={cn(
          "rounded-md bg-primary/10 animate-pulse bg-gradient-to-br from-indigo-100 via-violet-200 to-gray-300",
          className
        )}
        {...props}
      />
    );
  }
);

Skeleton.displayName = "Skeleton";

export { Skeleton };

