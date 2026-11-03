import { convertFileSrc } from "@tauri-apps/api/core";
import { FAVORITES_PLAYLIST_ID, REMIXES_PLAYLIST_ID } from "./core/constants";

export const DEFAULT_TRACK_COVER = new URL("./assets/media_library.jpg", import.meta.url).href;
export const FAVORITES_COVER = new URL("./assets/favorites.jpg", import.meta.url).href;
export const REMIXES_COVER = new URL("./assets/remixes.jpg", import.meta.url).href;

type ThemeCovers = { mediaLibrary: string; favorites: string; remixes: string };

const themeCovers: Record<string, ThemeCovers> = {
    "theme-purple": {
        mediaLibrary: new URL("./assets/purple/media_library_purple.jpg", import.meta.url).href,
        favorites: new URL("./assets/purple/favorites_purple.jpg", import.meta.url).href,
        remixes: new URL("./assets/purple/remixes_purple.jpg", import.meta.url).href,
    },
    "theme-emerald": {
        mediaLibrary: new URL("./assets/green/media_library_green.jpg", import.meta.url).href,
        favorites: new URL("./assets/green/favorites_green.jpg", import.meta.url).href,
        remixes: new URL("./assets/green/remixes_green.jpg", import.meta.url).href,
    },
    "theme-red": {
        mediaLibrary: new URL("./assets/red/media_library_red.jpg", import.meta.url).href,
        favorites: new URL("./assets/red/favorites_red.jpg", import.meta.url).href,
        remixes: new URL("./assets/red/remixes_red.jpg", import.meta.url).href,
    },
    "theme-blue": {
        mediaLibrary: new URL("./assets/blue/media_library_blue.jpg", import.meta.url).href,
        favorites: new URL("./assets/blue/favorites_blue.jpg", import.meta.url).href,
        remixes: new URL("./assets/blue/remixes_blue.jpg", import.meta.url).href,
    },
    "theme-orange": {
        mediaLibrary: new URL("./assets/orange/media_library_orange.jpg", import.meta.url).href,
        favorites: new URL("./assets/orange/favorites_orange.jpg", import.meta.url).href,
        remixes: new URL("./assets/orange/remixes_orange.jpg", import.meta.url).href,
    },
    "theme-pink": {
        mediaLibrary: new URL("./assets/pink/media_library_pink.jpg", import.meta.url).href,
        favorites: new URL("./assets/pink/favorites_pink.jpg", import.meta.url).href,
        remixes: new URL("./assets/pink/remixes_pink.jpg", import.meta.url).href,
    },
    "theme-yellow": {
        mediaLibrary: new URL("./assets/yellow/media_library_yellow.jpg", import.meta.url).href,
        favorites: new URL("./assets/yellow/favorites_yellow.jpg", import.meta.url).href,
        remixes: new URL("./assets/yellow/remixes_yellow.jpg", import.meta.url).href,
    },
};

let activeTheme = "theme-purple";

export function setActiveTheme(theme: string): ThemeCovers {
    const covers = themeCovers[theme];
    if (!covers)
        throw new Error(`Не найдены обложки для темы: ${theme}`);
    activeTheme = theme;
    return covers;
}

export function getThemedPlaylistCover(playlistId: string): string | undefined {
    const covers = themeCovers[activeTheme];
    if (playlistId === FAVORITES_PLAYLIST_ID)
        return covers.favorites;
    if (playlistId === REMIXES_PLAYLIST_ID)
        return covers.remixes;
    return undefined;
}

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
