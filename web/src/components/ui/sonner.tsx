import { Toaster as Sonner, type ToasterProps } from "sonner"
import { CircleCheckIcon, InfoIcon, TriangleAlertIcon, OctagonXIcon, Loader2Icon } from "lucide-react"

const Toaster = ({ ...props }: ToasterProps) => {
  return (
    <Sonner
      // FIXO EM CLARO, e não `theme` do sistema. O app não tem modo escuro — só o toast seguia a
      // preferência do sistema operacional, e num Mac em modo escuro o sonner carregava as
      // variáveis do tema dele: verde CLARO, calibrado pra pousar em fundo preto. Como o fundo aqui
      // é forçado branco, dava verde claro sobre branco, ~1,9:1 de contraste. Quando o app ganhar
      // modo escuro de verdade, os dois passam a mudar juntos.
      theme="light"
      className="toaster group"
      // A cor de estado vive no ÍCONE, não no texto. Texto colorido é o que obriga a caçar um tom
      // que sirva de mensagem e de leitura ao mesmo tempo — e sempre perde de um lado. Com o texto
      // em tinta normal (21:1) e o ícone colorido, a informação chega por forma e por cor, e a
      // legibilidade deixa de depender da paleta de estado.
      icons={{
        success: (
          <CircleCheckIcon className="size-4 text-emerald-600" />
        ),
        info: (
          <InfoIcon className="size-4 text-[var(--brand)]" />
        ),
        warning: (
          <TriangleAlertIcon className="size-4 text-amber-600" />
        ),
        error: (
          <OctagonXIcon className="size-4 text-destructive" />
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
          // Fundo e borda seguem a linguagem do resto (superfície clara, tinta da marca) em vez do
          // bloco pastel do richColors. E o TEXTO vai pra tinta normal em todos os estados: sem
          // isto, ele herda a paleta do sonner, que foi calibrada pro fundo pastel que trocamos.
          "--success-bg": "var(--card)",
          "--success-border": "var(--foreground)",
          "--success-text": "var(--foreground)",
          "--error-bg": "var(--card)",
          "--error-border": "var(--foreground)",
          "--error-text": "var(--foreground)",
          "--warning-bg": "var(--card)",
          "--warning-border": "var(--foreground)",
          "--warning-text": "var(--foreground)",
          "--info-bg": "var(--card)",
          "--info-border": "var(--foreground)",
          "--info-text": "var(--foreground)",
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
