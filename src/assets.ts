import { convertFileSrc } from "@tauri-apps/api/core";
import { FAVORITES_PLAYLIST_ID, REMIXES_PLAYLIST_ID } from "./core/constants";

const MEDIA_LIBRARY_COVER = new URL("./assets/media_library.png", import.meta.url).href;
export const FAVORITES_COVER = new URL("./assets/favorites.png", import.meta.url).href;
export const REMIXES_COVER = new URL("./assets/remixes.png", import.meta.url).href;

export function getDefaultTrackCover(): string {
    return MEDIA_LIBRARY_COVER;
}

export function getDefaultPlaylistCover(playlistId: string): string | undefined {
    if (playlistId === FAVORITES_PLAYLIST_ID)
        return FAVORITES_COVER;
    if (playlistId === REMIXES_PLAYLIST_ID)
        return REMIXES_COVER;
    return undefined;
}

const bundledCovers: Record<string, string> = {
    "./src/assets/favorites.jpg": FAVORITES_COVER,
    "./src/assets/favorites.png": FAVORITES_COVER,
    "./src/assets/remixes.jpg": REMIXES_COVER,
    "./src/assets/remixes.png": REMIXES_COVER,
};

export function resolveCoverSource(source: string): string {
    if (source === "./src/assets/media_library.jpg" || source === "./src/assets/media_library.png")
        return MEDIA_LIBRARY_COVER;
    const bundledCover = bundledCovers[source];
    if (bundledCover)
        return bundledCover;
    if (/^(https?:|data:|blob:)/i.test(source))
        return source;
    return convertFileSrc(source);
}
