import { isVideoMime } from './platforms';

export interface MediaMetadata {
  duration_seconds?: number;
  width?: number;
  height?: number;
}

// Reads intrinsic duration/dimensions from a File before it's queued, so platform limits can be
// hinted client-side and the values can ride along to the server on upload. Resolves to {} on
// any failure — metadata is an enhancement, never a reason to block picking/replacing a file.
export async function readMediaMetadata(file: File): Promise<MediaMetadata> {
  if (isVideoMime(file.type)) return readVideoMetadata(file);
  if (file.type.startsWith('image/')) return readImageMetadata(file);
  return {};
}

function readVideoMetadata(file: File): Promise<MediaMetadata> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const video = document.createElement('video');
    video.preload = 'metadata';
    video.onloadedmetadata = () => {
      resolve({ duration_seconds: video.duration, width: video.videoWidth, height: video.videoHeight });
      URL.revokeObjectURL(url);
    };
    video.onerror = () => {
      resolve({});
      URL.revokeObjectURL(url);
    };
    video.src = url;
  });
}

async function readImageMetadata(file: File): Promise<MediaMetadata> {
  try {
    const bitmap = await createImageBitmap(file);
    const meta = { width: bitmap.width, height: bitmap.height };
    bitmap.close();
    return meta;
  } catch {
    return {};
  }
}
