"use client"

import { useTheme } from "next-themes"
import { Toaster as Sonner, type ToasterProps } from "sonner"
import { CircleCheckIcon, InfoIcon, TriangleAlertIcon, OctagonXIcon, Loader2Icon } from "lucide-react"

// done: sonner's own distances from the edges (24px, and 16px on a narrow
// screen), measured from the safe area instead of the screen's edge, so a
// message never lands under the status bar, the notch or the home indicator.
// The insets are 0 on a Mac, where nothing moves.
const inset = (gap: string) => ({
  top: `calc(env(safe-area-inset-top) + ${gap})`,
  right: `calc(env(safe-area-inset-right) + ${gap})`,
  bottom: `calc(env(safe-area-inset-bottom) + ${gap})`,
  left: `calc(env(safe-area-inset-left) + ${gap})`,
})

const Toaster = ({ ...props }: ToasterProps) => {
  const { theme = "system" } = useTheme()

  return (
    <Sonner
      theme={theme as ToasterProps["theme"]}
      className="toaster group"
      icons={{
        success: (
          <CircleCheckIcon className="size-4" />
        ),
        info: (
          <InfoIcon className="size-4" />
        ),
        warning: (
          <TriangleAlertIcon className="size-4" />
        ),
        error: (
          <OctagonXIcon className="size-4" />
        ),
        loading: (
          <Loader2Icon className="size-4 animate-spin" />
        ),
      }}
      style={
        {
          "--normal-bg": "var(--popover)",
          "--normal-text": "var(--popover-foreground)",
          "--normal-border": "var(--border)",
          "--border-radius": "var(--radius)",
        } as React.CSSProperties
      }
      offset={inset("24px")}
      mobileOffset={inset("16px")}
      toastOptions={{
        classNames: {
          toast: "cn-toast",
        },
      }}
      {...props}
    />
  )
}

export { Toaster }
