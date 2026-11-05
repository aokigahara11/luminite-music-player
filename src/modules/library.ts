import { api } from "../api";
import { player } from "../core/player";
import { elements as playerbarElements } from "../elements/playerbar";
import { mapStoredCover, mapStoredPlaylist, mapStoredTrack } from "../mappers";
import { state } from "../state";
import { showToast } from "../utils/toast";
import { updatePlayButtonIcon, updateProgressDisplay } from "./playerbar";
import { renderPlaylists, updateHomeRemixesCount } from "./playlists";
import { renderRecentlyPlayed } from "./recentlyPlayed";
import { renderMediaLibrary, updateHomeFavoritesCount } from "./tracks";
import { updateFavoriteButton, updateTrackMetadata } from "./sidebar";

// Загрузка сохраненных данных из хранилища
export async function loadSavedData() {
    const [tracks, playlists, covers, playerConfig, recentItems] = await Promise.all([
        api.getLibrary(),
        api.getPlaylists(),
        api.getCovers(),
        api.getPlayerConfig(),
        api.getRecentlyPlayed(),
    ]);

    state.tracks = tracks.map(mapStoredTrack);
    state.playlists = playlists.map(mapStoredPlaylist);
    state.playbackQueueTrackIds = state.tracks.map((track) => track.id);
    state.recentItems = recentItems;
    updateHomeFavoritesCount();
    updateHomeRemixesCount();
    updateFavoriteButton();
    
    covers.forEach((cover) => {
        const coverSrc = mapStoredCover(cover).src;
        if (cover.kind === "track") {
            const track = state.tracks.find((item) => item.id === cover.entity_id);
            if (track)
                track.cover = coverSrc;
        }
        else {
            const playlist = state.playlists.find((item) => item.id === cover.entity_id);
            if (playlist)
                playlist.cover = coverSrc;
        }
    });

    try {
        player.audioStatus = await api.setAudioVolume(playerConfig.volume);
    }
    catch (error) {
        console.error("Не удалось восстановить громкость:", error);
        showToast("Не удалось восстановить громкость", true);
    }

    playerbarElements.volumeSlider.value = Math.round(playerConfig.volume * 100).toString();
    const savedTrack = state.tracks.find((track) => track.id === playerConfig.current_track_id);
    if (savedTrack) {
        state.currentTrackId = savedTrack.id;
        updateTrackMetadata(savedTrack);
        try {
            player.audioStatus = await api.playAudio(savedTrack.path, playerConfig.position_secs, playerConfig.is_playing, playerConfig.volume);
            state.isPlaying = player.audioStatus.isPlaying;
        }
        catch (error) {
            state.isPlaying = false;
            console.error("Не удалось восстановить воспроизведение:", error);
            showToast("Не удалось восстановить воспроизведение", true);
        }
        updateProgressDisplay();
        updatePlayButtonIcon();
    }
    renderMediaLibrary();
    renderPlaylists();
    renderRecentlyPlayed();
    player.configLoaded = true;
}