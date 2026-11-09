import { api } from "../api";
import { FAVORITES_PLAYLIST_ID } from "../core/constants";
import { player, savePlayerConfig } from "../core/player";
import { closeModal, openModal, switchView } from "../core/views";
import { elements as dataElements } from "../elements/data";
import { elements } from "../elements/home";
import { elements as playerbarElements } from "../elements/playerbar";
import { elements as playlistsElements } from "../elements/playlists";
import { elements as sidebarElements } from "../elements/sidebar";
import { mapStoredTrack } from "../mappers";
import { state } from "../state";
import { getDefaultTrackCover } from "../assets";
import type { Track } from "../types";
import { formatTime, truncate } from "../utils/format";
import { showToast } from "../utils/toast";
import { playTrack, renderActiveTrackList, updatePlayButtonIcon, updateProgressDisplay } from "./playerbar";
import { closeTrackEditor, updateFavoriteButton } from "./sidebar";
import { openAddToPlaylistModal, renderPlaylistDetail, renderPlaylists, replaceTrackFromFile } from "./playlists";
import { renderRecentlyPlayed } from "./recentlyPlayed";
import { openRemixSpeedModal } from "./remix";
import { open } from "@tauri-apps/plugin-dialog";

interface MediaLibraryFilter {
    byArtist: boolean;
    byNameTrack: boolean;
    query: string;
}

let mediaLibraryFilter: MediaLibraryFilter = {
    byArtist: true,
    byNameTrack: true,
    query: "",
};
let pendingTrackDeletionId: string | null = null;
let trackDeleteModalOpener: HTMLElement | null = null;
let pendingPlaylistTrackRemoval: { playlistId: string; trackId: string } | null = null;
let playlistTrackRemovalModalOpener: HTMLElement | null = null;

export function openTrackDeleteConfirmation(trackId: string, opener: HTMLElement): void {
    pendingTrackDeletionId = trackId;
    trackDeleteModalOpener = opener;
    openModal(dataElements.deleteTrackModal);
    dataElements.closeDeleteTrackModalBtn.focus();
}

export function cancelTrackDeleteConfirmation(): void {
    pendingTrackDeletionId = null;
    closeModal(dataElements.deleteTrackModal);
    trackDeleteModalOpener?.focus();
    trackDeleteModalOpener = null;
}

export async function confirmTrackDeletion(): Promise<void> {
    const trackId = pendingTrackDeletionId;
    if (!trackId)
        return;

    dataElements.confirmDeleteTrackBtn.disabled = true;

    try {
        await deleteTrackFromLibrary(trackId);
        pendingTrackDeletionId = null;
        trackDeleteModalOpener = null;
        closeModal(dataElements.deleteTrackModal);
    }

    finally {
        dataElements.confirmDeleteTrackBtn.disabled = false;
    }
}

export function openPlaylistTrackRemovalConfirmation(trackId: string, opener: HTMLElement): void {
    const playlistId = state.selectedPlaylistId;
    if (!playlistId)
        return;
    pendingPlaylistTrackRemoval = { playlistId, trackId };
    playlistTrackRemovalModalOpener = opener;
    openModal(playlistsElements.removeTrackFromPlaylistModal);
    playlistsElements.closeRemoveTrackFromPlaylistModalBtn.focus();
}

export function cancelPlaylistTrackRemovalConfirmation(): void {
    pendingPlaylistTrackRemoval = null;
    closeModal(playlistsElements.removeTrackFromPlaylistModal);
    playlistTrackRemovalModalOpener?.focus();
    playlistTrackRemovalModalOpener = null;
}

export async function confirmPlaylistTrackRemoval(): Promise<void> {
    const pendingRemoval = pendingPlaylistTrackRemoval;
    if (!pendingRemoval)
        return;

    playlistsElements.confirmRemoveTrackFromPlaylistBtn.disabled = true;
    try {
        await removeTrackFromPlaylist(pendingRemoval.trackId, pendingRemoval.playlistId);
        pendingPlaylistTrackRemoval = null;
        playlistTrackRemovalModalOpener = null;
        closeModal(playlistsElements.removeTrackFromPlaylistModal);
    }
    finally {
        playlistsElements.confirmRemoveTrackFromPlaylistBtn.disabled = false;
    }
}

export function setMediaLibraryFilter(filter: MediaLibraryFilter): void {
    mediaLibraryFilter = { ...filter, query: filter.query.trim().toLocaleLowerCase() };
    renderMediaLibrary();
}

// Обновления количества треков в избранном на главной странице
export function updateHomeFavoritesCount(): void {
    const favorites = state.playlists.find((playlist) => playlist.id === FAVORITES_PLAYLIST_ID);
    if (favorites) elements.homeFavoritesCount.textContent = `${favorites.trackIds.length} треков`;
}

// Добавление трека в медиатеку
export async function addTrackHandler() {
    try {
        const selected = await open({
            multiple: true,
            filters: [{ name: "Audio", extensions: ["mp3", "wav", "flac", "ogg", "m4a"] }],
        });
        if (!selected)
            return;
        const paths = Array.isArray(selected) ? selected : [selected];
        for (const filePath of paths) {
            const track = await api.importTrack(filePath);
            state.tracks.push(mapStoredTrack(track));
        }
        showToast(paths.length === 1 ? "Трек добавлен" : `Добавлено треков: ${paths.length}`);
        if (state.activeView === "media-library")
            renderMediaLibrary();
        if (state.activeView === "main")
            switchView("media-library");
    }
    catch (err) {
        console.error("Ошибка при выборе файла:", err);
        showToast(`Не удалось добавить трек: ${String(err)}`, true);
    }
}

// Отрисовывает медиатеку с треками.
export function renderMediaLibrary() {
    if (state.tracks.length === 0) {
        elements.mediaEmptyState?.classList.remove("hidden");
        elements.mediaFilterEmptyState?.classList.add("hidden");
        elements.trackListContainer.style.display = "none";
    }
    else {
        elements.mediaEmptyState?.classList.add("hidden");
        const tracks = getFilteredLibraryTracks();
        if (tracks.length === 0) {
            elements.mediaFilterEmptyState?.classList.remove("hidden");
            elements.trackListContainer.style.display = "none";
            return;
        }
        elements.mediaFilterEmptyState?.classList.add("hidden");
        elements.trackListContainer.style.display = "";
        renderTrackList(elements.trackListContainer, tracks, "library");
    }
}

function getFilteredLibraryTracks(): Track[] {
    const { byArtist, byNameTrack, query } = mediaLibraryFilter;
    if (!query)
        return state.tracks;

    return state.tracks.filter((track) => {
        const matchesName = byNameTrack && track.title.toLocaleLowerCase().includes(query);
        const matchesArtist = byArtist && track.artist.toLocaleLowerCase().includes(query);
        return matchesName || matchesArtist;
    });
}

// Отрисовка списка треков в медиатеке или плейлисте
export function renderTrackList(container: HTMLElement, tracks: Track[], context: "library" | "playlist") {
    const header = context === "playlist" ? `
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
    </div>` : "";
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
                : `<button class="track-menu-option" type="button" role="menuitem" data-action="replace-track-in-playlist" data-id="${track.id}">Заменить трек</button>
                           <button class="track-menu-option track-menu-option-danger" type="button" role="menuitem" data-action="remove-from-playlist" data-id="${track.id}">Удалить из плейлиста</button>`
            : `<button class="track-menu-option" type="button" role="menuitem" data-action="add-to-playlist" data-id="${track.id}">Добавить в плейлист</button>
                       <button class="track-menu-option" type="button" role="menuitem" data-action="create-remix" data-id="${track.id}">Создать ремикс трека</button>
                       <button class="track-menu-option track-menu-option-danger" type="button" role="menuitem" data-action="delete-track" data-id="${track.id}">Удалить из медиатеки</button>`}
            `;
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
        if (context === "library") {
            return `
      <article class="media-card library-track-card ${isCurrent ? "active" : ""} ${isPlaying ? "playing" : ""}" data-id="${track.id}" role="button" tabindex="0" aria-label="Воспроизвести ${track.title}">
        <div class="card-cover-wrapper">
          <img class="card-cover" src="${track.cover || getDefaultTrackCover()}" alt="Обложка: ${track.title}" />
          <button class="card-play-btn library-track-play" type="button" aria-label="Воспроизвести ${track.title}">
            <svg class="icon-svg" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <polygon points="6,4 20,12 6,20"></polygon>
            </svg>
          </button>
        </div>
        ${actionMenu}
        <div class="card-title">${truncate(track.title)}</div>
        <div class="card-artist">${truncate(track.artist)}</div>
        <div class="library-track-duration">${formatTime(track.duration)}</div>
      </article>`;
        }
        return `
      <div class="track-row ${isCurrent ? "active" : ""} ${isPlaying ? "playing" : ""}" data-id="${track.id}">
        <span class="col-num">${idx + 1}</span>
        <span class="col-title">${truncate(track.title)}</span>
        <span class="col-artist">${truncate(track.artist)}</span>
        <span class="col-duration">${formatTime(track.duration)}</span>
        <span class="col-actions">${actionMenu}</span>
      </div>`;
    })
        .join("");
    container.innerHTML = header + rows;

    const itemSelector = context === "library" ? ".library-track-card" : ".track-row";
    container.querySelectorAll<HTMLElement>(itemSelector).forEach((row) => {
        row.addEventListener("click", (e) => {
            const target = e.target as HTMLElement;
            if (target.closest("button, .track-actions-menu"))
                return;
            const trackId = row.getAttribute("data-id");
            if (trackId) {
                const playlistId = context === "playlist" ? state.selectedPlaylistId : null;
                playTrack(trackId, tracks.map((item) => item.id), playlistId);
            }
        });
        if (context === "library") {
            row.addEventListener("keydown", (event: KeyboardEvent) => {
                if (event.target !== row || (event.key !== "Enter" && event.key !== " "))
                    return;
                event.preventDefault();
                const trackId = row.getAttribute("data-id");
                if (trackId)
                    playTrack(trackId, tracks.map((item) => item.id));
            });
        }
    });

    container.querySelectorAll<HTMLButtonElement>(".library-track-play").forEach((button) => {
        button.addEventListener("click", () => {
            const trackId = button.closest<HTMLElement>(".library-track-card")?.dataset.id;
            if (trackId)
                playTrack(trackId, tracks.map((item) => item.id));
        });
    });

    container.querySelectorAll<HTMLButtonElement>(".track-menu-trigger").forEach((button) => {
        button.addEventListener("click", (event) => {
            event.stopPropagation();
            const row = button.closest(".track-row, .library-track-card");
            const menu = row?.querySelector<HTMLElement>(".track-actions-popover");
            if (!menu)
                return;
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
            if (!trackId || !action)
                return;
            const menu = button.closest<HTMLElement>(".track-actions-popover");
            if (menu)
                menu.hidden = true;
            button.closest(".track-actions-menu")?.querySelector(".track-menu-trigger")?.setAttribute("aria-expanded", "false");
            try {
                if (action === "add-to-playlist") {
                    openAddToPlaylistModal(trackId);
                }
                else if (action === "toggle-favorite") {
                    await toggleFavorite(trackId);
                }
                else if (action === "create-remix") {
                    openRemixSpeedModal(trackId);
                }
                else if (action === "delete-track") {
                    openTrackDeleteConfirmation(trackId, button);
                }
                else if (action === "remove-from-playlist") {
                    openPlaylistTrackRemovalConfirmation(trackId, button);
                }
                else if (action === "replace-track-in-playlist") {
                    await replaceTrackFromFile(trackId);
                }
            }
            catch (error) {
                console.error("Не удалось выполнить действие с треком:", error);
                showToast(`Не удалось выполнить действие: ${String(error)}`, true);
            }
        });
    });
}

// Удаление трека из медиатеки
export async function deleteTrackFromLibrary(trackId: string, notify = true) {
    const currentTrack = state.currentTrackId === trackId
        ? state.tracks.find((track) => track.id === trackId)
        : undefined;
    const playbackPosition = player.audioStatus.positionSecs;
    const wasPlaying = state.isPlaying;
    
    if (currentTrack)
        player.audioStatus = await api.stopAudio();
    try {
        await api.deleteTrack(trackId);
    }
    catch (error) {
        if (currentTrack) {
            try {
                player.audioStatus = await api.playAudio(currentTrack.path, playbackPosition, wasPlaying, player.audioStatus.volume);
                state.isPlaying = player.audioStatus.isPlaying;
            }
            catch (restoreError) {
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
        playerbarElements.playerTitle.textContent = "Трек не выбран";
        playerbarElements.playerArtist.textContent = "Выберите трек для воспроизведения";
        sidebarElements.sidebarTitle.textContent = "Трек не выбран";
        sidebarElements.sidebarArtist.textContent = "Выберите трек для воспроизведения";
        sidebarElements.editTrackBtn.disabled = true;
        sidebarElements.changeTrackCoverBtn.disabled = true;
        updateFavoriteButton();
        sidebarElements.sidebarCoverWrapper.classList.remove("has-cover");
        playerbarElements.playerCover.src = getDefaultTrackCover();
        sidebarElements.sidebarCover.src = getDefaultTrackCover();
        closeTrackEditor();
        updatePlayButtonIcon();
        updateProgressDisplay(0);
        savePlayerConfig();
    }
    
    renderMediaLibrary();
    renderPlaylists();
    renderPlaylistDetail();
    renderRecentlyPlayed();
    if (notify)
        showToast("Трек удалён из медиатеки");
}

// Удаление трека из выбранного плейлиста
export async function removeTrackFromPlaylist(trackId: string, playlistId = state.selectedPlaylistId) {
    const playlist = state.playlists.find((item) => item.id === playlistId);
    if (!playlist)
        return;
    await api.removeTrackFromPlaylist(playlist.id, trackId);
    playlist.trackIds = playlist.trackIds.filter((id) => id !== trackId);
    renderPlaylistDetail();
    renderPlaylists();
    renderRecentlyPlayed();
    showToast("Трек удалён из плейлиста");
}

// Изменение состояния избранного для трека
export async function toggleFavorite(trackId: string) {
    const favorites = state.playlists.find((playlist) => playlist.id === FAVORITES_PLAYLIST_ID);
    if (!favorites)
        return;
    const isFavorite = favorites.trackIds.includes(trackId);
    if (isFavorite) {
        await api.removeTrackFromPlaylist(favorites.id, trackId);
        favorites.trackIds = favorites.trackIds.filter((id) => id !== trackId);
    }
    else {
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
