import { api } from "../api";
import { FAVORITES_PLAYLIST_ID, REMIXES_PLAYLIST_ID } from "../core/constants";
import { player, savePlayerConfig } from "../core/player";
import { closeModal, openModal, switchView } from "../core/views";
import { elements as dataElements } from "../elements/data";
import { elements as downloaderElements } from "../elements/downloader";
import { elements as homeElements } from "../elements/home";
import { elements as navigationElements } from "../elements/navigation";
import { elements as playerbarElements } from "../elements/playerbar";
import { elements as playlistsElements } from "../elements/playlists";
import { elements as remixElements } from "../elements/remix";
import { elements as settingsElements } from "../elements/settings";
import { elements as sidebarElements } from "../elements/sidebar";
import { changeCover } from "../modules/covers";
import { handleDownload } from "../modules/downloader";
import { maybeStartTrackTransition, playNextTrack, playPrevTrack, playTrack, renderActiveTrackList, togglePlay, toggleRepeatMode, toggleShuffle, transitionPendingForTrackId, updatePlayButtonIcon, updatePlaybackModeButtons, updateProgressDisplay, updateProgressTooltip, updateTrackTextMarquee } from "../modules/playerbar";
import { closeTrackEditor, configureSidebar, openTrackEditor, saveTrackMetadata, updateTrackListenProgress } from "../modules/sidebar";
import { clearPendingPlaylistTrack, openAddToPlaylistModal, openCreatePlaylistModal, openEditPlaylistModal, renderAddToPlaylistOptions, resetPlaylistFormState, submitPlaylistForm } from "../modules/playlists";
import { renderRecentlyPlayed } from "../modules/recentlyPlayed";
import { closeRemixModals, createRemix, openPlaylistRemixSpeedModal, openRemixSettings, openRemixSpeedModal } from "../modules/remix";
import { setupSearch } from "../modules/search";
import { deleteAllAppData, loadAudioSettings, loadThemeSettings, setupSettingsEvents } from "../modules/settings";
import { addTrackHandler, cancelPlaylistTrackRemovalConfirmation, cancelTrackDeleteConfirmation, confirmPlaylistTrackRemoval, confirmTrackDeletion, deleteTrackFromLibrary, setMediaLibraryFilter, toggleFavorite } from "../modules/tracks";
import { state } from "../state";
import type { AudioStatus } from "../types";
import { showToast } from "../utils/toast";
import { listen } from "@tauri-apps/api/event";

let lastDiscordPresenceKey: string | null = null;
let lastPresencePositionSecs = 0;
let lastPresenceUpdatedAt = 0;
let lastPresenceWasPlaying = false;
let discordPresenceEnabled = true;

function syncDiscordPresence(status: AudioStatus): void {
    if (!discordPresenceEnabled) {
        if (lastDiscordPresenceKey !== null) {
            lastDiscordPresenceKey = null;
            void api.clearDiscordPresence().catch((error) => {
                console.error("Не удалось очистить статус Discord:", error);
            });
        }
        return;
    }

    const track = status.trackPath && !status.ended
        ? state.tracks.find((item) => item.path === status.trackPath)
        : undefined;
    const presenceKey = track
        ? `${track.id}\0${track.title}\0${track.artist}\0${status.isPlaying}`
        : null;
    const now = performance.now();
    const elapsedSecs = (now - lastPresenceUpdatedAt) / 1000;
    const expectedPositionSecs = lastPresencePositionSecs
        + (lastPresenceWasPlaying ? elapsedSecs : 0);
    const seeked = presenceKey !== null
        && presenceKey === lastDiscordPresenceKey
        && Math.abs(status.positionSecs - expectedPositionSecs) > 2.5;

    lastPresencePositionSecs = status.positionSecs;
    lastPresenceUpdatedAt = now;
    lastPresenceWasPlaying = status.isPlaying;

    if (presenceKey === lastDiscordPresenceKey && !seeked)
        return;
    lastDiscordPresenceKey = presenceKey;

    const request = track && status.loaded
        ? api.updateDiscordPresence(
            track.title,
            track.artist,
            status.positionSecs,
            status.durationSecs,
            status.isPlaying,
        )
        : api.clearDiscordPresence();
    void request.catch((error) => console.error("Не удалось синхронизировать статус Discord:", error));
}

export async function initEvents() {
    configureSidebar({
        renderActiveTrackList,
        renderRecentlyPlayed,
        updatePlayButtonIcon,
        updateProgressDisplay,
        updateTrackTextMarquee,
    });
    try {
        await listen<AudioStatus>("audio-state", ({ payload }) => {
            const wasPlaying = state.isPlaying;
            const volumeChanged = player.audioStatus.volume !== payload.volume;
            player.audioStatus = payload;
            state.isPlaying = payload.isPlaying;
            syncDiscordPresence(payload);
            playerbarElements.volumeSlider.value = Math.round(payload.volume * 100).toString();
            if (volumeChanged && player.configLoaded)
                savePlayerConfig();
            const audioTrack = state.tracks.find((track) => track.path === payload.trackPath);
            updateTrackListenProgress(audioTrack, payload);
            if (audioTrack && payload.durationSecs > 0)
                audioTrack.duration = payload.durationSecs;
            updateProgressDisplay();
            if (wasPlaying !== state.isPlaying) {
                updatePlayButtonIcon();
                renderActiveTrackList();
            }
            void maybeStartTrackTransition(payload);
            if (payload.ended && transitionPendingForTrackId !== state.currentTrackId) {
                void playNextTrack(true);
            }
        });
    }
    catch (error) {
        console.error("Не удалось подписаться на состояние аудио:", error);
        showToast("Не удалось подключить управление аудио", true);
    }
    
    try {
        await listen<string>("player-shortcut-action", ({ payload }) => {
            switch (payload) {
                case "play-pause":
                    void togglePlay();
                    break;
                case "next-track":
                    void playNextTrack();
                    break;
                case "previous-track":
                    playPrevTrack();
                    break;
                case "toggle-shuffle":
                    toggleShuffle();
                    break;
                case "toggle-repeat":
                    toggleRepeatMode();
                    break;
                default:
                    console.error(`Получено неизвестное действие горячей клавиши: ${payload}`);
            }
        });
    }
    
    catch (error) {
        console.error("Не удалось подписаться на горячие клавиши:", error);
        showToast("Не удалось подключить горячие клавиши", true);
    }
    
    loadThemeSettings();
    await loadAudioSettings();
    window.addEventListener("resize", updateTrackTextMarquee);
    const closeMobileTrackPanel = () => {
        document.body.classList.remove("mobile-track-panel-open");
        sidebarElements.mobileTrackDetailsBtn?.setAttribute("aria-expanded", "false");
    };
    sidebarElements.mobileTrackDetailsBtn?.addEventListener("click", () => {
        const isOpen = document.body.classList.toggle("mobile-track-panel-open");
        sidebarElements.mobileTrackDetailsBtn.setAttribute("aria-expanded", String(isOpen));
    });
    document.addEventListener("click", (event) => {
        document.querySelectorAll<HTMLElement>(".track-actions-popover:not([hidden])").forEach((menu) => {
            menu.hidden = true;
            menu.closest(".track-actions-menu")?.querySelector(".track-menu-trigger")?.setAttribute("aria-expanded", "false");
        });
        const target = event.target;
        if (target instanceof Element
            && !target.closest("#sidebar-right-panel, #mobile-track-details-btn")) {
            closeMobileTrackPanel();
        }
    });
    
    document.addEventListener("keydown", (event) => {
        if (event.key !== "Escape")
            return;
        document.querySelectorAll<HTMLElement>(".track-actions-popover:not([hidden])").forEach((menu) => {
            menu.hidden = true;
            const trigger = menu.closest(".track-actions-menu")?.querySelector<HTMLButtonElement>(".track-menu-trigger");
            trigger?.setAttribute("aria-expanded", "false");
            trigger?.focus();
        });
        closeMobileTrackPanel();
    });
    
    // Навигация
    navigationElements.mainBtn?.addEventListener("click", () => switchView("main"));
    navigationElements.mediaLibraryBtn?.addEventListener("click", () => switchView("media-library"));
    navigationElements.playlistsBtn?.addEventListener("click", () => switchView("playlists"));
    navigationElements.settingsBtn?.addEventListener("click", () => switchView("settings"));
    navigationElements.downloaderBtn?.addEventListener("click", () => switchView("downloader"));
    const openCardFromKeyboard = (event: KeyboardEvent, open: () => void) => {
        if (event.key !== "Enter" && event.key !== " ")
            return;
        event.preventDefault();
        open();
    };
    
    homeElements.homeMediaLibraryCard?.addEventListener("click", () => switchView("media-library"));
    homeElements.homeMediaLibraryCard?.addEventListener("keydown", (event) => {
        openCardFromKeyboard(event, () => switchView("media-library"));
    });
    
    const openFavorites = () => {
        state.selectedPlaylistId = FAVORITES_PLAYLIST_ID;
        switchView("playlist-detail");
    };
    
    const openRemixes = () => {
        state.selectedPlaylistId = REMIXES_PLAYLIST_ID;
        switchView("playlist-detail");
    };
    
    homeElements.homeFavoritesCard?.addEventListener("click", openFavorites);
    homeElements.homeFavoritesCard?.addEventListener("keydown", (event) => openCardFromKeyboard(event, openFavorites));
    homeElements.homeRemixesCard?.addEventListener("click", openRemixes);
    homeElements.homeRemixesCard?.addEventListener("keydown", (event) => openCardFromKeyboard(event, openRemixes));
    
    // Добавление треков
    homeElements.addTrackBtn?.addEventListener("click", addTrackHandler);
    homeElements.libraryAddTrackBtn?.addEventListener("click", addTrackHandler);
    homeElements.emptyScanBtn?.addEventListener("click", addTrackHandler);
    downloaderElements.downloadForm?.addEventListener("submit", (event) => void handleDownload(event));
    downloaderElements.downloadInfo?.addEventListener("click", () => {
        openModal(downloaderElements.infoDownloaderModal);
        downloaderElements.closeInfoDownloaderModalBtn.focus();
    });

    downloaderElements.closeInfoDownloaderModalBtn?.addEventListener("click", () => {
        closeModal(downloaderElements.infoDownloaderModal);
        downloaderElements.downloadInfo.focus();
    });

    downloaderElements.infoDownloaderModal?.addEventListener("click", (event) => {
        if (event.target === downloaderElements.infoDownloaderModal) {
            closeModal(downloaderElements.infoDownloaderModal);
            downloaderElements.downloadInfo.focus();
        }
    });

    downloaderElements.infoDownloaderModal?.addEventListener("keydown", (event: KeyboardEvent) => {
        if (event.key === "Escape") {
            closeModal(downloaderElements.infoDownloaderModal);
            downloaderElements.downloadInfo.focus();
        }
        else if (event.key === "Tab") {
            event.preventDefault();
            downloaderElements.closeInfoDownloaderModalBtn.focus();
        }
    });

    // Создание плейлистов
    const openPlModal = openCreatePlaylistModal;
    homeElements.createPlaylistBtn?.addEventListener("click", openPlModal);
    homeElements.playlistsCreateBtn?.addEventListener("click", openPlModal);
    homeElements.emptyCreatePlaylistBtn?.addEventListener("click", openPlModal);
    playlistsElements.submitPlaylistBtn?.addEventListener("click", submitPlaylistForm);
    playlistsElements.closeAddPlaylistModalBtn?.addEventListener("click", () => {
        closeModal(playlistsElements.addToPlaylistModal);
        clearPendingPlaylistTrack();
    });

    playlistsElements.modalPlaylistSearch?.addEventListener("input", renderAddToPlaylistOptions);
    remixElements.closeRemixSpeedBtn.addEventListener("click", closeRemixModals);
    remixElements.closeRemixSettingsBtn.addEventListener("click", closeRemixModals);
    remixElements.remixBackBtn.addEventListener("click", () => {
        closeModal(remixElements.remixSettingsModal);
        openModal(remixElements.remixSpeedModal);
    });

    remixElements.remixSpeedModal.addEventListener("click", (event) => {
        if (event.target === remixElements.remixSpeedModal)
            closeRemixModals();
    });

    remixElements.remixSettingsModal.addEventListener("click", (event) => {
        if (event.target === remixElements.remixSettingsModal)
            closeRemixModals();
    });

    remixElements.remixSpeedModal.querySelectorAll<HTMLButtonElement>("[data-speed]").forEach((button) => {
        button.addEventListener("click", () => {
            const speed = button.dataset.speed;
            if (speed === "normal" || speed === "slowed" || speed === "speed_up") {
                openRemixSettings(speed);
            }
        });
    });

    remixElements.remixSettingsModal.querySelectorAll<HTMLButtonElement>("[data-effect]").forEach((button) => {
        button.addEventListener("click", () => {
            const isSelected = button.getAttribute("aria-pressed") === "true";
            button.setAttribute("aria-pressed", String(!isSelected));
        });
    });

    remixElements.remixCreateBtn.addEventListener("click", () => {
        const effects = Array.from(remixElements.remixSettingsModal.querySelectorAll<HTMLButtonElement>("[data-effect][aria-pressed='true']"))
            .map((button) => button.dataset.effect)
            .filter((effect): effect is string => Boolean(effect));
        void createRemix(effects);
    });

    remixElements.remixSkipBtn.addEventListener("click", () => void createRemix([]));
    document.addEventListener("keydown", (event) => {
        if (event.key === "Escape" && (!remixElements.remixSpeedModal.classList.contains("hidden") || !remixElements.remixSettingsModal.classList.contains("hidden"))) {
            closeRemixModals();
        }
    });

    playlistsElements.modalCreatePlaylistBtn?.addEventListener("click", () => {
        closeModal(playlistsElements.addToPlaylistModal);
        openCreatePlaylistModal();
        playlistsElements.playlistNameInput.focus();
    });

    playlistsElements.closeModalBtn?.addEventListener("click", () => {
        closeModal(playlistsElements.createPlaylistModal);
        resetPlaylistFormState();
    });

    // Плейлист 
    playlistsElements.playlistBackBtn?.addEventListener("click", () => switchView("playlists"));
    playlistsElements.editPlaylistBtn?.addEventListener("click", openEditPlaylistModal);
    playlistsElements.changePlaylistCoverBtn?.addEventListener("click", async () => {
        if (!state.selectedPlaylistId || state.selectedPlaylistId === FAVORITES_PLAYLIST_ID)
            return;
        try {
            await changeCover("playlist", state.selectedPlaylistId);
        }
        catch (error) {
            showToast(`Не удалось сохранить обложку: ${String(error)}`, true);
        }
    });

    playlistsElements.remixPlaylistBtn?.addEventListener("click", () => {
        if (state.selectedPlaylistId)
            openPlaylistRemixSpeedModal(state.selectedPlaylistId);
    });

    playlistsElements.deletePlaylistBtn?.addEventListener("click", () => {
        if (!state.selectedPlaylistId)
            return;
        openModal(playlistsElements.deletePlaylistModal);
        playlistsElements.closeDeletePlaylistModalBtn.focus();
    });

    const closeDeletePlaylistModal = () => {
        closeModal(playlistsElements.deletePlaylistModal);
        playlistsElements.deletePlaylistBtn.focus();
    };

    playlistsElements.closeDeletePlaylistModalBtn?.addEventListener("click", closeDeletePlaylistModal);
    playlistsElements.deletePlaylistModal?.addEventListener("click", (event) => {
        if (event.target === playlistsElements.deletePlaylistModal)
            closeDeletePlaylistModal();
    });
    playlistsElements.deletePlaylistModal?.addEventListener("keydown", (event: KeyboardEvent) => {
        if (event.key === "Escape")
            closeDeletePlaylistModal();
    });
    playlistsElements.confirmDeletePlaylistBtn?.addEventListener("click", async () => {
        const playlistId = state.selectedPlaylistId;
        if (!playlistId) {
            closeModal(playlistsElements.deletePlaylistModal);
            return;
        }
        const playlist = state.playlists.find((item) => item.id === playlistId);
        if (!playlist) {
            closeModal(playlistsElements.deletePlaylistModal);
            return;
        }

        const trackIdsToDelete = playlistsElements.deletePlaylistTracksCheckbox.checked
            ? [...new Set(playlist.trackIds)]
            : [];
        playlistsElements.confirmDeletePlaylistBtn.disabled = true;
        try {
            await api.deletePlaylist(playlistId);
            state.playlists = state.playlists.filter((item) => item.id !== playlistId);
            state.recentItems = state.recentItems.filter((item) => item.kind !== "playlist" || item.entity_id !== playlistId);
            state.selectedPlaylistId = null;
            if (state.playbackQueuePlaylistId === playlistId) {
                state.playbackQueuePlaylistId = null;
                state.playbackQueueTrackIds = state.tracks.map((track) => track.id);
            }
            closeModal(playlistsElements.deletePlaylistModal);
            renderRecentlyPlayed();
            switchView("playlists");

            const failedTrackIds: string[] = [];
            for (const trackId of trackIdsToDelete) {
                try {
                    await deleteTrackFromLibrary(trackId, false);
                }
                catch (error) {
                    console.error(`Не удалось удалить трек ${trackId} из медиатеки:`, error);
                    failedTrackIds.push(trackId);
                }
            }

            if (failedTrackIds.length > 0) {
                showToast(`Плейлист удалён, но ${failedTrackIds.length} треков не удалось удалить из медиатеки`, true);
            }
            else {
                showToast(trackIdsToDelete.length > 0 ? "Плейлист и треки удалены" : "Плейлист удалён");
            }
        }
        catch (error) {
            console.error("Не удалось удалить плейлист:", error);
            showToast(`Не удалось удалить плейлист: ${String(error)}`, true);
        }
        finally {
            playlistsElements.confirmDeletePlaylistBtn.disabled = false;
        }
    });

    // Воспроизведение
    sidebarElements.changeTrackCoverBtn?.addEventListener("click", async () => {
        if (!state.currentTrackId)
            return;
        try {
            await changeCover("track", state.currentTrackId);
        }
        catch (error) {
            showToast(`Не удалось сохранить обложку: ${String(error)}`, true);
        }
    });

    sidebarElements.editTrackBtn?.addEventListener("click", openTrackEditor);
    sidebarElements.sidebarRemixBtn?.addEventListener("click", () => {
        if (state.currentTrackId)
            openRemixSpeedModal(state.currentTrackId);
    });

    sidebarElements.sidebarAddToPlaylistBtn?.addEventListener("click", () => {
        if (state.currentTrackId)
            openAddToPlaylistModal(state.currentTrackId);
    });

    sidebarElements.favoriteBtn?.addEventListener("click", async () => {
        if (!state.currentTrackId)
            return;
        try {
            await toggleFavorite(state.currentTrackId);
        }
        catch (error) {
            showToast(`Не удалось обновить избранное: ${String(error)}`, true);
        }
    });

    sidebarElements.trackEditForm?.addEventListener("submit", (event) => {
        event.preventDefault();
        void saveTrackMetadata();
    });

    sidebarElements.cancelTrackEditBtn?.addEventListener("click", closeTrackEditor);
    playerbarElements.playBtn?.addEventListener("click", togglePlay);
    playerbarElements.nextBtn?.addEventListener("click", () => void playNextTrack());
    playerbarElements.prevBtn?.addEventListener("click", playPrevTrack);
    playerbarElements.repeatBtn?.addEventListener("click", toggleRepeatMode);
    playerbarElements.shuffleBtn?.addEventListener("click", toggleShuffle);
    updatePlaybackModeButtons();
    window.setInterval(() => {
        if (state.isPlaying)
            savePlayerConfig();
    }, 5000);

    playerbarElements.progressSlider?.addEventListener("input", () => {
        const seekTime = Number(playerbarElements.progressSlider.value);
        void api.seekAudio(seekTime).then((status) => {
            player.audioStatus = status;
        }).catch((error) => {
            showToast(`Не удалось изменить позицию: ${String(error)}`, true);
        });
        updateProgressDisplay(seekTime);
        updateProgressTooltip(seekTime);
        savePlayerConfig();
    });

    playerbarElements.progressSlider?.addEventListener("pointermove", (event) => {
        const bounds = playerbarElements.progressSlider.getBoundingClientRect();
        const progress = Math.min(1, Math.max(0, (event.clientX - bounds.left) / bounds.width));
        const duration = Number.isFinite(player.audioStatus.durationSecs) ? player.audioStatus.durationSecs : 0;
        updateProgressTooltip(progress * duration);
    });
    
    playerbarElements.volumeSlider?.addEventListener("input", () => {
        const volume = Number(playerbarElements.volumeSlider.value) / 100;
        void api.setAudioVolume(volume).then((status) => {
            player.audioStatus = status;
            savePlayerConfig();
        }).catch((error) => {
            showToast(`Не удалось изменить громкость: ${String(error)}`, true);
        });
    });
    setupSettingsEvents();
    settingsElements.discordRcpToggle?.addEventListener("click", () => {
        discordPresenceEnabled = !discordPresenceEnabled;
        settingsElements.discordRcpToggle.setAttribute("aria-pressed", String(discordPresenceEnabled));
        settingsElements.discordRcpToggle.textContent = discordPresenceEnabled ? "Включено" : "Выключено";
        syncDiscordPresence(player.audioStatus);
    });

    const closeShortcutsModal = () => {
        closeModal(settingsElements.shortcutsModal);
        settingsElements.openShortcutBtn.focus();
    };

    settingsElements.openShortcutBtn?.addEventListener("click", () => {
        openModal(settingsElements.shortcutsModal);
        settingsElements.closeShortcutsModalBtn.focus();
    });

    settingsElements.closeShortcutsModalBtn?.addEventListener("click", closeShortcutsModal);
    settingsElements.shortcutsModal?.addEventListener("click", (event) => {
        if (event.target === settingsElements.shortcutsModal)
            closeShortcutsModal();
    });
    settingsElements.shortcutsModal?.addEventListener("keydown", (event: KeyboardEvent) => {
        if (event.key === "Escape")
            closeShortcutsModal();
    });

    dataElements.openDeleteDataModalBtn?.addEventListener("click", () => {
        openModal(dataElements.deleteDataModal);
        dataElements.closeDeleteDataModalBtn.focus();
    });

    dataElements.closeDeleteDataModalBtn?.addEventListener("click", () => closeModal(dataElements.deleteDataModal));
    dataElements.deleteDataModal?.addEventListener("click", (event) => {
        if (event.target === dataElements.deleteDataModal)
            closeModal(dataElements.deleteDataModal);
    });

    dataElements.deleteDataModal?.addEventListener("keydown", (event: KeyboardEvent) => {
        if (event.key === "Escape")
            closeModal(dataElements.deleteDataModal);
    });
    dataElements.confirmDeleteDataBtn?.addEventListener("click", () => void deleteAllAppData());

    dataElements.closeDeleteTrackModalBtn?.addEventListener("click", cancelTrackDeleteConfirmation);
    dataElements.deleteTrackModal?.addEventListener("click", (event) => {
        if (event.target === dataElements.deleteTrackModal)
            cancelTrackDeleteConfirmation();
    });
    dataElements.deleteTrackModal?.addEventListener("keydown", (event: KeyboardEvent) => {
        if (event.key === "Escape")
            cancelTrackDeleteConfirmation();
    });
    dataElements.confirmDeleteTrackBtn?.addEventListener("click", () => {
        void confirmTrackDeletion().catch((error) => {
            console.error("Не удалось удалить трек:", error);
            showToast(`Не удалось удалить трек: ${String(error)}`, true);
        });
    });

    playlistsElements.closeRemoveTrackFromPlaylistModalBtn?.addEventListener("click", cancelPlaylistTrackRemovalConfirmation);
    playlistsElements.removeTrackFromPlaylistModal?.addEventListener("click", (event) => {
        if (event.target === playlistsElements.removeTrackFromPlaylistModal)
            cancelPlaylistTrackRemovalConfirmation();
    });
    playlistsElements.removeTrackFromPlaylistModal?.addEventListener("keydown", (event: KeyboardEvent) => {
        if (event.key === "Escape")
            cancelPlaylistTrackRemovalConfirmation();
    });
    playlistsElements.confirmRemoveTrackFromPlaylistBtn?.addEventListener("click", () => {
        void confirmPlaylistTrackRemoval().catch((error) => {
            console.error("Не удалось удалить трек из плейлиста:", error);
            showToast(`Не удалось удалить трек из плейлиста: ${String(error)}`, true);
        });
    });
    setupSearch(playTrack, setMediaLibraryFilter, (playlistId) => {
        state.selectedPlaylistId = playlistId;
        switchView("playlist-detail");
    });
}
