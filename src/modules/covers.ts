import { api } from "../api";
import { getDefaultTrackCover, setActiveTheme } from "../assets";
import { mapStoredCover } from "../mappers";
import { state } from "../state";
import type { CoverKind } from "../types";
import { elements as playerbarElements } from "../elements/playerbar";
import { elements as sidebarElements } from "../elements/sidebar";
import { showToast } from "../utils/toast";
import { updateTrackMetadata } from "./sidebar";
import { renderAddToPlaylistOptions, renderPlaylistDetail, renderPlaylists } from "./playlists";
import { renderRecentlyPlayed } from "./recentlyPlayed";
import { renderMediaLibrary } from "./tracks";
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
    const previousDefaultCover = getDefaultTrackCover();
    const covers = setActiveTheme(theme);
    elements.homeMediaLibraryCover.src = covers.mediaLibrary;
    elements.homeFavoritesCover.src = covers.favorites;
    elements.homeRemixesCover.src = covers.remixes;
    const nextDefaultCover = getDefaultTrackCover();
    const currentTrack = state.tracks.find((track) => track.id === state.currentTrackId);
    if (currentTrack) {
        updateTrackMetadata(currentTrack);
    }
    else {
        playerbarElements.playerCover.src = nextDefaultCover;
        sidebarElements.sidebarCover.src = nextDefaultCover;
        sidebarElements.sidebarCoverWrapper.classList.remove("has-cover");
    }
    if (previousDefaultCover !== nextDefaultCover) {
        document.querySelectorAll<HTMLImageElement>("img").forEach((image) => {
            if (image.getAttribute("src") === previousDefaultCover || image.src === previousDefaultCover)
                image.src = nextDefaultCover;
        });
    }
    renderMediaLibrary();
    renderPlaylists();
    renderPlaylistDetail();
    renderAddToPlaylistOptions();
    renderRecentlyPlayed();
}
