import { api } from "../api";
import { FAVORITES_PLAYLIST_ID, REMIXES_PLAYLIST_ID } from "../core/constants";
import { player } from "../core/player";
import { closeModal, openModal, switchView } from "../core/views";
import { elements } from "../elements/home";
import { elements as playlistsElements } from "../elements/playlists";
import { mapStoredPlaylist, mapStoredTrack } from "../mappers";
import { state } from "../state";
import { FAVORITES_COVER, REMIXES_COVER } from "../assets";
import type { PlaylistCategory, Track } from "../types";
import { showToast } from "../utils/toast";
import { reloadTrackAudio, updateTrackMetadata } from "./sidebar";
import { renderRecentlyPlayed } from "./recentlyPlayed";
import { renderMediaLibrary, renderTrackList, updateHomeFavoritesCount } from "./tracks";
import { open } from "@tauri-apps/plugin-dialog";

// Обновление количества треков в плейлисте ремиксов на главной странице
export function updateHomeRemixesCount(): void {
    const remixes = state.playlists.find((playlist) => playlist.id === REMIXES_PLAYLIST_ID);
    if (remixes) elements.homeRemixesCount.textContent = `${remixes.trackIds.length} треков`;
}

let playlistToEditId: string | null = null;

// 
export function clearPendingPlaylistTrack(): void {
    trackToAddToPlaylist = null;
}

export function resetPlaylistFormState(): void {
    trackToAddToPlaylist = null;
    playlistToEditId = null;
}

// Открытие модального окна создания плейлиста
export function openCreatePlaylistModal() {
    playlistToEditId = null;
    playlistsElements.playlistModalTitle.textContent = "Новый плейлист";
    playlistsElements.submitPlaylistBtn.textContent = "Создать";
    playlistsElements.playlistNameInput.value = "";
    playlistsElements.playlistCategorySelect.value = "Плейлист";
    playlistsElements.playlistFormStatus.textContent = "";
    playlistsElements.playlistFormStatus.hidden = true;
    openModal(playlistsElements.createPlaylistModal);
}

// Открытие модального окна изменения метаданных кода
export function openEditPlaylistModal() {
    const playlist = state.playlists.find((item) => item.id === state.selectedPlaylistId);
    if (!playlist)
        return;
    playlistToEditId = playlist.id;
    playlistsElements.playlistModalTitle.textContent = "Редактировать плейлист";
    playlistsElements.submitPlaylistBtn.textContent = "Сохранить";
    playlistsElements.playlistNameInput.value = playlist.title;
    playlistsElements.playlistCategorySelect.value = playlist.category;
    playlistsElements.playlistFormStatus.textContent = "";
    playlistsElements.playlistFormStatus.hidden = true;
    openModal(playlistsElements.createPlaylistModal);
    playlistsElements.playlistNameInput.focus();
}

// Проверка и отправка формы для создания или редактирования плейлиста
export async function submitPlaylistForm() {
    const name = playlistsElements.playlistNameInput.value.trim();
    const category = playlistsElements.playlistCategorySelect.value as PlaylistCategory;
    const isEditing = playlistToEditId !== null;
    if (!name) {
        playlistsElements.playlistFormStatus.textContent = "Введите название плейлиста";
        playlistsElements.playlistFormStatus.hidden = false;
        playlistsElements.playlistNameInput.focus();
        return;
    }
    playlistsElements.submitPlaylistBtn.disabled = true;
    playlistsElements.playlistFormStatus.hidden = true;
    try {
        if (playlistToEditId) {
            const storedPlaylist = await api.editPlaylist(playlistToEditId, name, category);
            const updatedPlaylist = {
                ...mapStoredPlaylist(storedPlaylist),
                cover: state.playlists.find((playlist) => playlist.id === storedPlaylist.id)?.cover,
            };
            state.playlists = state.playlists.map((playlist) => playlist.id === updatedPlaylist.id ? updatedPlaylist : playlist);
            renderPlaylists();
            renderPlaylistDetail();
            renderRecentlyPlayed();
        }
        else {
            await createPlaylist(name, category);
        }
        closeModal(playlistsElements.createPlaylistModal);
        playlistToEditId = null;
        showToast(isEditing ? "Изменения сохранены" : "Плейлист создан");
    }
    catch (error) {
        playlistsElements.playlistFormStatus.textContent = error instanceof Error ? error.message : "Не удалось сохранить плейлист";
        playlistsElements.playlistFormStatus.hidden = false;
    }
    finally {
        playlistsElements.submitPlaylistBtn.disabled = false;
    }
}

// Создание нового плейлиста
export async function createPlaylist(title: string, category: PlaylistCategory) {
    if (!title.trim())
        return;
    const storedPlaylist = await api.createPlaylist(title.trim(), category);
    const newPlaylist = mapStoredPlaylist(storedPlaylist);
    if (trackToAddToPlaylist) {
        await api.addTrackToPlaylist(newPlaylist.id, trackToAddToPlaylist);
        newPlaylist.trackIds.push(trackToAddToPlaylist);
        trackToAddToPlaylist = null;
    }
    state.playlists.push(newPlaylist);
    closeModal(playlistsElements.createPlaylistModal);
    if (state.activeView === "playlists")
        renderPlaylists();
}

// Отрисовка плейлистов
export function renderPlaylists() {
    if (state.playlists.length === 0) {
        playlistsElements.playlistsEmptyState?.classList.remove("hidden");
        playlistsElements.playlistsGrid.innerHTML = "";
    }
    else {
        playlistsElements.playlistsEmptyState?.classList.add("hidden");
        playlistsElements.playlistsGrid.innerHTML = state.playlists
            .map((pl) => `
      <div class="media-card" data-playlist-id="${pl.id}">
        <div class="card-cover-wrapper">
                    <div class="card-cover playlist-cover" style="background:#282828; display:flex; align-items:center; justify-content:center;">
                        ${pl.cover
            ? `<img src="${pl.cover}" alt="Обложка: ${pl.title}" />`
            : pl.id === FAVORITES_PLAYLIST_ID
                ? `<img src="${FAVORITES_COVER}" alt="Обложка: ${pl.title}" />`
                : pl.id === REMIXES_PLAYLIST_ID
                    ? `<img src="${REMIXES_COVER}" alt="Обложка: ${pl.title}" />`
                    : "🎵"}
                    </div>
        </div>
        <div class="card-title">${pl.title}</div>
        <div class="playlist-category-label">${pl.category}</div>
        <div class="card-artist">${pl.trackIds.length} треков</div>
      </div>
    `)
            .join("");
        playlistsElements.playlistsGrid.querySelectorAll<HTMLElement>(".media-card").forEach((card) => {
            card.setAttribute("role", "button");
            card.setAttribute("tabindex", "0");
            card.addEventListener("keydown", (event: KeyboardEvent) => {
                if (event.key !== "Enter" && event.key !== " ")
                    return;
                event.preventDefault();
                const id = card.getAttribute("data-playlist-id");
                if (!id)
                    return;
                state.selectedPlaylistId = id;
                switchView("playlist-detail");
            });
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
    updateHomeRemixesCount();
}

// Отрисовка метданных плейлиста
export function renderPlaylistDetail() {
    const playlist = state.playlists.find((p) => p.id === state.selectedPlaylistId);
    if (!playlist)
        return;

    playlistsElements.playlistDetailTitle.textContent = playlist.title;
    playlistsElements.playlistDetailCount.textContent = `${playlist.category} · ${playlist.trackIds.length} треков`;
    const isSystemPlaylist = playlist.id === FAVORITES_PLAYLIST_ID || playlist.id === REMIXES_PLAYLIST_ID;
    playlistsElements.editPlaylistBtn.hidden = isSystemPlaylist;
    playlistsElements.deletePlaylistBtn.hidden = isSystemPlaylist;
    playlistsElements.changePlaylistCoverBtn.hidden = isSystemPlaylist;
    
    const playlistTracks = playlist.trackIds.flatMap((trackId) => {
        const track = state.tracks.find((item) => item.id === trackId);
        return track ? [track] : [];
    });

    renderTrackList(playlistsElements.playlistTrackListContainer, playlistTracks, "playlist");
}

let trackToAddToPlaylist: string | null = null;

// Отрисовка поиска и отрисовка списков плейлистов в модальном окне добавления трека в плейлист
export function renderAddToPlaylistOptions() {
    const query = playlistsElements.modalPlaylistSearch.value.trim().toLocaleLowerCase();
    const matchingPlaylists = state.playlists.filter((playlist) => playlist.title.toLocaleLowerCase().includes(query)
        || playlist.category.toLocaleLowerCase().includes(query));
    playlistsElements.modalPlaylistsEmpty.classList.toggle("hidden", state.playlists.length > 0);
    playlistsElements.modalPlaylistsNoResults.classList.toggle("hidden", state.playlists.length === 0 || matchingPlaylists.length > 0);
    playlistsElements.modalPlaylistsList.classList.toggle("hidden", matchingPlaylists.length === 0);
    playlistsElements.modalPlaylistsList.innerHTML = matchingPlaylists
        .map((playlist) => {
        const cover = playlist.cover
            || (playlist.id === FAVORITES_PLAYLIST_ID ? FAVORITES_COVER : "")
            || (playlist.id === REMIXES_PLAYLIST_ID ? REMIXES_COVER : "");
        return `
                <button class="modal-playlist-item modal-pl-item" type="button" data-id="${playlist.id}">
                    <span class="modal-playlist-cover">
                        ${cover
            ? `<img src="${cover}" alt="" />`
            : `<span class="modal-playlist-cover-placeholder" aria-hidden="true">♫</span>`}
                    </span>
                    <span class="modal-playlist-copy">
                        <span class="modal-playlist-title">${playlist.title}</span>
                        <span class="modal-playlist-meta">${playlist.category} · ${playlist.trackIds.length} треков</span>
                    </span>
                    <svg class="modal-playlist-arrow icon-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                        <path d="m9 18 6-6-6-6"></path>
                    </svg>
                </button>
            `;
    })
        .join("");
    playlistsElements.modalPlaylistsList.querySelectorAll<HTMLButtonElement>(".modal-pl-item").forEach((button) => {
        button.addEventListener("click", () => {
            void addTrackToPlaylistFromPicker(button.dataset.id);
        });
    });
}

// Добавление трека в плейлист из модального окна выбора плейлиста
export async function addTrackToPlaylistFromPicker(playlistId: string | undefined) {
    if (!playlistId || !trackToAddToPlaylist)
        return;
    try {
        const playlist = state.playlists.find((item) => item.id === playlistId);
        if (!playlist)
            throw new Error("Плейлист не найден");
        if (playlist.trackIds.includes(trackToAddToPlaylist)) {
            showToast("Этот трек уже есть в плейлисте");
        }
        else {
            await api.addTrackToPlaylist(playlistId, trackToAddToPlaylist);
            playlist.trackIds.push(trackToAddToPlaylist);
            renderPlaylists();
            renderRecentlyPlayed();
            showToast("Трек добавлен в плейлист");
        }
        closeModal(playlistsElements.addToPlaylistModal);
        trackToAddToPlaylist = null;
    }
    catch (error) {
        console.error("Не удалось добавить трек в плейлист:", error);
        showToast(`Не удалось добавить трек в плейлист: ${String(error)}`, true);
    }
}

// Иницализация модального окна добавления трека в плейлист
export function openAddToPlaylistModal(trackId: string) {
    trackToAddToPlaylist = trackId;
    playlistsElements.modalPlaylistSearch.value = "";
    renderAddToPlaylistOptions();
    openModal(playlistsElements.addToPlaylistModal);
}

// Замена трека в плейлисте с помощую файла
export async function replaceTrackFromFile(trackId: string) {
    const playlist = state.playlists.find((item) => item.id === state.selectedPlaylistId);
    
    if (!playlist || playlist.id === FAVORITES_PLAYLIST_ID)
        return;

    if (!playlist.trackIds.includes(trackId)) {
        showToast("Трек больше не найден в плейлисте", true);
        return;
    }

    const filePath = await open({
        multiple: false,
        filters: [{ name: "Аудио", extensions: ["mp3", "wav", "flac", "ogg", "m4a"] }],
    });

    if (typeof filePath !== "string")
        return;

    let importedTrack: Track | null = null;
    let replaced = false;
    try {
        importedTrack = mapStoredTrack(await api.importTrack(filePath));
        await api.replaceTrackInPlaylist(playlist.id, trackId, importedTrack.id);
        replaced = true;
        const trackIndex = playlist.trackIds.indexOf(trackId);
        playlist.trackIds[trackIndex] = importedTrack.id;
        state.tracks.push(importedTrack);
        let playbackError: unknown;
        
        if (state.currentTrackId === trackId) {
            state.currentTrackId = importedTrack.id;
            updateTrackMetadata(importedTrack);
            try {
                await reloadTrackAudio(importedTrack, player.audioStatus.positionSecs, state.isPlaying);
            }
            catch (error) {
                playbackError = error;
                console.error("Не удалось запустить заменённый трек:", error);
            }
        }

        renderMediaLibrary();
        renderPlaylistDetail();
        renderPlaylists();
        renderRecentlyPlayed();
        showToast(playbackError
            ? `Трек заменён, но не удалось начать воспроизведение: ${String(playbackError)}`
            : "Трек заменён в плейлисте", Boolean(playbackError));
    }

    catch (error) {
        if (importedTrack && !replaced) {
            try {
                await api.deleteTrack(importedTrack.id);
            }
            catch (cleanupError) {
                console.error("Не удалось удалить импортированный файл после ошибки замены:", cleanupError);
                showToast(`Трек не заменён; не удалось удалить новый файл: ${String(cleanupError)}`, true);
                return;
            }
        }
        throw error;
    }
}
