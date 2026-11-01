import { api } from "../api";
import { FAVORITES_PLAYLIST_ID } from "../core/constants";
import { player, savePlayerConfig } from "../core/player";
import { switchView } from "../core/views";
import { elements } from "../elements/home";
import { elements as playerbarElements } from "../elements/playerbar";
import { elements as sidebarElements } from "../elements/sidebar";
import { mapStoredTrack } from "../mappers";
import { state } from "../state";
import type { Track } from "../types";
import { formatTime, truncate } from "../utils/format";
import { showToast } from "../utils/toast";
import { playTrack, renderActiveTrackList, updatePlayButtonIcon, updateProgressDisplay } from "./playerbar";
import { closeTrackEditor, updateFavoriteButton } from "./sidebar";
import { openAddToPlaylistModal, renderPlaylistDetail, renderPlaylists, replaceTrackFromFile } from "./playlists";
import { renderRecentlyPlayed } from "./recentlyPlayed";
import { openRemixSpeedModal } from "./remix";
import { open } from "@tauri-apps/plugin-dialog";

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
        elements.trackListContainer.style.display = "none";
    }
    else {
        elements.mediaEmptyState?.classList.add("hidden");
        elements.trackListContainer.style.display = "block";
        renderTrackList(elements.trackListContainer, state.tracks, "library");
    }
}

// Отрисовка списка треков в медиатеке или плейлисте
export function renderTrackList(container: HTMLElement, tracks: Track[], context: "library" | "playlist") {
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
    
    container.querySelectorAll(".track-row").forEach((row) => {
        row.addEventListener("click", (e) => {
            const target = e.target as HTMLElement;
            if (target.closest("button"))
                return;
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
                    await deleteTrackFromLibrary(trackId);
                }
                else if (action === "remove-from-playlist") {
                    await removeTrackFromPlaylist(trackId);
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
export async function deleteTrackFromLibrary(trackId: string) {
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
        playerbarElements.playerCover.src = "./src/assets/media_library.jpg";
        sidebarElements.sidebarCover.src = "./src/assets/media_library.jpg";
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

// Удаление трека из выбранного плейлиста
export async function removeTrackFromPlaylist(trackId: string) {
    const playlist = state.playlists.find((item) => item.id === state.selectedPlaylistId);
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
