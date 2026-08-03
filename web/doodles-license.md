# Doodles da landing

Ilustrações do **[Open Doodles](https://www.opendoodles.com/)**, de Pablo Stanley.

**Licença: CC0 (domínio público).** "Free for Commercial and Personal Use. No need to credit,
license, or anything." Não precisamos creditar — o arquivo existe só para registrar de onde vieram,
já que foram alteradas.

## O que foi alterado

Recoloridas para a paleta da marca e otimizadas:

| Original | Aqui |
| --- | --- |
| `#000000` (traço) | `#52277F` (roxo `--brand`) |
| `#FF5678` (destaque rosa) | `#FCEC0E` (amarelo `--primary`) |

Depois passaram por `svgo --multipass -p 2` (queda de ~60% no tamanho). Para trazer uma nova:

```bash
curl -sfL https://opendoodles.s3-us-west-1.amazonaws.com/NOME.svg \
  | sed -e 's/#000000/#52277F/g' -e 's/#FF5678/#FCEC0E/g' > NOME.svg
npx svgo NOME.svg
```

E some o caminho `/doodles/NOME.svg` em `LANDING_PUBLIC_ASSETS` (`src/worker.ts`) — sem isso o
arquivo cai no gate de senha e o visitante vê imagem quebrada.

## Por que SVG e não os GIFs animados

O Open Doodles oferece GIF em alguns doodles, mas só o `levitate` dos cinco que usamos tem (os
outros respondem 403). E GIF é raster: o traço fica preto e o destaque rosa, sem como recolorir
para roxo/amarelo. O movimento aqui vem de CSS sobre o SVG, que mantém a cor da marca, pesa quase
nada e obedece `prefers-reduced-motion`.
