import { convertFileSrc } from "@tauri-apps/api/core";
import type { Playlist, StoredCover, StoredPlaylist, StoredTrack, Track } from "./types";

export function mapStoredTrack(track: StoredTrack): Track {
    return {
        ...track,
        artist: track.artist || "Неизвестный исполнитель",
    };
}

export function mapStoredPlaylist(playlist: StoredPlaylist): Playlist {
    return {
        id: playlist.id,
        title: playlist.name,
        category: playlist.category || "Плейлист",
        trackIds: playlist.id_tracks,
    };
}

export function mapStoredCover(cover: StoredCover) {
    return {
        ...cover,
        src: convertFileSrc(cover.path_file),
    };
}
