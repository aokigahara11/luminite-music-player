import { api } from "../api";
import { player, savePlayerConfig } from "../core/player";
import { elements as playerbarElements } from "../elements/playerbar";
import { state } from "../state";
import type { AudioStatus } from "../types";
import { formatTime } from "../utils/format";
import { showToast } from "../utils/toast";
import { renderPlaylistDetail } from "./playlists";
import { recordRecentlyPlayed } from "./recentlyPlayed";
import { audioSettings } from "./settings";
import { renderMediaLibrary } from "./tracks";
import { closeTrackEditor, updateTrackMetadata } from "./sidebar";

// Обновляет время и полосу прогресса плеера.
export function updateProgressDisplay(time = player.audioStatus.positionSecs): void {
    const duration = Number.isFinite(player.audioStatus.durationSecs) && player.audioStatus.durationSecs > 0
        ? player.audioStatus.durationSecs
        : 0;
    const currentTime = Number.isFinite(time) && duration > 0 ? Math.min(Math.max(time, 0), duration) : 0;
    const sliderMax = Math.max(1, Math.floor(duration));

    playerbarElements.currentTime.textContent = formatTime(currentTime);
    playerbarElements.totalTime.textContent = formatTime(duration);
    playerbarElements.progressSlider.max = sliderMax.toString();
    playerbarElements.progressSlider.value = Math.min(Math.floor(currentTime), sliderMax).toString();
    playerbarElements.progressSlider.style.setProperty("--progress", `${duration > 0 ? (currentTime / duration) * 100 : 0}%`);
}

// Обновляет подсказку времени при наведении на полосу прогресса.
export function updateProgressTooltip(time: number): void {
    const duration = Number.isFinite(player.audioStatus.durationSecs) && player.audioStatus.durationSecs > 0
        ? player.audioStatus.durationSecs
        : 0;
    const previewTime = duration > 0 ? Math.min(Math.max(time, 0), duration) : 0;
    const percentage = duration > 0 ? (previewTime / duration) * 100 : 0;

    playerbarElements.progressTooltip.textContent = formatTime(previewTime);
    playerbarElements.progressTooltip.style.left = `${Math.min(95, Math.max(5, percentage))}%`;
}

// Настраивает бегущую строку для элемента, если текст не помещается.
export function updateMarquee(element: HTMLElement): void {
    element.classList.remove("marquee");
    element.style.removeProperty("--marquee-distance");
    element.style.removeProperty("--marquee-duration");

    const overflow = element.scrollWidth - element.clientWidth;
    if (overflow <= 1) return;

    element.style.setProperty("--marquee-distance", `${overflow}px`);
    element.style.setProperty("--marquee-duration", `${Math.max(8, overflow / 24)}s`);
    element.classList.add("marquee");
}

// Пересчитывает бегущую строку названия и исполнителя.
export function updateTrackTextMarquee(): void {
    updateMarquee(playerbarElements.playerTitle);
    updateMarquee(playerbarElements.playerArtist);
}

// Синхронизирует иконку кнопки Play/Pause с состоянием воспроизведения.
export function updatePlayButtonIcon(): void {
    playerbarElements.playBtn.innerHTML = state.isPlaying
        ? `<svg class="icon-svg" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>`
        : `<svg class="icon-svg" viewBox="0 0 24 24" fill="currentColor"><polygon points="6,4 20,12 6,20" /></svg>`;
}

// Отображает текущие режимы повтора и перемешивания.
export function updatePlaybackModeButtons(): void {
    const repeatLabels = {
        off: ["Повтор выключен", "Включить повтор всех треков"],
        all: ["Повтор всех треков", "Включить повтор одного трека"],
        one: ["Повтор одного трека", "Выключить повтор"],
    } as const;
    const [repeatTitle, repeatLabel] = repeatLabels[state.repeatMode];
    playerbarElements.repeatBtn.classList.toggle("active", state.repeatMode !== "off");
    playerbarElements.repeatBtn.classList.toggle("repeat-one", state.repeatMode === "one");
    playerbarElements.repeatBtn.title = repeatTitle;
    playerbarElements.repeatBtn.setAttribute("aria-label", repeatLabel);
    playerbarElements.repeatBtn.setAttribute("aria-pressed", String(state.repeatMode !== "off"));
    playerbarElements.shuffleBtn.classList.toggle("active", state.shuffleEnabled);
    playerbarElements.shuffleBtn.title = `Случайный порядок ${state.shuffleEnabled ? "включён" : "выключен"}`;
    playerbarElements.shuffleBtn.setAttribute("aria-label", state.shuffleEnabled ? "Выключить случайный порядок" : "Включить случайный порядок");
    playerbarElements.shuffleBtn.setAttribute("aria-pressed", String(state.shuffleEnabled));
}

export let transitionCheckedForTrackId: string | null = null;

export let transitionPendingForTrackId: string | null = null;

// Воспроизводит выбранный трек и обновляет очередь.
export async function playTrack(trackId: string, queueTrackIds = state.tracks.map((track) => track.id), queuePlaylistId: string | null = null) {
    const track = state.tracks.find((t) => t.id === trackId);
    if (!track)
        return;
    transitionCheckedForTrackId = null;
    transitionPendingForTrackId = null;

    state.playbackQueueTrackIds = [...new Set(queueTrackIds)].filter((id) => state.tracks.some((item) => item.id === id));
    if (!state.playbackQueueTrackIds.includes(trackId))
        state.playbackQueueTrackIds.push(trackId);
    state.playbackQueuePlaylistId = queuePlaylistId;
    closeTrackEditor();

    if (state.activeView === "playlist-detail" && state.selectedPlaylistId) {
        recordRecentlyPlayed("playlist", state.selectedPlaylistId);
    }

    recordRecentlyPlayed("track", trackId);
    if (state.currentTrackId !== trackId) {
        try {
            player.audioStatus = await api.playAudio(track.path, 0, true, player.audioStatus.volume);
        }
        catch (error) {
            state.isPlaying = player.audioStatus.isPlaying;
            showToast(`Не удалось воспроизвести аудио: ${String(error)}`, true);
            return;
        }
        state.currentTrackId = trackId;
        updateTrackMetadata(track);
    } else {
        try {
            player.audioStatus = player.audioStatus.loaded
                ? await api.resumeAudio()
                : await api.playAudio(track.path, player.audioStatus.positionSecs, true, player.audioStatus.volume);
        }
        catch (error) {
            showToast(`Не удалось продолжить воспроизведение: ${String(error)}`, true);
        }
    }
    state.isPlaying = player.audioStatus.isPlaying;
    updateProgressDisplay();
    updateProgressTooltip(player.audioStatus.positionSecs);
    updatePlayButtonIcon();
    renderActiveTrackList();
    savePlayerConfig();
}

// Перерисовывает список треков, соответствующий активному экрану.
export function renderActiveTrackList() {
    if (state.activeView === "media-library")
        renderMediaLibrary();
    if (state.activeView === "playlist-detail")
        renderPlaylistDetail();
}

export async function togglePlay() {
    if (!state.currentTrackId && state.tracks.length > 0) {
        playTrack(state.tracks[0].id);
        return;
    }
    if (!state.currentTrackId)
        return;
    try {
        const track = state.tracks.find((item) => item.id === state.currentTrackId);
        player.audioStatus = state.isPlaying
            ? await api.pauseAudio()
            : player.audioStatus.loaded
                ? await api.resumeAudio()
                : track
                    ? await api.playAudio(track.path, player.audioStatus.positionSecs, true, player.audioStatus.volume)
                    : player.audioStatus;
        state.isPlaying = player.audioStatus.isPlaying;
    }
    catch (error) {
        showToast(`Не удалось изменить воспроизведение: ${String(error)}`, true);
    }
    updatePlayButtonIcon();
    renderActiveTrackList();
    savePlayerConfig();
}

// Переключение повторения
export function toggleRepeatMode() {
    state.repeatMode = state.repeatMode === "off" ? "all" : state.repeatMode === "all" ? "one" : "off";
    updatePlaybackModeButtons();
}

// Переключение перемешивания
export function toggleShuffle() {
    state.shuffleEnabled = !state.shuffleEnabled;
    updatePlaybackModeButtons();
}

// Воспроизводит следующий трек в очереди.
export async function playNextTrack(naturalEnd = false, knownNextTrackId?: string | null) {
    const queueTrackIds = getPlaybackQueueTrackIds();
    
    if (!queueTrackIds.length)
        return;

    const nextTrackId = knownNextTrackId === undefined
        ? await api.getNextTrackId({
            trackIds: queueTrackIds,
            currentTrackId: state.currentTrackId,
            repeatMode: state.repeatMode,
            shuffleEnabled: state.shuffleEnabled,
            naturalEnd,
        })
        : knownNextTrackId;

    if (nextTrackId) {
        if (naturalEnd && nextTrackId === state.currentTrackId) {
            const track = state.tracks.find((item) => item.id === nextTrackId);
            if (track) {
                try {
                    transitionCheckedForTrackId = null;
                    transitionPendingForTrackId = null;
                    player.audioStatus = await api.playAudio(track.path, 0, true, player.audioStatus.volume);
                    state.isPlaying = player.audioStatus.isPlaying;
                    updatePlayButtonIcon();
                    savePlayerConfig();
                }
                catch (error) {
                    state.isPlaying = false;
                    showToast(`Не удалось повторить трек: ${String(error)}`, true);
                }
            }
        }
        else {
            await playTrack(nextTrackId, queueTrackIds, state.playbackQueuePlaylistId);
        }
    }

    else if (naturalEnd) {
        transitionPendingForTrackId = null;
        state.isPlaying = false;
        updatePlayButtonIcon();
        renderActiveTrackList();
        savePlayerConfig();
    }
}

// Получить ID треков в очереде воспроизведения
export function getPlaybackQueueTrackIds() {
    const sourcePlaylist = state.playbackQueuePlaylistId
        ? state.playlists.find((playlist) => playlist.id === state.playbackQueuePlaylistId)
        : undefined;
    const trackIds = sourcePlaylist?.trackIds ?? state.playbackQueueTrackIds;
    return [...new Set(trackIds)].filter((id) => state.tracks.some((track) => track.id === id));
}

// Инициализация перехода между треками
export async function maybeStartTrackTransition(status: AudioStatus) {
    const trackId = state.currentTrackId;
    if (!trackId || !state.isPlaying || audioSettings.transitionDuration <= 0 || status.durationSecs <= 0) {
        transitionCheckedForTrackId = null;
        transitionPendingForTrackId = null;
        return;
    }
    const transitionLength = Math.min(audioSettings.transitionDuration, status.durationSecs / 2);
    if (status.positionSecs < status.durationSecs - transitionLength) {
        if (transitionCheckedForTrackId === trackId)
            transitionCheckedForTrackId = null;
        return;
    }
    if (transitionCheckedForTrackId === trackId)
        return;
    transitionCheckedForTrackId = trackId;
    try {
        const nextTrackId = await api.getNextTrackId({
            trackIds: getPlaybackQueueTrackIds(),
            currentTrackId: trackId,
            repeatMode: state.repeatMode,
            shuffleEnabled: state.shuffleEnabled,
            naturalEnd: true,
        });
        if (state.currentTrackId !== trackId || !state.isPlaying)
            return;
        if (nextTrackId) {
            transitionPendingForTrackId = trackId;
            await playNextTrack(true, nextTrackId);
        }
    }
    catch (error) {
        transitionCheckedForTrackId = null;
        transitionPendingForTrackId = null;
        console.error("Не удалось начать переход к следующему треку:", error);
        showToast(`Не удалось начать переход: ${String(error)}`, true);
    }
}

// Воспроизведение предыдущего трека в очереде
export async function playPrevTrack() {
    const queueTrackIds = getPlaybackQueueTrackIds();
    if (!queueTrackIds.length)
        return;
    const previousTrackId = await api.getPreviousTrackId(queueTrackIds, state.currentTrackId, state.shuffleEnabled);
    if (previousTrackId)
        playTrack(previousTrackId, queueTrackIds, state.playbackQueuePlaylistId);
}
