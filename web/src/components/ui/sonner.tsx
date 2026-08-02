import { useTheme } from "next-themes"
import { Toaster as Sonner, type ToasterProps } from "sonner"
import { CircleCheckIcon, InfoIcon, TriangleAlertIcon, OctagonXIcon, Loader2Icon } from "lucide-react"

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
          "--normal-bg": "var(--card)",
          "--normal-text": "var(--foreground)",
          "--normal-border": "var(--foreground)",
          "--border-radius": "var(--radius)",
          // richColors: mantém o verde/vermelho no ícone e no texto, mas o fundo e a borda seguem
          // a linguagem do resto (superfície clara, contorno preto) em vez de um bloco pastel.
          "--success-bg": "var(--card)",
          "--success-border": "var(--foreground)",
          "--error-bg": "var(--card)",
          "--error-border": "var(--foreground)",
          "--warning-bg": "var(--card)",
          "--warning-border": "var(--foreground)",
          "--info-bg": "var(--card)",
          "--info-border": "var(--foreground)",
        } as React.CSSProperties
      }
      toastOptions={{
        classNames: {
          // Mesma estética dos botões e cards. O `!` é necessário: o sonner traz o próprio
          // box-shadow difuso na folha de estilo dele, com especificidade maior que a utilitária.
          toast: "border-2! border-brand! rounded-xl! shadow-[4px_4px_0_0_var(--brand)]!",
        },
      }}
      {...props}
    />
  )
}

export { Toaster }
