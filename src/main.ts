import { open } from "@tauri-apps/plugin-dialog";
import { convertFileSrc, invoke } from "@tauri-apps/api/core";

type PlaylistCategory = "EP" | "Альбом" | "Плейлист";

interface Track {
    id: string;
    title: string;
    artist: string;
    path: string;
    src: string;
    duration: number;
    cover?: string;
}

interface Playlist {
    id: string;
    title: string;
    category: PlaylistCategory;
    trackIds: string[];
}

interface StoredTrack {
    id: string;
    path: string;
    title: string;
    artist: string | null;
    duration: number;
}

interface StoredPlaylist {
    id: string;
    name: string;
    category: PlaylistCategory;
    id_tracks: string[];
}

interface PlayerConfig {
    current_track_id: string | null;
    position_secs: number;
    volume: number;
    is_playing: boolean;
}

interface AppState {
    tracks: Track[];
    playlists: Playlist[];
    currentTrackId: string | null;
    isPlaying: boolean;
    activeView: "main" | "media-library" | "playlists" | "playlist-detail";
    selectedPlaylistId: string | null;
    searchQuery: string;
}

const state: AppState = {
    tracks: [],
    playlists: [],
    currentTrackId: null,
    isPlaying: false,
    activeView: "main",
    selectedPlaylistId: null,
    searchQuery: "",
};

const audio = new Audio();
let pendingRestore: PlayerConfig | null = null;
let playerSaveQueue: Promise<void> = Promise.resolve();

function mapStoredTrack(track: StoredTrack): Track {
    return {
        ...track,
        artist: track.artist || "Неизвестный исполнитель",
        src: convertFileSrc(track.path),
    };
}

function mapStoredPlaylist(playlist: StoredPlaylist): Playlist {
    return {
        id: playlist.id,
        title: playlist.name,
        category: playlist.category || "Плейлист",
        trackIds: playlist.id_tracks,
    };
}

function savePlayerConfig() {
    const config: PlayerConfig = {
        current_track_id: state.currentTrackId,
        position_secs: Number.isFinite(audio.currentTime) ? audio.currentTime : 0,
        volume: audio.volume,
        is_playing: state.isPlaying,
    };

    playerSaveQueue = playerSaveQueue
        .then(() => invoke<void>("save_player_config", {
            currentTrackId: config.current_track_id,
            positionSecs: config.position_secs,
            volume: config.volume,
            isPlaying: config.is_playing,
        }))
        .catch((error) => console.error("Не удалось сохранить состояние плеера:", error));
}

async function loadSavedData() {
    const [tracks, playlists, playerConfig] = await Promise.all([
        invoke<StoredTrack[]>("get_library"),
        invoke<StoredPlaylist[]>("get_playlists"),
        invoke<PlayerConfig>("get_player_config"),
    ]);
    state.tracks = tracks.map(mapStoredTrack);
    state.playlists = playlists.map(mapStoredPlaylist);

    audio.volume = playerConfig.volume;
    elements.volumeSlider.value = Math.round(playerConfig.volume * 100).toString();

    const savedTrack = state.tracks.find((track) => track.id === playerConfig.current_track_id);
    if (savedTrack) {
        pendingRestore = playerConfig;
        state.currentTrackId = savedTrack.id;
        state.isPlaying = playerConfig.is_playing;
        audio.src = savedTrack.src;
        updateTrackMetadata(savedTrack);
        updatePlayButtonIcon();
    }

    renderMediaLibrary();
    renderPlaylists();
}

const elements = {
    // Навигация
    mainBtn: document.getElementById("main-btn") as HTMLButtonElement,
    mediaLibraryBtn: document.getElementById("media-libary-btn") as HTMLButtonElement,
    playlistsBtn: document.getElementById("playlists-btn") as HTMLButtonElement,

    // Вьюшки
    viewMain: document.getElementById("view-main") as HTMLElement,
    viewMediaLibrary: document.getElementById("view-media-library") as HTMLElement,
    viewPlaylists: document.getElementById("view-playlists") as HTMLElement,
    viewPlaylistDetail: document.getElementById("view-playlist-detail") as HTMLElement,

    // Кнопки добавления / создания
    addTrackBtn: document.getElementById("add-track-btn") as HTMLButtonElement,
    libraryAddTrackBtn: document.getElementById("library-add-track-btn") as HTMLButtonElement,
    emptyScanBtn: document.getElementById("empty-scan-btn") as HTMLButtonElement,
    createPlaylistBtn: document.getElementById("create-playlist-btn") as HTMLButtonElement,
    playlistsCreateBtn: document.getElementById("playlists-create-btn") as HTMLButtonElement,
    emptyCreatePlaylistBtn: document.getElementById("empty-create-playlist-btn") as HTMLButtonElement,

    // Списки и Empty-states
    mediaEmptyState: document.getElementById("media-empty-state") as HTMLElement,
    trackListContainer: document.getElementById("track-list-container") as HTMLElement,
    playlistsEmptyState: document.getElementById("playlists-empty-state") as HTMLElement,
    playlistsGrid: document.querySelector("#view-playlists .cards-grid") as HTMLElement,
    playlistTrackListContainer: document.getElementById("playlist-track-list-container") as HTMLElement,

    // Управление плейлистом
    playlistDetailTitle: document.getElementById("playlist-detail-title") as HTMLElement,
    playlistDetailCount: document.getElementById("playlist-detail-count") as HTMLElement,
    editPlaylistBtn: document.getElementById("edit-playlist-btn") as HTMLButtonElement,
    deletePlaylistBtn: document.getElementById("delete-playlist-btn") as HTMLButtonElement,
    playlistBackBtn: document.getElementById("playlist-back-btn") as HTMLButtonElement,

    // Плеер-бар
    playerTitle: document.getElementById("player-title") as HTMLElement,
    playerArtist: document.getElementById("player-artist") as HTMLElement,
    playerCover: document.getElementById("player-cover") as HTMLImageElement,
    sidebarTitle: document.getElementById("sidebar-title") as HTMLElement,
    sidebarArtist: document.getElementById("sidebar-artist") as HTMLElement,
    sidebarCover: document.getElementById("sidebar-cover") as HTMLImageElement,
    editTrackBtn: document.getElementById("edit-track-btn") as HTMLButtonElement,
    trackEditForm: document.getElementById("track-edit-form") as HTMLFormElement,
    trackTitleInput: document.getElementById("track-title-input") as HTMLInputElement,
    trackArtistInput: document.getElementById("track-artist-input") as HTMLInputElement,
    saveTrackEditBtn: document.getElementById("save-track-edit-btn") as HTMLButtonElement,
    cancelTrackEditBtn: document.getElementById("cancel-track-edit-btn") as HTMLButtonElement,
    trackEditStatus: document.getElementById("track-edit-status") as HTMLElement,
    playBtn: document.getElementById("play-btn") as HTMLButtonElement,
    prevBtn: document.getElementById("prev-btn") as HTMLButtonElement,
    nextBtn: document.getElementById("next-btn") as HTMLButtonElement,
    progressSlider: document.getElementById("progress-slider") as HTMLInputElement,
    progressTooltip: document.getElementById("progress-tooltip") as HTMLElement,
    volumeSlider: document.getElementById("volume-slider") as HTMLInputElement,
    currentTime: document.getElementById("current-time") as HTMLElement,
    totalTime: document.getElementById("total-time") as HTMLElement,

    // Модальные окна
    createPlaylistModal: document.getElementById("create-playlist-modal") as HTMLElement,
    closeModalBtn: document.getElementById("close-modal-btn") as HTMLButtonElement,
    submitPlaylistBtn: document.getElementById("submit-playlist-btn") as HTMLButtonElement,
    playlistNameInput: document.getElementById("playlist-name-input") as HTMLInputElement,
    playlistModalTitle: document.getElementById("playlist-modal-title") as HTMLElement,
    playlistCategorySelect: document.getElementById("playlist-category-select") as HTMLSelectElement,
    playlistFormStatus: document.getElementById("playlist-form-status") as HTMLElement,

    addToPlaylistModal: document.getElementById("add-to-playlist-modal") as HTMLElement,
    closeAddPlaylistModalBtn: document.getElementById("close-add-playlist-modal-btn") as HTMLButtonElement,
    modalPlaylistsList: document.getElementById("modal-playlists-list") as HTMLElement,
    modalPlaylistsEmpty: document.getElementById("modal-playlists-empty") as HTMLElement,
    modalCreatePlaylistBtn: document.getElementById("modal-create-playlist-btn") as HTMLButtonElement,

    // Поиск
    searchInput: document.querySelector(".search-input") as HTMLInputElement,
    searchDropdown: document.getElementById("search-dropdown") as HTMLElement,
    searchResultsList: document.getElementById("search-results-list") as HTMLElement,
};

function formatTime(seconds: number): string {
    if (isNaN(seconds) || seconds <= 0) return "0:00";
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs < 10 ? "0" : ""}${secs}`;
}

function updateProgressDisplay(time = audio.currentTime) {
    const duration = Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration : 0;
    const currentTime = Number.isFinite(time) && duration > 0 ? Math.min(Math.max(time, 0), duration) : 0;
    const sliderMax = Math.max(1, Math.floor(duration));

    elements.currentTime.textContent = formatTime(currentTime);
    elements.totalTime.textContent = formatTime(duration);
    elements.progressSlider.max = sliderMax.toString();
    elements.progressSlider.value = Math.min(Math.floor(currentTime), sliderMax).toString();
    elements.progressSlider.style.setProperty("--progress", `${duration > 0 ? (currentTime / duration) * 100 : 0}%`);
}

function updateProgressTooltip(time: number) {
    const duration = Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration : 0;
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
            const track = await invoke<StoredTrack>("import_track", { filePath });
            state.tracks.push(mapStoredTrack(track));
        }

        if (state.activeView === "media-library") renderMediaLibrary();
        if (state.activeView === "main") switchView("media-library");
    } catch (err) {
        console.error("Ошибка при выборе файла:", err);
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
            const actionButton =
                context === "playlist"
                    ? `<button class="btn-ctrl remove-from-pl-btn" data-id="${track.id}" title="Удалить из плейлиста" aria-label="Удалить ${track.title} из плейлиста">
          <svg class="icon-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="3 6 5 6 21 6"></polyline>
            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
          </svg>
        </button>`
                : `<button class="btn-ctrl add-to-pl-btn" data-id="${track.id}" title="Добавить в плейлист" aria-label="Добавить ${track.title} в плейлист">
                    <svg class="icon-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <line x1="12" y1="5" x2="12" y2="19"></line>
                        <line x1="5" y1="12" x2="19" y2="12"></line>
                    </svg>
                </button>`;

            return `
      <div class="track-row ${isCurrent ? "active" : ""} ${isPlaying ? "playing" : ""}" data-id="${track.id}">
        <span class="col-num">${idx + 1}</span>
        <span class="col-title">${track.title}</span>
        <span class="col-artist">${track.artist}</span>
        <span class="col-duration">${formatTime(track.duration)}</span>
        <span class="col-actions">${actionButton}</span>
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
            if (trackId) playTrack(trackId);
        });
    });

    // Действие кнопки зависит от того, где отображается список.
    container.querySelectorAll(".add-to-pl-btn").forEach((btn) => {
        btn.addEventListener("click", async (e) => {
            e.stopPropagation();
            const trackId = btn.getAttribute("data-id");
            if (trackId) openAddToPlaylistModal(trackId);
        });
    });

    container.querySelectorAll(".remove-from-pl-btn").forEach((btn) => {
        btn.addEventListener("click", async (e) => {
            e.stopPropagation();
            const trackId = btn.getAttribute("data-id");
            const playlist = state.playlists.find((item) => item.id === state.selectedPlaylistId);
            if (!trackId || !playlist) return;

            await invoke("remove_track_from_playlist", { playlistId: playlist.id, trackId });
            playlist.trackIds = playlist.trackIds.filter((id) => id !== trackId);
            renderPlaylistDetail();
            renderPlaylists();
        });
    });
}

function playTrack(trackId: string) {
    const track = state.tracks.find((t) => t.id === trackId);
    if (!track) return;

    closeTrackEditor();
    pendingRestore = null;

    if (state.currentTrackId !== trackId) {
        state.currentTrackId = trackId;
        audio.src = track.src;
        updateTrackMetadata(track);
        updateProgressDisplay();
        updateProgressTooltip(0);
    }

    audio.play();
    state.isPlaying = true;
    updatePlayButtonIcon();
    renderActiveTrackList();
    savePlayerConfig();
}

function updateTrackMetadata(track: Track) {
    const cover = track.cover || "./src/assets/media_library.jpg";

    elements.playerTitle.textContent = track.title;
    elements.playerArtist.textContent = track.artist;
    elements.sidebarTitle.textContent = track.title;
    elements.sidebarArtist.textContent = track.artist;
    elements.editTrackBtn.disabled = false;
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
    const metadataLoaded = new Promise<void>((resolve, reject) => {
        audio.addEventListener("loadedmetadata", () => resolve(), { once: true });
        audio.addEventListener("error", () => reject(new Error("Не удалось загрузить аудиофайл")), { once: true });
    });

    audio.src = track.src;
    audio.load();
    await metadataLoaded;
    audio.currentTime = Number.isFinite(audio.duration) ? Math.min(position, audio.duration) : position;

    if (shouldPlay) {
        try {
            await audio.play();
            state.isPlaying = true;
        } catch {
            state.isPlaying = false;
        }
    } else {
        state.isPlaying = false;
    }

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
    const playbackPosition = audio.currentTime;
    const wasPlaying = wasCurrentTrack && state.isPlaying;

    elements.saveTrackEditBtn.disabled = true;
    elements.cancelTrackEditBtn.disabled = true;
    elements.trackEditStatus.hidden = false;
    elements.trackEditStatus.textContent = "Сохранение...";

    if (wasCurrentTrack) {
        audio.pause();
        state.isPlaying = false;
        audio.removeAttribute("src");
        audio.load();
        updatePlayButtonIcon();
    }

    try {
        const storedTrack = await invoke<StoredTrack>("edit_metadata_track", {
            id: track.id,
            title,
            artist,
        });
        const updatedTrack = { ...mapStoredTrack(storedTrack), cover: track.cover };
        state.tracks = state.tracks.map((item) => item.id === updatedTrack.id ? updatedTrack : item);

        if (state.currentTrackId === updatedTrack.id) {
            updateTrackMetadata(updatedTrack);
            if (wasCurrentTrack) {
                await reloadTrackAudio(updatedTrack, playbackPosition, wasPlaying);
            }
        }

        renderActiveTrackList();
        closeTrackEditor();
        elements.trackEditStatus.textContent = "Изменения сохранены";
        elements.trackEditStatus.hidden = false;
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

function togglePlay() {
    if (!state.currentTrackId && state.tracks.length > 0) {
        playTrack(state.tracks[0].id);
        return;
    }
    if (!state.currentTrackId) return;

    if (state.isPlaying) {
        audio.pause();
        state.isPlaying = false;
    } else {
        audio.play();
        state.isPlaying = true;
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

function playNextTrack() {
    if (!state.tracks.length) return;
    const currIdx = state.tracks.findIndex((t) => t.id === state.currentTrackId);
    const nextIdx = (currIdx + 1) % state.tracks.length;
    playTrack(state.tracks[nextIdx].id);
}

function playPrevTrack() {
    if (!state.tracks.length) return;
    const currIdx = state.tracks.findIndex((t) => t.id === state.currentTrackId);
    const prevIdx = (currIdx - 1 + state.tracks.length) % state.tracks.length;
    playTrack(state.tracks[prevIdx].id);
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
            const storedPlaylist = await invoke<StoredPlaylist>("edit_metadata_playlist", {
                id: playlistToEditId,
                name,
                category,
            });
            const updatedPlaylist = mapStoredPlaylist(storedPlaylist);
            state.playlists = state.playlists.map((playlist) => playlist.id === updatedPlaylist.id ? updatedPlaylist : playlist);
            renderPlaylists();
            renderPlaylistDetail();
        } else {
            await createPlaylist(name, category);
        }

        closeModal(elements.createPlaylistModal);
        playlistToEditId = null;
    } catch (error) {
        elements.playlistFormStatus.textContent = error instanceof Error ? error.message : "Не удалось сохранить плейлист";
        elements.playlistFormStatus.hidden = false;
    } finally {
        elements.submitPlaylistBtn.disabled = false;
    }
}

async function createPlaylist(title: string, category: PlaylistCategory) {
    if (!title.trim()) return;
    const storedPlaylist = await invoke<StoredPlaylist>("create_playlist", { name: title.trim(), category });
    const newPlaylist = mapStoredPlaylist(storedPlaylist);
    if (trackToAddToPlaylist) {
        await invoke("add_track_to_playlist", {
            playlistId: newPlaylist.id,
            trackId: trackToAddToPlaylist,
        });
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
          <div class="card-cover" style="background:#282828; display:flex; align-items:center; justify-content:center;">🎵</div>
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
}

function renderPlaylistDetail() {
    const playlist = state.playlists.find((p) => p.id === state.selectedPlaylistId);
    if (!playlist) return;

    elements.playlistDetailTitle.textContent = playlist.title;
    elements.playlistDetailCount.textContent = `${playlist.category} · ${playlist.trackIds.length} треков`;

    const playlistTracks = state.tracks.filter((t) => playlist.trackIds.includes(t.id));
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
                    await invoke("add_track_to_playlist", { playlistId: plId, trackId: trackToAddToPlaylist });
                    pl.trackIds.push(trackToAddToPlaylist);
                }
                closeModal(elements.addToPlaylistModal);
                trackToAddToPlaylist = null;
            }
        });
    });

    openModal(elements.addToPlaylistModal);
}

function initEvents() {
    window.addEventListener("resize", updateTrackTextMarquee);

    // Навигация
    elements.mainBtn?.addEventListener("click", () => switchView("main"));
    elements.mediaLibraryBtn?.addEventListener("click", () => switchView("media-library"));
    elements.playlistsBtn?.addEventListener("click", () => switchView("playlists"));

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
    elements.deletePlaylistBtn?.addEventListener("click", async () => {
        if (state.selectedPlaylistId) {
            await invoke("delete_playlist", { playlistId: state.selectedPlaylistId });
            state.playlists = state.playlists.filter((p) => p.id !== state.selectedPlaylistId);
            switchView("playlists");
        }
    });

    // Воспроизведение
    elements.editTrackBtn?.addEventListener("click", openTrackEditor);
    elements.trackEditForm?.addEventListener("submit", (event) => {
        event.preventDefault();
        void saveTrackMetadata();
    });
    elements.cancelTrackEditBtn?.addEventListener("click", closeTrackEditor);
    elements.playBtn?.addEventListener("click", togglePlay);
    elements.nextBtn?.addEventListener("click", playNextTrack);
    elements.prevBtn?.addEventListener("click", playPrevTrack);

    // События Audio
    audio.addEventListener("loadedmetadata", async () => {
        const currentTrack = state.tracks.find((t) => t.id === state.currentTrackId);
        if (currentTrack) currentTrack.duration = audio.duration;

        if (pendingRestore && pendingRestore.current_track_id === state.currentTrackId) {
            const savedState = pendingRestore;
            pendingRestore = null;
            audio.currentTime = Math.min(savedState.position_secs, audio.duration);

            if (savedState.is_playing) {
                try {
                    await audio.play();
                    state.isPlaying = true;
                } catch {
                    state.isPlaying = false;
                }
                updatePlayButtonIcon();
            }
            savePlayerConfig();
        }

        updateProgressDisplay();
        renderActiveTrackList();
    });

    audio.addEventListener("timeupdate", () => {
        updateProgressDisplay();
    });

    window.setInterval(() => {
        if (state.isPlaying) savePlayerConfig();
    }, 5000);

    audio.addEventListener("ended", playNextTrack);

    elements.progressSlider?.addEventListener("input", () => {
        const seekTime = Number(elements.progressSlider.value);
        audio.currentTime = seekTime;
        updateProgressDisplay(seekTime);
        updateProgressTooltip(seekTime);
        savePlayerConfig();
    });

    elements.progressSlider?.addEventListener("pointermove", (event) => {
        const bounds = elements.progressSlider.getBoundingClientRect();
        const progress = Math.min(1, Math.max(0, (event.clientX - bounds.left) / bounds.width));
        const duration = Number.isFinite(audio.duration) ? audio.duration : 0;
        updateProgressTooltip(progress * duration);
    });

    elements.volumeSlider?.addEventListener("input", () => {
        audio.volume = Number(elements.volumeSlider.value) / 100;
        savePlayerConfig();
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
    initEvents();
    try {
        await loadSavedData();
    } catch (error) {
        console.error("Не удалось загрузить сохранённую библиотеку:", error);
    }
    switchView("main");
});
