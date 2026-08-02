import {
  CircleCheckIcon,
  InfoIcon,
  Loader2Icon,
  OctagonXIcon,
  TriangleAlertIcon,
} from "lucide-react"
import { useTheme } from "next-themes"
import { Toaster as Sonner, type ToasterProps } from "sonner"

const Toaster = ({ ...props }: ToasterProps) => {
  const { theme = "system" } = useTheme()

  return (
    <Sonner
      theme={theme as ToasterProps["theme"]}
      className="toaster group"
      toastOptions={{
        style: {
          minHeight: "44px",
          padding: "12px 14px",
          gap: "10px",
        },
      }}
      icons={{
        success: <CircleCheckIcon className="size-4" />,
        info: <InfoIcon className="size-4" />,
        warning: <TriangleAlertIcon className="size-4" />,
        error: <OctagonXIcon className="size-4" />,
        loading: <Loader2Icon className="size-4 animate-spin" />,
      }}
      style={
        {
          "--normal-bg": "rgba(255, 255, 255, 0.96)",
          "--normal-text": "#334155",
          "--normal-border": "rgba(125, 211, 252, 0.7)",
          "--success-bg": "#ecfdf5",
          "--success-text": "#047857",
          "--success-border": "#a7f3d0",
          "--error-bg": "rgba(255, 255, 255, 0.98)",
          "--error-text": "#be123c",
          "--error-border": "#fecdd3",
          "--warning-bg": "#fffbeb",
          "--warning-text": "#b45309",
          "--warning-border": "#fde68a",
          "--info-bg": "#f0f9ff",
          "--info-text": "#0369a1",
          "--info-border": "#bae6fd",
          "--border-radius": "var(--radius)",
          "--width": "320px",
        } as React.CSSProperties
      }
      {...props}
    />
  )
}

export { Toaster }
