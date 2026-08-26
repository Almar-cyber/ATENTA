import { avatarDoUsuario, useAvatarUri } from '@/lib/avatar';
import type { SessionUser } from '@/lib/auth';

/**
 * A bolinha do usuário: o peep dele, ou a inicial do nome enquanto o estilo não chega.
 *
 * A inicial é estado de CARREGANDO, não de "não tem avatar" — todo mundo tem um, personalizado ou
 * derivado do id (ver `avatarPadrao`). Ela existe porque o open-peeps.json é um chunk separado de
 * 92 KB, e no primeiro carregamento da sessão há uma fração de segundo antes de ele chegar.
 */
export function AvatarUsuario({ user, size = 20 }: { user: SessionUser; size?: number }) {
  // Pede o dobro do lado exibido: o SVG é vetor e não perde nitidez, mas o DiceBear escreve
  // width/height no elemento raiz, e pedir o tamanho exato deixa a borda dura em tela retina.
  const uri = useAvatarUri(avatarDoUsuario(user), size * 2);

  if (!uri) {
    return (
      <span
        style={{ width: size, height: size }}
        className="grid shrink-0 place-items-center rounded-full bg-primary text-[11px] font-bold text-primary-foreground"
      >
        {(user.name || user.email).trim().charAt(0).toUpperCase()}
      </span>
    );
  }
  return (
    <img
      src={uri}
      alt=""
      style={{ width: size, height: size }}
      className="shrink-0 rounded-full bg-secondary object-cover"
    />
  );
}
