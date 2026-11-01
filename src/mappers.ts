import { convertFileSrc } from "@tauri-apps/api/core";
import { resolveCoverSource } from "./assets";
import type { Playlist, StoredCover, StoredPlaylist, StoredTrack, Track } from "./types";

export function mapStoredTrack(track: StoredTrack): Track {
    return {
        ...track,
        artist: track.artist || "Неизвестный исполнитель",
        cover: track.cover ? resolveCoverSource(track.cover) : undefined,
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
