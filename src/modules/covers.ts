import { api } from "../api";
import { mapStoredCover } from "../mappers";
import { state } from "../state";
import type { CoverKind } from "../types";
import { showToast } from "../utils/toast";
import { updateTrackMetadata } from "./sidebar";
import { renderPlaylistDetail, renderPlaylists } from "./playlists";
import { renderRecentlyPlayed } from "./recentlyPlayed";
import { open } from "@tauri-apps/plugin-dialog";
import { elements } from "../elements/home";

const themeCovers: Record<string, { mediaLibrary: string; favorites: string; remixes: string }> = {
    "theme-purple": {
        mediaLibrary: new URL("../assets/purple/media_library_purple.jpg", import.meta.url).href,
        favorites: new URL("../assets/purple/favorites_purple.jpg", import.meta.url).href,
        remixes: new URL("../assets/purple/remixes_purple.jpg", import.meta.url).href,
    },
    "theme-emerald": {
        mediaLibrary: new URL("../assets/green/media_library_green.jpg", import.meta.url).href,
        favorites: new URL("../assets/green/favorites_green.jpg", import.meta.url).href,
        remixes: new URL("../assets/green/remixes_green.jpg", import.meta.url).href,
    },
    "theme-red": {
        mediaLibrary: new URL("../assets/red/media_library_red.jpg", import.meta.url).href,
        favorites: new URL("../assets/red/favorites_red.jpg", import.meta.url).href,
        remixes: new URL("../assets/red/remixes_red.jpg", import.meta.url).href,
    },
    "theme-blue": {
        mediaLibrary: new URL("../assets/blue/media_library_blue.jpg", import.meta.url).href,
        favorites: new URL("../assets/blue/favorites_blue.jpg", import.meta.url).href,
        remixes: new URL("../assets/blue/remixes_blue.jpg", import.meta.url).href,
    },
    "theme-orange": {
        mediaLibrary: new URL("../assets/orange/media_library_orange.jpg", import.meta.url).href,
        favorites: new URL("../assets/orange/favorites_orange.jpg", import.meta.url).href,
        remixes: new URL("../assets/orange/remixes_orange.jpg", import.meta.url).href,
    },
    "theme-pink": {
        mediaLibrary: new URL("../assets/pink/media_library_pink.jpg", import.meta.url).href,
        favorites: new URL("../assets/pink/favorites_pink.jpg", import.meta.url).href,
        remixes: new URL("../assets/pink/remixes_pink.jpg", import.meta.url).href,
    },
    "theme-yellow": {
        mediaLibrary: new URL("../assets/yellow/media_library_yellow.jpg", import.meta.url).href,
        favorites: new URL("../assets/yellow/favorites_yellow.jpg", import.meta.url).href,
        remixes: new URL("../assets/yellow/remixes_yellow.jpg", import.meta.url).href,
    },
};

// Изменение обложки для трека или плейлиста
export async function changeCover(kind: CoverKind, entityId: string) {
    const filePath = await open({
        multiple: false,
        filters: [{ name: "Изображения", extensions: ["jpg", "jpeg", "png", "webp"] }],
    });
    if (typeof filePath !== "string")
        return;
    const storedCover = await api.setCover(kind, entityId, filePath);
    const coverSrc = mapStoredCover(storedCover).src;
    if (kind === "track") {
        const track = state.tracks.find((item) => item.id === entityId);
        if (!track)
            return;
        track.cover = coverSrc;
        if (state.currentTrackId === entityId)
            updateTrackMetadata(track);
        renderRecentlyPlayed();
    }
    else {
        const playlist = state.playlists.find((item) => item.id === entityId);
        if (!playlist)
            return;
        playlist.cover = coverSrc;
        renderPlaylists();
        renderPlaylistDetail();
        renderRecentlyPlayed();
    }
    showToast("Обложка сохранена");
}

// Применение обложек в завимости от выбранной темы
export function applyThemeCovers(theme: string): void {
    const covers = themeCovers[theme];
    if (!covers) {
        throw new Error(`Не найдены обложки для темы: ${theme}`);
    }

    elements.homeMediaLibraryCover.src = covers.mediaLibrary;
    elements.homeFavoritesCover.src = covers.favorites;
    elements.homeRemixesCover.src = covers.remixes;
}
