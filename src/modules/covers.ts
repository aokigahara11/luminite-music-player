import { api } from "../api";
import { setActiveTheme } from "../assets";
import { mapStoredCover } from "../mappers";
import { state } from "../state";
import type { CoverKind } from "../types";
import { showToast } from "../utils/toast";
import { updateTrackMetadata } from "./sidebar";
import { renderAddToPlaylistOptions, renderPlaylistDetail, renderPlaylists } from "./playlists";
import { renderRecentlyPlayed } from "./recentlyPlayed";
import { open } from "@tauri-apps/plugin-dialog";
import { elements } from "../elements/home";

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

// Применение обложек в зависимости от выбранной темы
export function applyThemeCovers(theme: string): void {
    const covers = setActiveTheme(theme);
    elements.homeMediaLibraryCover.src = covers.mediaLibrary;
    elements.homeFavoritesCover.src = covers.favorites;
    elements.homeRemixesCover.src = covers.remixes;
    renderPlaylists();
    renderAddToPlaylistOptions();
    renderRecentlyPlayed();
}
