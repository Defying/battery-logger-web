import * as React from "react"

import { cn } from "@/lib/utils"

interface ProgressProps extends React.HTMLAttributes<HTMLDivElement> {
  value?: number
  waiting?: boolean
}

const Progress = React.forwardRef<HTMLDivElement, ProgressProps>(
  ({ className, value = 0, waiting = false, ...props }, ref) => (
    <div
      ref={ref}
      className={cn(
        "relative h-2 w-full overflow-hidden rounded-full bg-secondary",
        className
      )}
      {...props}
    >
      <div
        className={cn(
          "h-full transition-all duration-300",
          waiting
            ? "w-full bg-gradient-to-r from-amber-500 via-purple-600 to-cyan-500 animate-gradient"
            : "bg-primary"
        )}
        style={waiting ? undefined : { width: `${value}%` }}
      />
    </div>
  )
)
Progress.displayName = "Progress"

export { Progress }
