import { open } from "@tauri-apps/plugin-dialog";
import { convertFileSrc } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { api } from "./api";
import { elements } from "./elements";
import { mapStoredCover, mapStoredPlaylist, mapStoredTrack } from "./mappers";
import { state } from "./state";
import type {
    AppState,
    AudioStatus,
    CoverKind,
    PlayerConfig,
    PlaylistCategory,
    RecentItemKind,
    Track,
} from "./types";

const FAVORITES_PLAYLIST_ID = "favorites";

let audioStatus: AudioStatus = {
    positionSecs: 0,
    durationSecs: 0,
    volume: 0.7,
    isPlaying: false,
    loaded: false,
    ended: false,
};
let playerSaveQueue: Promise<void> = Promise.resolve();
let recentSaveQueue: Promise<void> = Promise.resolve();
let toastTimer: number | undefined;
let toastHideTimer: number | undefined;

function savePlayerConfig() {
    const config: PlayerConfig = {
        current_track_id: state.currentTrackId,
        position_secs: Number.isFinite(audioStatus.positionSecs) ? audioStatus.positionSecs : 0,
        volume: audioStatus.volume,
        is_playing: state.isPlaying,
    };

    playerSaveQueue = playerSaveQueue
        .then(() => api.savePlayerConfig(config))
        .catch((error) => console.error("Не удалось сохранить состояние плеера:", error));
}

async function loadSavedData() {
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
    updateFavoriteButton();

    covers.forEach((cover) => {
        const coverSrc = mapStoredCover(cover).src;
        if (cover.kind === "track") {
            const track = state.tracks.find((item) => item.id === cover.entity_id);
            if (track) track.cover = coverSrc;
        } else {
            const playlist = state.playlists.find((item) => item.id === cover.entity_id);
            if (playlist) playlist.cover = coverSrc;
        }
    });

    try {
        audioStatus = await api.setAudioVolume(playerConfig.volume);
    } catch (error) {
        console.error("Не удалось восстановить громкость:", error);
        showToast("Не удалось восстановить громкость", true);
    }
    elements.volumeSlider.value = Math.round(playerConfig.volume * 100).toString();

    const savedTrack = state.tracks.find((track) => track.id === playerConfig.current_track_id);
    if (savedTrack) {
        state.currentTrackId = savedTrack.id;
        updateTrackMetadata(savedTrack);
        try {
            audioStatus = await api.playAudio(
                savedTrack.path,
                playerConfig.position_secs,
                playerConfig.is_playing,
                playerConfig.volume,
            );
            state.isPlaying = audioStatus.isPlaying;
        } catch (error) {
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
}

async function changeCover(kind: CoverKind, entityId: string) {
    const filePath = await open({
        multiple: false,
        filters: [{ name: "Изображения", extensions: ["jpg", "jpeg", "png", "webp"] }],
    });
    if (typeof filePath !== "string") return;

    const storedCover = await api.setCover(kind, entityId, filePath);
    const coverSrc = mapStoredCover(storedCover).src;

    if (kind === "track") {
        const track = state.tracks.find((item) => item.id === entityId);
        if (!track) return;
        track.cover = coverSrc;
        if (state.currentTrackId === entityId) updateTrackMetadata(track);
        renderRecentlyPlayed();
    } else {
        const playlist = state.playlists.find((item) => item.id === entityId);
        if (!playlist) return;
        playlist.cover = coverSrc;
        renderPlaylists();
        renderPlaylistDetail();
        renderRecentlyPlayed();
    }

    showToast("Обложка сохранена");
}

function showToast(message: string, isError = false) {
    window.clearTimeout(toastTimer);
    window.clearTimeout(toastHideTimer);
    elements.appToast.hidden = false;
    elements.appToast.classList.remove("is-visible");
    elements.appToast.classList.toggle("is-error", isError);
    elements.appToastMessage.textContent = message;
    elements.appToastIcon.innerHTML = isError
        ? `<circle cx="12" cy="12" r="9"></circle><path d="m9 9 6 6m0-6-6 6"></path>`
        : `<circle cx="12" cy="12" r="9"></circle><path d="m8 12 2.5 2.5L16 9"></path>`;

    requestAnimationFrame(() => elements.appToast.classList.add("is-visible"));
    toastTimer = window.setTimeout(() => {
        elements.appToast.classList.remove("is-visible");
        toastHideTimer = window.setTimeout(() => {
            elements.appToast.hidden = true;
        }, 160);
    }, 2000);
}

function formatTime(seconds: number): string {
    if (isNaN(seconds) || seconds <= 0) return "0:00";
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs < 10 ? "0" : ""}${secs}`;
}

function updateProgressDisplay(time = audioStatus.positionSecs) {
    const duration = Number.isFinite(audioStatus.durationSecs) && audioStatus.durationSecs > 0 ? audioStatus.durationSecs : 0;
    const currentTime = Number.isFinite(time) && duration > 0 ? Math.min(Math.max(time, 0), duration) : 0;
    const sliderMax = Math.max(1, Math.floor(duration));

    elements.currentTime.textContent = formatTime(currentTime);
    elements.totalTime.textContent = formatTime(duration);
    elements.progressSlider.max = sliderMax.toString();
    elements.progressSlider.value = Math.min(Math.floor(currentTime), sliderMax).toString();
    elements.progressSlider.style.setProperty("--progress", `${duration > 0 ? (currentTime / duration) * 100 : 0}%`);
}

function updateProgressTooltip(time: number) {
    const duration = Number.isFinite(audioStatus.durationSecs) && audioStatus.durationSecs > 0 ? audioStatus.durationSecs : 0;
    const previewTime = duration > 0 ? Math.min(Math.max(time, 0), duration) : 0;
    const percentage = duration > 0 ? (previewTime / duration) * 100 : 0;

    elements.progressTooltip.textContent = formatTime(previewTime);
    elements.progressTooltip.style.left = `${Math.min(95, Math.max(5, percentage))}%`;
}

function updateMarquee(element: HTMLElement) {
    element.classList.remove("marquee");
    element.style.removeProperty("--marquee-distance");
    element.style.removeProperty("--marquee-duration");

    const overflow = element.scrollWidth - element.clientWidth;
    if (overflow <= 1) return;

    element.style.setProperty("--marquee-distance", `${overflow}px`);
    element.style.setProperty("--marquee-duration", `${Math.max(8, overflow / 24)}s`);
    element.classList.add("marquee");
}

function updateTrackTextMarquee() {
    updateMarquee(elements.playerTitle);
    updateMarquee(elements.playerArtist);
}

function switchView(view: AppState["activeView"]) {
    state.activeView = view;

    [elements.viewMain, elements.viewMediaLibrary, elements.viewPlaylists, elements.viewPlaylistDetail].forEach((sec) => sec?.classList.remove("active"));
    [elements.mainBtn, elements.mediaLibraryBtn, elements.playlistsBtn].forEach((btn) => btn?.classList.remove("active"));

    if (view === "main") {
        elements.viewMain?.classList.add("active");
        elements.mainBtn?.classList.add("active");
    } else if (view === "media-library") {
        elements.viewMediaLibrary?.classList.add("active");
        elements.mediaLibraryBtn?.classList.add("active");
        renderMediaLibrary();
    } else if (view === "playlists") {
        elements.viewPlaylists?.classList.add("active");
        elements.playlistsBtn?.classList.add("active");
        renderPlaylists();
    } else if (view === "playlist-detail") {
        elements.viewPlaylistDetail?.classList.add("active");
        renderPlaylistDetail();
    }
}

async function addTrackHandler() {
    try {
        const selected = await open({
            multiple: true,
            filters: [{ name: "Audio", extensions: ["mp3", "wav", "flac", "ogg", "m4a"] }],
        });

        if (!selected) return;
        const paths = Array.isArray(selected) ? selected : [selected];

        for (const filePath of paths) {
            const track = await api.importTrack(filePath);
            state.tracks.push(mapStoredTrack(track));
        }

        showToast(paths.length === 1 ? "Трек добавлен" : `Добавлено треков: ${paths.length}`);

        if (state.activeView === "media-library") renderMediaLibrary();
        if (state.activeView === "main") switchView("media-library");
    } catch (err) {
        console.error("Ошибка при выборе файла:", err);
        showToast(`Не удалось добавить трек: ${String(err)}`, true);
    }
}

function renderMediaLibrary() {
    if (state.tracks.length === 0) {
        elements.mediaEmptyState?.classList.remove("hidden");
        elements.trackListContainer.style.display = "none";
    } else {
        elements.mediaEmptyState?.classList.add("hidden");
        elements.trackListContainer.style.display = "block";
        renderTrackList(elements.trackListContainer, state.tracks, "library");
    }
}

function escapeHtml(value: string) {
    return value.replace(/[&<>"']/g, (character) => ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
    })[character] ?? character);
}

function renderRecentlyPlayed() {
    const items = state.recentItems;

    if (items.length === 0) {
        elements.recentlyPlayedGrid.innerHTML = '<p class="recently-played-empty">Пока ничего не прослушано</p>';
        return;
    }

    elements.recentlyPlayedGrid.innerHTML = items.map((item) => {
        const coverPath = item.cover.source === "file" ? convertFileSrc(item.cover.path) : item.cover.path;
        const cover = escapeHtml(coverPath);
        const title = escapeHtml(item.title);
        const cardCover = item.kind === "track"
            ? `<button class="card-play-btn" type="button" aria-label="Воспроизвести ${title}">
                   <svg class="icon-svg" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><polygon points="6,4 20,12 6,20" /></svg>
               </button>`
            : "";

        return `
            <div class="media-card" data-recent-kind="${item.kind}" data-id="${escapeHtml(item.entity_id)}">
                <div class="card-cover-wrapper">
                    <img src="${cover}" alt="Обложка: ${title}" class="card-cover" />
                    ${cardCover}
                </div>
                <div class="card-title">${title}</div>
                <div class="card-artist">${escapeHtml(item.subtitle)}</div>
            </div>`;
    }).join("");

    elements.recentlyPlayedGrid.querySelectorAll<HTMLElement>(".media-card").forEach((card) => {
        card.addEventListener("click", () => {
            const id = card.dataset.id;
            if (!id) return;
            if (card.dataset.recentKind === "track") {
                playTrack(id);
            } else {
                state.selectedPlaylistId = id;
                switchView("playlist-detail");
            }
        });
    });
}

function renderTrackList(container: HTMLElement, tracks: Track[], context: "library" | "playlist") {
    const header = `
    <div class="track-list-header">
      <span class="col-num">#</span>
      <span class="col-title">Название</span>
      <span class="col-artist">Исполнитель</span>
      <span class="col-duration">
        <svg class="icon-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <circle cx="12" cy="12" r="10"></circle>
          <polyline points="12 6 12 12 16 14"></polyline>
        </svg>
      </span>
      <span class="col-actions"></span>
    </div>`;

    const rows = tracks
        .map((track, idx) => {
            const isCurrent = state.currentTrackId === track.id;
            const isPlaying = isCurrent && state.isPlaying;
            const isFavoritesPlaylist = context === "playlist" && state.selectedPlaylistId === FAVORITES_PLAYLIST_ID;
            const isFavorite = state.playlists
                .find((playlist) => playlist.id === FAVORITES_PLAYLIST_ID)
                ?.trackIds.includes(track.id) ?? false;
            const menuActions = `
                <button class="track-menu-option" type="button" role="menuitem" data-action="toggle-favorite" data-id="${track.id}">${isFavorite ? "Убрать из избранного" : "Добавить в избранное"}</button>
                ${context === "playlist"
                    ? isFavoritesPlaylist
                        ? `<button class="track-menu-option" type="button" role="menuitem" data-action="add-to-playlist" data-id="${track.id}">Добавить в плейлист</button>`
                        : `<button class="track-menu-option track-menu-option-danger" type="button" role="menuitem" data-action="remove-from-playlist" data-id="${track.id}">Удалить из плейлиста</button>`
                    : `<button class="track-menu-option" type="button" role="menuitem" data-action="add-to-playlist" data-id="${track.id}">Добавить в плейлист</button>
                       <button class="track-menu-option track-menu-option-danger" type="button" role="menuitem" data-action="delete-track" data-id="${track.id}">Удалить из медиатеки</button>`}`;
            const actionMenu = `
                <div class="track-actions-menu">
                    <button class="track-menu-trigger" type="button" aria-haspopup="menu" aria-expanded="false" aria-label="Действия с треком ${track.title}" title="Действия с треком">
                        <svg class="icon-svg" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                            <circle cx="5" cy="12" r="1.7"></circle>
                            <circle cx="12" cy="12" r="1.7"></circle>
                            <circle cx="19" cy="12" r="1.7"></circle>
                        </svg>
                    </button>
                    <div class="track-actions-popover" role="menu" hidden>${menuActions}</div>
                </div>`;

            return `
      <div class="track-row ${isCurrent ? "active" : ""} ${isPlaying ? "playing" : ""}" data-id="${track.id}">
        <span class="col-num">${idx + 1}</span>
        <span class="col-title">${track.title}</span>
        <span class="col-artist">${track.artist}</span>
        <span class="col-duration">${formatTime(track.duration)}</span>
        <span class="col-actions">${actionMenu}</span>
      </div>`;
        })
        .join("");

    container.innerHTML = header + rows;

    // Навешивание событий на строки
    container.querySelectorAll(".track-row").forEach((row) => {
        row.addEventListener("click", (e) => {
            const target = e.target as HTMLElement;
            if (target.closest("button")) return;
            const trackId = row.getAttribute("data-id");
            if (trackId) {
                const playlistId = context === "playlist" ? state.selectedPlaylistId : null;
                playTrack(trackId, tracks.map((item) => item.id), playlistId);
            }
        });
    });

    container.querySelectorAll<HTMLButtonElement>(".track-menu-trigger").forEach((button) => {
        button.addEventListener("click", (event) => {
            event.stopPropagation();
            const row = button.closest(".track-row");
            const menu = row?.querySelector<HTMLElement>(".track-actions-popover");
            if (!menu) return;

            container.querySelectorAll<HTMLElement>(".track-actions-popover").forEach((openMenu) => {
                openMenu.hidden = true;
                openMenu.closest(".track-actions-menu")?.querySelector(".track-menu-trigger")?.setAttribute("aria-expanded", "false");
            });

            menu.hidden = false;
            button.setAttribute("aria-expanded", "true");
            const menuHeight = menu.getBoundingClientRect().height;
            const spaceBelow = window.innerHeight - button.getBoundingClientRect().bottom;
            menu.classList.toggle("opens-up", spaceBelow < menuHeight + 12);
        });
    });

    container.querySelectorAll<HTMLButtonElement>(".track-menu-option").forEach((button) => {
        button.addEventListener("click", async (event) => {
            event.stopPropagation();
            const trackId = button.dataset.id;
            const action = button.dataset.action;
            if (!trackId || !action) return;

            const menu = button.closest<HTMLElement>(".track-actions-popover");
            if (menu) menu.hidden = true;
            button.closest(".track-actions-menu")?.querySelector(".track-menu-trigger")?.setAttribute("aria-expanded", "false");

            try {
                if (action === "add-to-playlist") {
                    openAddToPlaylistModal(trackId);
                } else if (action === "toggle-favorite") {
                    await toggleFavorite(trackId);
                } else if (action === "delete-track") {
                    await deleteTrackFromLibrary(trackId);
                } else if (action === "remove-from-playlist") {
                    await removeTrackFromPlaylist(trackId);
                }
            } catch (error) {
                console.error("Не удалось выполнить действие с треком:", error);
                showToast(`Не удалось выполнить действие: ${String(error)}`, true);
            }
        });
    });
}

async function deleteTrackFromLibrary(trackId: string) {
    const currentTrack = state.currentTrackId === trackId
        ? state.tracks.find((track) => track.id === trackId)
        : undefined;
    const playbackPosition = audioStatus.positionSecs;
    const wasPlaying = state.isPlaying;

    if (currentTrack) audioStatus = await api.stopAudio();
    try {
        await api.deleteTrack(trackId);
    } catch (error) {
        if (currentTrack) {
            try {
                audioStatus = await api.playAudio(currentTrack.path, playbackPosition, wasPlaying, audioStatus.volume);
                state.isPlaying = audioStatus.isPlaying;
            } catch (restoreError) {
                console.error("Не удалось восстановить воспроизведение после ошибки удаления:", restoreError);
            }
        }
        throw error;
    }

    state.tracks = state.tracks.filter((track) => track.id !== trackId);
    state.recentItems = state.recentItems.filter((item) => item.kind !== "track" || item.entity_id !== trackId);
    state.playlists.forEach((playlist) => {
        playlist.trackIds = playlist.trackIds.filter((id) => id !== trackId);
    });

    if (state.currentTrackId === trackId) {
        state.currentTrackId = null;
        state.isPlaying = false;
        elements.playerTitle.textContent = "Трек не выбран";
        elements.playerArtist.textContent = "Выберите трек для воспроизведения";
        elements.sidebarTitle.textContent = "Трек не выбран";
        elements.sidebarArtist.textContent = "Выберите трек для воспроизведения";
        elements.editTrackBtn.disabled = true;
        elements.changeTrackCoverBtn.disabled = true;
        updateFavoriteButton();
        elements.sidebarCoverWrapper.classList.remove("has-cover");
        elements.playerCover.src = "./src/assets/media_library.jpg";
        elements.sidebarCover.src = "./src/assets/media_library.jpg";
        closeTrackEditor();
        updatePlayButtonIcon();
        updateProgressDisplay(0);
        savePlayerConfig();
    }

    renderMediaLibrary();
    renderPlaylists();
    renderPlaylistDetail();
    renderRecentlyPlayed();
    showToast("Трек удалён из медиатеки");
}

async function removeTrackFromPlaylist(trackId: string) {
    const playlist = state.playlists.find((item) => item.id === state.selectedPlaylistId);
    if (!playlist) return;

    await api.removeTrackFromPlaylist(playlist.id, trackId);
    playlist.trackIds = playlist.trackIds.filter((id) => id !== trackId);
    renderPlaylistDetail();
    renderPlaylists();
    renderRecentlyPlayed();
    showToast("Трек удалён из плейлиста");
}

async function toggleFavorite(trackId: string) {
    const favorites = state.playlists.find((playlist) => playlist.id === FAVORITES_PLAYLIST_ID);
    if (!favorites) return;

    const isFavorite = favorites.trackIds.includes(trackId);
    if (isFavorite) {
        await api.removeTrackFromPlaylist(favorites.id, trackId);
        favorites.trackIds = favorites.trackIds.filter((id) => id !== trackId);
    } else {
        await api.addTrackToPlaylist(favorites.id, trackId);
        favorites.trackIds.push(trackId);
    }

    updateHomeFavoritesCount();
    updateFavoriteButton();
    renderPlaylists();
    renderActiveTrackList();
    renderRecentlyPlayed();
    showToast(isFavorite ? "Трек удалён из избранного" : "Трек добавлен в избранное");
}

function updateFavoriteButton() {
    const favorites = state.playlists.find((playlist) => playlist.id === FAVORITES_PLAYLIST_ID);
    const isFavorite = Boolean(state.currentTrackId && favorites?.trackIds.includes(state.currentTrackId));
    const label = isFavorite ? "Убрать из избранного" : "Добавить в избранное";

    elements.favoriteBtn.disabled = !state.currentTrackId;
    elements.favoriteBtn.classList.toggle("added", isFavorite);
    elements.favoriteBtn.title = label;
    elements.favoriteBtn.setAttribute("aria-label", label);
}

function updateHomeFavoritesCount() {
    const favorites = state.playlists.find((playlist) => playlist.id === FAVORITES_PLAYLIST_ID);
    if (favorites) elements.homeFavoritesCount.textContent = `${favorites.trackIds.length} треков`;
}

async function playTrack(
    trackId: string,
    queueTrackIds = state.tracks.map((track) => track.id),
    queuePlaylistId: string | null = null,
) {
    const track = state.tracks.find((t) => t.id === trackId);
    if (!track) return;

    state.playbackQueueTrackIds = [...new Set(queueTrackIds)].filter((id) => state.tracks.some((item) => item.id === id));
    if (!state.playbackQueueTrackIds.includes(trackId)) state.playbackQueueTrackIds.push(trackId);
    state.playbackQueuePlaylistId = queuePlaylistId;

    closeTrackEditor();
    if (state.activeView === "playlist-detail" && state.selectedPlaylistId) {
        recordRecentlyPlayed("playlist", state.selectedPlaylistId);
    }
    recordRecentlyPlayed("track", trackId);

    if (state.currentTrackId !== trackId) {
        try {
            audioStatus = await api.playAudio(track.path, 0, true, audioStatus.volume);
        } catch (error) {
            state.isPlaying = audioStatus.isPlaying;
            showToast(`Не удалось воспроизвести аудио: ${String(error)}`, true);
            return;
        }
        state.currentTrackId = trackId;
        updateTrackMetadata(track);
    } else {
        try {
            audioStatus = audioStatus.loaded
                ? await api.resumeAudio()
                : await api.playAudio(track.path, audioStatus.positionSecs, true, audioStatus.volume);
        } catch (error) {
            showToast(`Не удалось продолжить воспроизведение: ${String(error)}`, true);
        }
    }

    state.isPlaying = audioStatus.isPlaying;
    updateProgressDisplay();
    updateProgressTooltip(audioStatus.positionSecs);
    updatePlayButtonIcon();
    renderActiveTrackList();
    savePlayerConfig();
}

function recordRecentlyPlayed(kind: RecentItemKind, entityId: string) {
    recentSaveQueue = recentSaveQueue
        .then(async () => {
            state.recentItems = await api.recordRecentlyPlayed(kind, entityId);
            renderRecentlyPlayed();
        })
        .catch((error) => console.error("Не удалось сохранить историю прослушивания:", error));
}

function updateTrackMetadata(track: Track) {
    const cover = track.cover || "./src/assets/media_library.jpg";
    elements.sidebarCoverWrapper.classList.toggle("has-cover", Boolean(track.cover));

    elements.playerTitle.textContent = track.title;
    elements.playerArtist.textContent = track.artist;
    elements.sidebarTitle.textContent = track.title;
    elements.sidebarArtist.textContent = track.artist;
    elements.editTrackBtn.disabled = false;
    elements.changeTrackCoverBtn.disabled = false;
    updateFavoriteButton();
    requestAnimationFrame(updateTrackTextMarquee);

    [elements.playerCover, elements.sidebarCover].forEach((image) => {
        image.src = cover;
        image.alt = track.title;
    });
}

function openTrackEditor() {
    const track = state.tracks.find((item) => item.id === state.currentTrackId);
    if (!track) return;

    elements.trackTitleInput.value = track.title;
    elements.trackArtistInput.value = track.artist === "Неизвестный исполнитель" ? "" : track.artist;
    elements.trackEditStatus.textContent = "";
    elements.trackEditStatus.hidden = true;
    elements.trackEditForm.hidden = false;
    elements.editTrackBtn.hidden = true;
    elements.trackTitleInput.focus();
}

function closeTrackEditor() {
    elements.trackEditForm.hidden = true;
    elements.editTrackBtn.hidden = false;
}

async function reloadTrackAudio(track: Track, position: number, shouldPlay: boolean) {
    audioStatus = await api.playAudio(track.path, position, shouldPlay, audioStatus.volume);
    state.isPlaying = audioStatus.isPlaying;

    updatePlayButtonIcon();
    updateProgressDisplay();
    savePlayerConfig();
}

async function saveTrackMetadata() {
    const track = state.tracks.find((item) => item.id === state.currentTrackId);
    const title = elements.trackTitleInput.value.trim();
    const artist = elements.trackArtistInput.value.trim();
    if (!track || !title) return;
    const wasCurrentTrack = state.currentTrackId === track.id;
    const playbackPosition = audioStatus.positionSecs;
    const wasPlaying = wasCurrentTrack && state.isPlaying;

    elements.saveTrackEditBtn.disabled = true;
    elements.cancelTrackEditBtn.disabled = true;
    elements.trackEditStatus.hidden = false;
    elements.trackEditStatus.textContent = "Сохранение...";

    try {
        if (wasCurrentTrack) {
            audioStatus = await api.stopAudio();
            state.isPlaying = false;
            updatePlayButtonIcon();
        }
        const storedTrack = await api.editTrack(track.id, title, artist);
        const updatedTrack = { ...mapStoredTrack(storedTrack), cover: track.cover };
        state.tracks = state.tracks.map((item) => item.id === updatedTrack.id ? updatedTrack : item);

        if (state.currentTrackId === updatedTrack.id) {
            updateTrackMetadata(updatedTrack);
            if (wasCurrentTrack) {
                await reloadTrackAudio(updatedTrack, playbackPosition, wasPlaying);
            }
        }

        renderActiveTrackList();
        renderRecentlyPlayed();
        closeTrackEditor();
        elements.trackEditStatus.hidden = true;
        showToast("Изменения сохранены");
    } catch (error) {
        if (wasCurrentTrack && state.currentTrackId === track.id) {
            try {
                await reloadTrackAudio(track, playbackPosition, wasPlaying);
            } catch (reloadError) {
                console.error("Не удалось восстановить воспроизведение:", reloadError);
            }
        }
        elements.trackEditStatus.textContent = error instanceof Error ? error.message : "Не удалось сохранить изменения";
        elements.trackEditStatus.hidden = false;
    } finally {
        elements.saveTrackEditBtn.disabled = false;
        elements.cancelTrackEditBtn.disabled = false;
    }
}

function renderActiveTrackList() {
    if (state.activeView === "media-library") renderMediaLibrary();
    if (state.activeView === "playlist-detail") renderPlaylistDetail();
}

async function togglePlay() {
    if (!state.currentTrackId && state.tracks.length > 0) {
        playTrack(state.tracks[0].id);
        return;
    }
    if (!state.currentTrackId) return;

    try {
        const track = state.tracks.find((item) => item.id === state.currentTrackId);
        audioStatus = state.isPlaying
            ? await api.pauseAudio()
            : audioStatus.loaded
                ? await api.resumeAudio()
                : track
                    ? await api.playAudio(track.path, audioStatus.positionSecs, true, audioStatus.volume)
                    : audioStatus;
        state.isPlaying = audioStatus.isPlaying;
    } catch (error) {
        showToast(`Не удалось изменить воспроизведение: ${String(error)}`, true);
    }
    updatePlayButtonIcon();
    renderActiveTrackList();
    savePlayerConfig();
}

function updatePlayButtonIcon() {
    elements.playBtn.innerHTML = state.isPlaying
        ? `<svg class="icon-svg" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>`
        : `<svg class="icon-svg" viewBox="0 0 24 24" fill="currentColor"><polygon points="6,4 20,12 6,20" /></svg>`;
}

function updatePlaybackModeButtons() {
    const repeatLabels = {
        off: ["Повтор выключен", "Включить повтор всех треков"],
        all: ["Повтор всех треков", "Включить повтор одного трека"],
        one: ["Повтор одного трека", "Выключить повтор"],
    } as const;
    const [repeatTitle, repeatLabel] = repeatLabels[state.repeatMode];
    elements.repeatBtn.classList.toggle("active", state.repeatMode !== "off");
    elements.repeatBtn.classList.toggle("repeat-one", state.repeatMode === "one");
    elements.repeatBtn.title = repeatTitle;
    elements.repeatBtn.setAttribute("aria-label", repeatLabel);
    elements.repeatBtn.setAttribute("aria-pressed", String(state.repeatMode !== "off"));

    elements.shuffleBtn.classList.toggle("active", state.shuffleEnabled);
    elements.shuffleBtn.title = `Случайный порядок ${state.shuffleEnabled ? "включён" : "выключен"}`;
    elements.shuffleBtn.setAttribute("aria-label", state.shuffleEnabled ? "Выключить случайный порядок" : "Включить случайный порядок");
    elements.shuffleBtn.setAttribute("aria-pressed", String(state.shuffleEnabled));
}

function toggleRepeatMode() {
    state.repeatMode = state.repeatMode === "off" ? "all" : state.repeatMode === "all" ? "one" : "off";
    updatePlaybackModeButtons();
}

function toggleShuffle() {
    state.shuffleEnabled = !state.shuffleEnabled;
    updatePlaybackModeButtons();
}

async function playNextTrack(naturalEnd = false) {
    const queueTrackIds = getPlaybackQueueTrackIds();
    if (!queueTrackIds.length) return;
    const nextTrackId = await api.getNextTrackId({
        trackIds: queueTrackIds,
        currentTrackId: state.currentTrackId,
        repeatMode: state.repeatMode,
        shuffleEnabled: state.shuffleEnabled,
        naturalEnd,
    });
    if (nextTrackId) {
        if (naturalEnd && nextTrackId === state.currentTrackId) {
            const track = state.tracks.find((item) => item.id === nextTrackId);
            if (track) {
                try {
                    audioStatus = await api.playAudio(track.path, 0, true, audioStatus.volume);
                    state.isPlaying = audioStatus.isPlaying;
                    updatePlayButtonIcon();
                    savePlayerConfig();
                } catch (error) {
                    state.isPlaying = false;
                    showToast(`Не удалось повторить трек: ${String(error)}`, true);
                }
            }
        } else {
            await playTrack(nextTrackId, queueTrackIds, state.playbackQueuePlaylistId);
        }
    } else if (naturalEnd) {
        state.isPlaying = false;
        updatePlayButtonIcon();
        renderActiveTrackList();
        savePlayerConfig();
    }
}

function getPlaybackQueueTrackIds() {
    const sourcePlaylist = state.playbackQueuePlaylistId
        ? state.playlists.find((playlist) => playlist.id === state.playbackQueuePlaylistId)
        : undefined;
    const trackIds = sourcePlaylist?.trackIds ?? state.playbackQueueTrackIds;
    return [...new Set(trackIds)].filter((id) => state.tracks.some((track) => track.id === id));
}

async function playPrevTrack() {
    const queueTrackIds = getPlaybackQueueTrackIds();
    if (!queueTrackIds.length) return;
    const previousTrackId = await api.getPreviousTrackId(queueTrackIds, state.currentTrackId, state.shuffleEnabled);
    if (previousTrackId) playTrack(previousTrackId, queueTrackIds, state.playbackQueuePlaylistId);
}

let playlistToEditId: string | null = null;

function openCreatePlaylistModal() {
    playlistToEditId = null;
    elements.playlistModalTitle.textContent = "Новый плейлист";
    elements.submitPlaylistBtn.textContent = "Создать";
    elements.playlistNameInput.value = "";
    elements.playlistCategorySelect.value = "Плейлист";
    elements.playlistFormStatus.textContent = "";
    elements.playlistFormStatus.hidden = true;
    openModal(elements.createPlaylistModal);
}

function openEditPlaylistModal() {
    const playlist = state.playlists.find((item) => item.id === state.selectedPlaylistId);
    if (!playlist) return;

    playlistToEditId = playlist.id;
    elements.playlistModalTitle.textContent = "Редактировать плейлист";
    elements.submitPlaylistBtn.textContent = "Сохранить";
    elements.playlistNameInput.value = playlist.title;
    elements.playlistCategorySelect.value = playlist.category;
    elements.playlistFormStatus.textContent = "";
    elements.playlistFormStatus.hidden = true;
    openModal(elements.createPlaylistModal);
    elements.playlistNameInput.focus();
}

async function submitPlaylistForm() {
    const name = elements.playlistNameInput.value.trim();
    const category = elements.playlistCategorySelect.value as PlaylistCategory;
    const isEditing = playlistToEditId !== null;
    if (!name) {
        elements.playlistFormStatus.textContent = "Введите название плейлиста";
        elements.playlistFormStatus.hidden = false;
        elements.playlistNameInput.focus();
        return;
    }

    elements.submitPlaylistBtn.disabled = true;
    elements.playlistFormStatus.hidden = true;

    try {
        if (playlistToEditId) {
            const storedPlaylist = await api.editPlaylist(playlistToEditId, name, category);
            const updatedPlaylist = mapStoredPlaylist(storedPlaylist);
            state.playlists = state.playlists.map((playlist) => playlist.id === updatedPlaylist.id ? updatedPlaylist : playlist);
            renderPlaylists();
            renderPlaylistDetail();
            renderRecentlyPlayed();
        } else {
            await createPlaylist(name, category);
        }

        closeModal(elements.createPlaylistModal);
        playlistToEditId = null;
        showToast(isEditing ? "Изменения сохранены" : "Плейлист создан");
    } catch (error) {
        elements.playlistFormStatus.textContent = error instanceof Error ? error.message : "Не удалось сохранить плейлист";
        elements.playlistFormStatus.hidden = false;
    } finally {
        elements.submitPlaylistBtn.disabled = false;
    }
}

async function createPlaylist(title: string, category: PlaylistCategory) {
    if (!title.trim()) return;
    const storedPlaylist = await api.createPlaylist(title.trim(), category);
    const newPlaylist = mapStoredPlaylist(storedPlaylist);
    if (trackToAddToPlaylist) {
        await api.addTrackToPlaylist(newPlaylist.id, trackToAddToPlaylist);
        newPlaylist.trackIds.push(trackToAddToPlaylist);
        trackToAddToPlaylist = null;
    }
    state.playlists.push(newPlaylist);
    closeModal(elements.createPlaylistModal);
    if (state.activeView === "playlists") renderPlaylists();
}

function renderPlaylists() {
    if (state.playlists.length === 0) {
        elements.playlistsEmptyState?.classList.remove("hidden");
        elements.playlistsGrid.innerHTML = "";
    } else {
        elements.playlistsEmptyState?.classList.add("hidden");
        elements.playlistsGrid.innerHTML = state.playlists
            .map(
                (pl) => `
      <div class="media-card" data-playlist-id="${pl.id}">
        <div class="card-cover-wrapper">
                    <div class="card-cover playlist-cover" style="background:#282828; display:flex; align-items:center; justify-content:center;">
                        ${pl.cover
                            ? `<img src="${pl.cover}" alt="Обложка: ${pl.title}" />`
                            : pl.id === FAVORITES_PLAYLIST_ID
                                ? `<img src="./src/assets/favorites.jpg" alt="Обложка: ${pl.title}" />`
                                : "🎵"}
                    </div>
        </div>
        <div class="card-title">${pl.title}</div>
        <div class="playlist-category-label">${pl.category}</div>
        <div class="card-artist">${pl.trackIds.length} треков</div>
      </div>
    `,
            )
            .join("");

        elements.playlistsGrid.querySelectorAll(".media-card").forEach((card) => {
            card.addEventListener("click", () => {
                const id = card.getAttribute("data-playlist-id");
                if (id) {
                    state.selectedPlaylistId = id;
                    switchView("playlist-detail");
                }
            });
        });
    }
    updateHomeFavoritesCount();
}

function renderPlaylistDetail() {
    const playlist = state.playlists.find((p) => p.id === state.selectedPlaylistId);
    if (!playlist) return;

    elements.playlistDetailTitle.textContent = playlist.title;
    elements.playlistDetailCount.textContent = `${playlist.category} · ${playlist.trackIds.length} треков`;
    const isFavorites = playlist.id === FAVORITES_PLAYLIST_ID;
    elements.editPlaylistBtn.hidden = isFavorites;
    elements.deletePlaylistBtn.hidden = isFavorites;
    elements.changePlaylistCoverBtn.hidden = isFavorites;

    const playlistTracks = playlist.trackIds.flatMap((trackId) => {
        const track = state.tracks.find((item) => item.id === trackId);
        return track ? [track] : [];
    });
    renderTrackList(elements.playlistTrackListContainer, playlistTracks, "playlist");
}

function openModal(modal: HTMLElement) {
    modal.classList.remove("hidden");
}

function closeModal(modal: HTMLElement) {
    modal.classList.add("hidden");
}

let trackToAddToPlaylist: string | null = null;
function openAddToPlaylistModal(trackId: string) {
    trackToAddToPlaylist = trackId;
    elements.modalPlaylistsList.innerHTML = state.playlists
        .map(
            (pl) => `
    <button class="action-card modal-pl-item" data-id="${pl.id}" style="width: 100%; margin-bottom: 8px;">
      <span>${pl.title}</span>
    </button>
  `,
        )
        .join("");

    if (state.playlists.length === 0) {
        elements.modalPlaylistsList.classList.add("hidden");
        elements.modalPlaylistsEmpty.classList.remove("hidden");
        openModal(elements.addToPlaylistModal);
        return;
    }

    elements.modalPlaylistsEmpty.classList.add("hidden");
    elements.modalPlaylistsList.classList.remove("hidden");
    elements.modalPlaylistsList.querySelectorAll(".modal-pl-item").forEach((btn) => {
        btn.addEventListener("click", async () => {
            const plId = btn.getAttribute("data-id");
            if (plId && trackToAddToPlaylist) {
                const pl = state.playlists.find((p) => p.id === plId);
                if (pl && !pl.trackIds.includes(trackToAddToPlaylist)) {
                    await api.addTrackToPlaylist(plId, trackToAddToPlaylist);
                    pl.trackIds.push(trackToAddToPlaylist);
                    renderPlaylists();
                    renderRecentlyPlayed();
                    showToast("Трек добавлен в плейлист");
                }
                closeModal(elements.addToPlaylistModal);
                trackToAddToPlaylist = null;
            }
        });
    });

    openModal(elements.addToPlaylistModal);
}

async function initEvents() {
    try {
        await listen<AudioStatus>("audio-state", ({ payload }) => {
            const wasPlaying = state.isPlaying;
            audioStatus = payload;
            state.isPlaying = payload.isPlaying;
            const currentTrack = state.tracks.find((track) => track.id === state.currentTrackId);
            if (currentTrack && payload.durationSecs > 0) currentTrack.duration = payload.durationSecs;
            updateProgressDisplay();

            if (wasPlaying !== state.isPlaying) {
                updatePlayButtonIcon();
                renderActiveTrackList();
            }
            if (payload.ended) void playNextTrack(true);
        });
    } catch (error) {
        console.error("Не удалось подписаться на состояние аудио:", error);
        showToast("Не удалось подключить управление аудио", true);
    }

    window.addEventListener("resize", updateTrackTextMarquee);
    document.addEventListener("click", () => {
        document.querySelectorAll<HTMLElement>(".track-actions-popover:not([hidden])").forEach((menu) => {
            menu.hidden = true;
            menu.closest(".track-actions-menu")?.querySelector(".track-menu-trigger")?.setAttribute("aria-expanded", "false");
        });
    });
    document.addEventListener("keydown", (event) => {
        if (event.key !== "Escape") return;
        document.querySelectorAll<HTMLElement>(".track-actions-popover:not([hidden])").forEach((menu) => {
            menu.hidden = true;
            const trigger = menu.closest(".track-actions-menu")?.querySelector<HTMLButtonElement>(".track-menu-trigger");
            trigger?.setAttribute("aria-expanded", "false");
            trigger?.focus();
        });
    });

    // Навигация
    elements.mainBtn?.addEventListener("click", () => switchView("main"));
    elements.mediaLibraryBtn?.addEventListener("click", () => switchView("media-library"));
    elements.playlistsBtn?.addEventListener("click", () => switchView("playlists"));
    const openCardFromKeyboard = (event: KeyboardEvent, open: () => void) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        open();
    };
    elements.homeMediaLibraryCard?.addEventListener("click", () => switchView("media-library"));
    elements.homeMediaLibraryCard?.addEventListener("keydown", (event) => {
        openCardFromKeyboard(event, () => switchView("media-library"));
    });
    const openFavorites = () => {
        state.selectedPlaylistId = FAVORITES_PLAYLIST_ID;
        switchView("playlist-detail");
    };
    elements.homeFavoritesCard?.addEventListener("click", openFavorites);
    elements.homeFavoritesCard?.addEventListener("keydown", (event) => openCardFromKeyboard(event, openFavorites));

    // Добавление треков
    elements.addTrackBtn?.addEventListener("click", addTrackHandler);
    elements.libraryAddTrackBtn?.addEventListener("click", addTrackHandler);
    elements.emptyScanBtn?.addEventListener("click", addTrackHandler);

    // Создание плейлистов
    const openPlModal = openCreatePlaylistModal;
    elements.createPlaylistBtn?.addEventListener("click", openPlModal);
    elements.playlistsCreateBtn?.addEventListener("click", openPlModal);
    elements.emptyCreatePlaylistBtn?.addEventListener("click", openPlModal);
    elements.submitPlaylistBtn?.addEventListener("click", submitPlaylistForm);

    elements.closeAddPlaylistModalBtn?.addEventListener("click", () => {
        closeModal(elements.addToPlaylistModal);
        trackToAddToPlaylist = null;
    });

    elements.modalCreatePlaylistBtn?.addEventListener("click", () => {
        closeModal(elements.addToPlaylistModal);
        openCreatePlaylistModal();
        elements.playlistNameInput.focus();
    });
    elements.closeModalBtn?.addEventListener("click", () => {
        closeModal(elements.createPlaylistModal);
        trackToAddToPlaylist = null;
        playlistToEditId = null;
    });

    // Плейлист Detail Навигация/Удаление
    elements.playlistBackBtn?.addEventListener("click", () => switchView("playlists"));
    elements.editPlaylistBtn?.addEventListener("click", openEditPlaylistModal);
    elements.changePlaylistCoverBtn?.addEventListener("click", async () => {
        if (!state.selectedPlaylistId || state.selectedPlaylistId === FAVORITES_PLAYLIST_ID) return;
        try {
            await changeCover("playlist", state.selectedPlaylistId);
        } catch (error) {
            showToast(`Не удалось сохранить обложку: ${String(error)}`, true);
        }
    });
    elements.deletePlaylistBtn?.addEventListener("click", async () => {
        if (state.selectedPlaylistId) {
            const playlistId = state.selectedPlaylistId;
            await api.deletePlaylist(playlistId);
            if (state.playbackQueuePlaylistId === playlistId) {
                state.playbackQueuePlaylistId = null;
                state.playbackQueueTrackIds = state.tracks.map((track) => track.id);
            }
            state.playlists = state.playlists.filter((p) => p.id !== playlistId);
            state.recentItems = state.recentItems.filter((item) => item.kind !== "playlist" || item.entity_id !== playlistId);
            renderRecentlyPlayed();
            switchView("playlists");
            showToast("Плейлист удалён");
        }
    });

    // Воспроизведение
    elements.changeTrackCoverBtn?.addEventListener("click", async () => {
        if (!state.currentTrackId) return;
        try {
            await changeCover("track", state.currentTrackId);
        } catch (error) {
            showToast(`Не удалось сохранить обложку: ${String(error)}`, true);
        }
    });
    elements.editTrackBtn?.addEventListener("click", openTrackEditor);
    elements.favoriteBtn?.addEventListener("click", async () => {
        if (!state.currentTrackId) return;
        try {
            await toggleFavorite(state.currentTrackId);
        } catch (error) {
            showToast(`Не удалось обновить избранное: ${String(error)}`, true);
        }
    });
    elements.trackEditForm?.addEventListener("submit", (event) => {
        event.preventDefault();
        void saveTrackMetadata();
    });
    elements.cancelTrackEditBtn?.addEventListener("click", closeTrackEditor);
    elements.playBtn?.addEventListener("click", togglePlay);
    elements.nextBtn?.addEventListener("click", () => void playNextTrack());
    elements.prevBtn?.addEventListener("click", playPrevTrack);
    elements.repeatBtn?.addEventListener("click", toggleRepeatMode);
    elements.shuffleBtn?.addEventListener("click", toggleShuffle);
    updatePlaybackModeButtons();

    window.setInterval(() => {
        if (state.isPlaying) savePlayerConfig();
    }, 5000);

    elements.progressSlider?.addEventListener("input", () => {
        const seekTime = Number(elements.progressSlider.value);
        void api.seekAudio(seekTime).then((status) => {
            audioStatus = status;
        }).catch((error) => {
            showToast(`Не удалось изменить позицию: ${String(error)}`, true);
        });
        updateProgressDisplay(seekTime);
        updateProgressTooltip(seekTime);
        savePlayerConfig();
    });

    elements.progressSlider?.addEventListener("pointermove", (event) => {
        const bounds = elements.progressSlider.getBoundingClientRect();
        const progress = Math.min(1, Math.max(0, (event.clientX - bounds.left) / bounds.width));
        const duration = Number.isFinite(audioStatus.durationSecs) ? audioStatus.durationSecs : 0;
        updateProgressTooltip(progress * duration);
    });

    elements.volumeSlider?.addEventListener("input", () => {
        const volume = Number(elements.volumeSlider.value) / 100;
        void api.setAudioVolume(volume).then((status) => {
            audioStatus = status;
            savePlayerConfig();
        }).catch((error) => {
            showToast(`Не удалось изменить громкость: ${String(error)}`, true);
        });
    });

    // Поиск
    elements.searchInput?.addEventListener("input", (e) => {
        const val = (e.target as HTMLInputElement).value.toLowerCase().trim();
        if (!val) {
            elements.searchDropdown?.classList.add("hidden");
            return;
        }

        const matched = state.tracks.filter((t) => t.title.toLowerCase().includes(val) || t.artist.toLowerCase().includes(val));

        if (matched.length > 0) {
            elements.searchDropdown?.classList.remove("hidden");
            elements.searchResultsList.innerHTML = matched
                .map(
                    (t) => `
        <div class="search-item" data-id="${t.id}" style="padding: 8px; cursor: pointer;">
          <div>${t.title}</div>
          <small style="opacity: 0.7">${t.artist}</small>
        </div>
      `,
                )
                .join("");

            elements.searchResultsList.querySelectorAll(".search-item").forEach((item) => {
                item.addEventListener("click", () => {
                    const id = item.getAttribute("data-id");
                    if (id) playTrack(id);
                    elements.searchDropdown?.classList.add("hidden");
                });
            });
        } else {
            elements.searchDropdown?.classList.add("hidden");
        }
    });
}

// Запуск приложения
document.addEventListener("DOMContentLoaded", async () => {
    await initEvents();
    try {
        await loadSavedData();
    } catch (error) {
        console.error("Не удалось загрузить сохранённую библиотеку:", error);
    }
    switchView("main");
});
