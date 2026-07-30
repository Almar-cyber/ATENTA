import { useEffect, useState } from 'react';
import type { QueuedMedia } from './types';

// Resolves a QueuedMedia to a displayable URL. For un-uploaded files it makes an object URL and
// revokes it on cleanup; for already-uploaded assets it uses public_url directly. Shared by
// PostPreview and MediaQueueGrid so the object-URL lifecycle only lives in one place.
export function useMediaUrl(item: QueuedMedia | undefined): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!item) {
      setUrl(null);
      return;
    }
    if (item.file) {
      const u = URL.createObjectURL(item.file);
      setUrl(u);
      return () => URL.revokeObjectURL(u);
    }
    setUrl(item.public_url ?? null);
  }, [item]);
  return url;
}
