import type { AppState } from "./types";

export const state: AppState = {
    tracks: [],
    playlists: [],
    recentItems: [],
    currentTrackId: null,
    isPlaying: false,
    activeView: "main",
    selectedPlaylistId: null,
    searchQuery: "",
    repeatMode: "off",
    shuffleEnabled: false,
    playbackQueueTrackIds: [],
    playbackQueuePlaylistId: null,
};