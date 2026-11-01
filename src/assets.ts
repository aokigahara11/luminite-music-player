import { convertFileSrc } from "@tauri-apps/api/core";

export const DEFAULT_TRACK_COVER = new URL("./assets/media_library.jpg", import.meta.url).href;
export const FAVORITES_COVER = new URL("./assets/favorites.jpg", import.meta.url).href;
export const REMIXES_COVER = new URL("./assets/remixes.jpg", import.meta.url).href;

const bundledCovers: Record<string, string> = {
    "./src/assets/media_library.jpg": DEFAULT_TRACK_COVER,
    "./src/assets/favorites.jpg": FAVORITES_COVER,
    "./src/assets/remixes.jpg": REMIXES_COVER,
};

export function resolveCoverSource(source: string): string {
    const bundledCover = bundledCovers[source];
    if (bundledCover)
        return bundledCover;
    if (/^(https?:|data:|blob:)/i.test(source))
        return source;
    return convertFileSrc(source);
}
