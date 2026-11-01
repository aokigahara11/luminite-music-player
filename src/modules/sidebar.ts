import { api } from "../api";
import { FAVORITES_PLAYLIST_ID } from "../core/constants";
import { player, savePlayerConfig } from "../core/player";
import { elements } from "../elements/sidebar";
import { elements as playerbarElements } from "../elements/playerbar";
import { mapStoredTrack } from "../mappers";
import { DEFAULT_TRACK_COVER } from "../assets";
import { state } from "../state";
import type { AudioStatus, Track } from "../types";
import { showToast } from "../utils/toast";

const PLAY_COUNT_THRESHOLD_SECS = 60;

interface SidebarCallbacks {
    renderActiveTrackList(): void;
    renderRecentlyPlayed(): void;
    updatePlayButtonIcon(): void;
    updateProgressDisplay(): void;
    updateTrackTextMarquee(): void;
}

let callbacks: SidebarCallbacks | null = null;
let listenProgress: {
    trackId: string;
    positionSecs: number;
    observedAt: number;
    isPlaying: boolean;
    listenedSecs: number;
    counted: boolean;
} | null = null;

// Подключает обновление списков, нужное после редактирования метаданных
export function configureSidebar(sidebarCallbacks: SidebarCallbacks): void {
    callbacks = sidebarCallbacks;
}

// Сбрасывает накопленный прогресс прослушивания текущего трека
export function resetListenProgress(): void {
    listenProgress = null;
}

// Обновляет метаданные текущего трека в боковой панели и плеере.
export function updateTrackMetadata(track: Track): void {
    const cover = track.cover || DEFAULT_TRACK_COVER;
    elements.sidebarCoverWrapper.classList.toggle("has-cover", Boolean(track.cover));
    playerbarElements.playerTitle.textContent = track.title;
    playerbarElements.playerArtist.textContent = track.artist;
    elements.sidebarTitle.textContent = track.title;
    elements.sidebarArtist.textContent = track.artist;
    elements.sidebarPlayCount.textContent = `Прослушиваний: ${track.play_count}`;
    elements.editTrackBtn.disabled = false;
    elements.sidebarRemixBtn.disabled = false;
    elements.sidebarAddToPlaylistBtn.disabled = false;
    elements.changeTrackCoverBtn.disabled = false;
    elements.mobileTrackDetailsBtn.disabled = false;
    updateFavoriteButton();
    requestAnimationFrame(requireCallbacks().updateTrackTextMarquee);

    playerbarElements.playerCover.src = cover;
    playerbarElements.playerCover.alt = track.title;

    elements.sidebarCover.onerror = () => {
        elements.sidebarCover.onerror = null;
        if (elements.sidebarCover.getAttribute("src") === cover)
            elements.sidebarCover.src = DEFAULT_TRACK_COVER;
    };
    elements.sidebarCover.src = cover;
    elements.sidebarCover.alt = track.title;
}

// Отслеживает прослушанное время и записывает засчитанное воспроизведение
export function updateTrackListenProgress(track: Track | undefined, status: AudioStatus): void {
    if (!track || !Number.isFinite(status.positionSecs)) {
        listenProgress = null;
        return;
    }

    const now = performance.now();
    if (!listenProgress || listenProgress.trackId !== track.id) {
        listenProgress = {
            trackId: track.id,
            positionSecs: status.positionSecs,
            observedAt: now,
            isPlaying: status.isPlaying,
            listenedSecs: 0,
            counted: false,
        };
        return;
    }

    const elapsedSecs = Math.max(0, (now - listenProgress.observedAt) / 1000);
    const positionDelta = status.positionSecs - listenProgress.positionSecs;
    const advancedDuringPlayback = listenProgress.isPlaying
        && (status.isPlaying || status.ended)
        && positionDelta > 0
        && positionDelta <= elapsedSecs * 2 + 0.15;
    if (advancedDuringPlayback) listenProgress.listenedSecs += positionDelta;

    const completedShortTrack = status.ended
        && status.durationSecs > 0
        && status.durationSecs < PLAY_COUNT_THRESHOLD_SECS
        && listenProgress.listenedSecs >= Math.max(status.durationSecs - 0.5, status.durationSecs * 0.9);

    if (!listenProgress.counted && (listenProgress.listenedSecs >= PLAY_COUNT_THRESHOLD_SECS || completedShortTrack)) {
        listenProgress.counted = true;
        void api.recordTrackPlay(track.id).then((playCount) => {
            const currentTrack = state.tracks.find((item) => item.id === track.id);
            if (!currentTrack) return;
            currentTrack.play_count = playCount;
            if (state.currentTrackId === track.id) {
                elements.sidebarPlayCount.textContent = `Прослушиваний: ${playCount}`;
            }
        }).catch((error) => {
            console.error("Не удалось записать прослушивание трека:", error);
            showToast(`Не удалось записать прослушивание: ${String(error)}`, true);
        });
    }

    listenProgress.positionSecs = status.positionSecs;
    listenProgress.observedAt = now;
    listenProgress.isPlaying = status.isPlaying;
    if (status.ended) {
        listenProgress.listenedSecs = 0;
        listenProgress.counted = false;
        listenProgress.isPlaying = false;
    }
}

// Открывает форму редактирования названия и исполнителя текущего трека
export function openTrackEditor(): void {
    const track = state.tracks.find((item) => item.id === state.currentTrackId);
    if (!track) return;
    elements.trackTitleInput.value = track.title;
    elements.trackArtistInput.value = track.artist === "Неизвестный исполнитель" ? "" : track.artist;
    elements.trackEditStatus.textContent = "";
    elements.trackEditStatus.hidden = true;
    elements.trackEditForm.hidden = false;
    elements.sidebarPlayerActions.hidden = true;
    elements.trackTitleInput.focus();
}

// Закрывает форму редактирования метаданных трека.
export function closeTrackEditor(): void {
    elements.trackEditForm.hidden = true;
    elements.sidebarPlayerActions.hidden = false;
}

// Перезапускает аудио с заданной позиции и сохраняет состояние плеера
export async function reloadTrackAudio(track: Track, position: number, shouldPlay: boolean): Promise<void> {
    player.audioStatus = await api.playAudio(track.path, position, shouldPlay, player.audioStatus.volume);
    state.isPlaying = player.audioStatus.isPlaying;
    const sidebarCallbacks = requireCallbacks();
    sidebarCallbacks.updatePlayButtonIcon();
    sidebarCallbacks.updateProgressDisplay();
    savePlayerConfig();
}

// Сохраняет отредактированные метаданные и обновляет связанные представления
export async function saveTrackMetadata(): Promise<void> {
    const track = state.tracks.find((item) => item.id === state.currentTrackId);
    const title = elements.trackTitleInput.value.trim();
    const artist = elements.trackArtistInput.value.trim();
    if (!track || !title) return;
    const sidebarCallbacks = requireCallbacks();

    const wasCurrentTrack = state.currentTrackId === track.id;
    const playbackPosition = player.audioStatus.positionSecs;
    const wasPlaying = wasCurrentTrack && state.isPlaying;
    elements.saveTrackEditBtn.disabled = true;
    elements.cancelTrackEditBtn.disabled = true;
    elements.trackEditStatus.hidden = false;
    elements.trackEditStatus.textContent = "Сохранение...";

    try {
        if (wasCurrentTrack) {
            player.audioStatus = await api.stopAudio();
            state.isPlaying = false;
            sidebarCallbacks.updatePlayButtonIcon();
        }

        const storedTrack = await api.editTrack(track.id, title, artist);
        const updatedTrack = mapStoredTrack(storedTrack);
        state.tracks = state.tracks.map((item) => item.id === updatedTrack.id ? updatedTrack : item);
        if (state.currentTrackId === updatedTrack.id) {
            updateTrackMetadata(updatedTrack);
            if (wasCurrentTrack) await reloadTrackAudio(updatedTrack, playbackPosition, wasPlaying);
        }

        sidebarCallbacks.renderActiveTrackList();
        sidebarCallbacks.renderRecentlyPlayed();
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

// Обновляет состояние кнопки избранного для текущего трека
export function updateFavoriteButton(): void {
    const favorites = state.playlists.find((playlist) => playlist.id === FAVORITES_PLAYLIST_ID);
    const isFavorite = Boolean(state.currentTrackId && favorites?.trackIds.includes(state.currentTrackId));
    const label = isFavorite ? "Убрать из избранного" : "Добавить в избранное";
    elements.favoriteBtn.disabled = !state.currentTrackId;
    elements.favoriteBtn.classList.toggle("added", isFavorite);
    elements.favoriteBtn.title = label;
    elements.favoriteBtn.setAttribute("aria-label", label);
}

function requireCallbacks(): SidebarCallbacks {
    if (!callbacks) throw new Error("Sidebar callbacks have not been configured");
    return callbacks;
}
