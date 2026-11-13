import { api } from "../api";
import { mapStoredCover } from "../mappers";
import { state } from "../state";
import type { CoverKind } from "../types";
import { showToast } from "../utils/toast";
import { updateTrackMetadata } from "./sidebar";
import { renderPlaylistDetail, renderPlaylists } from "./playlists";
import { renderRecentlyPlayed } from "./recentlyPlayed";
import { open } from "@tauri-apps/plugin-dialog";

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
