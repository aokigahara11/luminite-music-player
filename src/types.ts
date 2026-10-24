export type PlaylistCategory = "EP" | "Альбом" | "Плейлист";
export type CoverKind = "track" | "playlist";
export type RecentItemKind = "track" | "playlist";

export interface Track {
    id: string;
    title: string;
    artist: string;
    path: string;
    duration: number;
    cover?: string;
}

export interface Playlist {
    id: string;
    title: string;
    category: PlaylistCategory;
    trackIds: string[];
    cover?: string;
}

export interface RecentEntry {
    kind: RecentItemKind;
    entity_id: string;
    title: string;
    subtitle: string;
    cover: {
        source: "asset" | "file";
        path: string;
    };
}

export interface StoredCover {
    id: string;
    kind: CoverKind;
    entity_id: string;
    path_file: string;
}

export interface StoredTrack {
    id: string;
    path: string;
    title: string;
    artist: string | null;
    duration: number;
}

export interface DownloadedFile {
    path: string;
    coverPath: string | null;
}

export interface DownloadResult {
    downloadId: string;
    collectionTitle: string | null;
    isCollection: boolean;
    expectedTracks: number;
    files: DownloadedFile[];
}

export interface DownloadProgress {
    stage: "preparing" | "downloading" | "converting" | "finalizing";
    percentage: number | null;
}

export interface StoredPlaylist {
    id: string;
    name: string;
    category: PlaylistCategory;
    id_tracks: string[];
}

export interface PlayerConfig {
    current_track_id: string | null;
    position_secs: number;
    volume: number;
    is_playing: boolean;
}

export interface AudioStatus {
    positionSecs: number;
    durationSecs: number;
    trackPath: string | null;
    volume: number;
    isPlaying: boolean;
    loaded: boolean;
    ended: boolean;
}

export interface AppState {
    tracks: Track[];
    playlists: Playlist[];
    recentItems: RecentEntry[];
    currentTrackId: string | null;
    isPlaying: boolean;
    activeView: "main" | "media-library" | "playlists" | "settings" | "downloader" | "playlist-detail";
    selectedPlaylistId: string | null;
    searchQuery: string;
    repeatMode: "off" | "all" | "one";
    shuffleEnabled: boolean;
    playbackQueueTrackIds: string[];
    playbackQueuePlaylistId: string | null;
}