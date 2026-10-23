import { invoke } from "@tauri-apps/api/core";
import type {
    CoverKind,
    AudioStatus,
    PlayerConfig,
    PlaylistCategory,
    RecentEntry,
    RecentItemKind,
    StoredCover,
    StoredPlaylist,
    StoredTrack,
} from "./types";

export const api = {
    playAudio: (path: string, positionSecs: number, shouldPlay: boolean, volume: number) =>
        invoke<AudioStatus>("play_audio", { path, positionSecs, shouldPlay, volume }),
    pauseAudio: () => invoke<AudioStatus>("pause_audio"),
    resumeAudio: () => invoke<AudioStatus>("resume_audio"),
    stopAudio: () => invoke<AudioStatus>("stop_audio"),
    seekAudio: (positionSecs: number) => invoke<AudioStatus>("seek_audio", { positionSecs }),
    setAudioVolume: (volume: number) => invoke<AudioStatus>("set_audio_volume", { volume }),
    setEqualizer: (gains: number[]) => invoke<AudioStatus>("set_equalizer", { gains }),
    setTransitionDuration: (durationSecs: number) =>
        invoke<AudioStatus>("set_transition_duration", { durationSecs }),
    getLibrary: () => invoke<StoredTrack[]>("get_library"),
    getPlaylists: () => invoke<StoredPlaylist[]>("get_playlists"),
    getCovers: () => invoke<StoredCover[]>("get_covers"),
    getPlayerConfig: () => invoke<PlayerConfig>("get_player_config"),
    getRecentlyPlayed: () => invoke<RecentEntry[]>("get_recently_played"),
    savePlayerConfig: (config: PlayerConfig) => invoke<void>("save_player_config", {
        currentTrackId: config.current_track_id,
        positionSecs: config.position_secs,
        volume: config.volume,
        isPlaying: config.is_playing,
    }),
    setCover: (kind: CoverKind, entityId: string, filePath: string) =>
        invoke<StoredCover>("set_cover", { kind, entityId, filePath }),
    importTrack: (filePath: string) => invoke<StoredTrack>("import_track", { filePath }),
    createAndRenderRemix: (
        filePath: string,
        trackTitle: string,
        trackArtist: string,
        speedType: "normal" | "slowed" | "speed_up",
        effects: string[],
    ) =>
        invoke<StoredTrack>("create_and_render_remix", { filePath, trackTitle, trackArtist, speedType, effects }),
    deleteTrack: (trackId: string) => invoke<StoredTrack[]>("delete_track", { trackId }),
    removeTrackFromPlaylist: (playlistId: string, trackId: string) =>
        invoke<void>("remove_track_from_playlist", { playlistId, trackId }),
    addTrackToPlaylist: (playlistId: string, trackId: string) =>
        invoke<void>("add_track_to_playlist", { playlistId, trackId }),
    recordRecentlyPlayed: (kind: RecentItemKind, entityId: string) =>
        invoke<RecentEntry[]>("record_recently_played", { kind, entityId }),
    editTrack: (id: string, title: string, artist: string) =>
        invoke<StoredTrack>("edit_metadata_track", { id, title, artist }),
    getNextTrackId: (options: {
        trackIds: string[];
        currentTrackId: string | null;
        repeatMode: "off" | "all" | "one";
        shuffleEnabled: boolean;
        naturalEnd: boolean;
    }) => invoke<string | null>("get_next_track_id", options),
    getPreviousTrackId: (trackIds: string[], currentTrackId: string | null, shuffleEnabled: boolean) =>
        invoke<string | null>("get_previous_track_id", { trackIds, currentTrackId, shuffleEnabled }),
    editPlaylist: (id: string, name: string, category: PlaylistCategory) =>
        invoke<StoredPlaylist>("edit_metadata_playlist", { id, name, category }),
    createPlaylist: (name: string, category: PlaylistCategory) =>
        invoke<StoredPlaylist>("create_playlist", { name, category }),
    deletePlaylist: (playlistId: string) => invoke<StoredPlaylist[]>("delete_playlist", { playlistId }),
};