import { api } from "../api";
import { REMIXES_PLAYLIST_ID } from "../core/constants";
import { closeModal, openModal } from "../core/views";
import { elements as remixElements } from "../elements/remix";
import { mapStoredPlaylist, mapStoredTrack } from "../mappers";
import { state } from "../state";
import { showToast } from "../utils/toast";
import { remixPlaylist as createPlaylistRemix, renderPlaylistDetail, renderPlaylists, updateHomeRemixesCount } from "./playlists";
import { renderMediaLibrary } from "./tracks";

export type RemixSpeed = "normal" | "slowed" | "speed_up";

export let remixTrackId: string | null = null;

let remixPlaylistId: string | null = null;

export let remixSpeed: RemixSpeed = "normal";

export let remixInProgress = false;

// Закртытие модальных окон ремикса
export function closeRemixModals() {
    closeModal(remixElements.remixSpeedModal);
    closeModal(remixElements.remixSettingsModal);
    remixTrackId = null;
    remixPlaylistId = null;
}

// Открытие модальног окна выбора скорости ремикса
export function openRemixSpeedModal(trackId: string) {
    remixTrackId = trackId;
    remixPlaylistId = null;
    openRemixSpeedSelection();
}

export function openPlaylistRemixSpeedModal(playlistId: string) {
    remixTrackId = null;
    remixPlaylistId = playlistId;
    openRemixSpeedSelection();
}

function openRemixSpeedSelection() {
    remixSpeed = "normal";
    remixElements.remixSettingsModal.querySelectorAll<HTMLButtonElement>("[data-effect]").forEach((button) => {
        button.setAttribute("aria-pressed", "false");
    });
    openModal(remixElements.remixSpeedModal);
    remixElements.remixSpeedModal.querySelector<HTMLButtonElement>("[data-speed='normal']")?.focus();
}

// Открытие модального окна настроек ремикса
export function openRemixSettings(speed: RemixSpeed) {
    if (!remixTrackId && !remixPlaylistId)
        return;
    remixSpeed = speed;
    closeModal(remixElements.remixSpeedModal);
    openModal(remixElements.remixSettingsModal);
    remixElements.remixCreateBtn.focus();
}

// Создание ремикса трека с выбранными эффектами
export async function createRemix(effects: string[]) {
    if (remixInProgress)
        return;

    const sourcePlaylistId = remixPlaylistId;
    if (!remixTrackId && !sourcePlaylistId) {
        closeRemixModals();
        showToast("Исходный трек или плейлист не найден", true);
        return;
    }

    remixInProgress = true;
    remixElements.remixCreateBtn.disabled = true;
    remixElements.remixSkipBtn.disabled = true;
    remixElements.remixCreateBtn.querySelector("span")!.textContent = "Создание...";
    
    try {
        if (sourcePlaylistId) {
            const result = await createPlaylistRemix(
                sourcePlaylistId,
                remixSpeed,
                effects,
                (completed, total) => {
                    remixElements.remixCreateBtn.querySelector("span")!.textContent =
                        `Создание... ${completed}/${total}`;
                },
            );
            closeRemixModals();
            const messages = [
                result.failedTracks
                    ? `Создано ${result.createdTracks} из ${result.totalTracks} треков ремикса`
                    : `Ремикс плейлиста «${result.playlist.title}» создан`,
            ];
            if (result.coverCopyError)
                messages.push(`Не удалось скопировать обложку: ${result.coverCopyError}`);
            showToast(messages.join(". "), result.failedTracks > 0 || Boolean(result.coverCopyError));
            return;
        }

        const sourceTrack = state.tracks.find((track) => track.id === remixTrackId);
        if (!sourceTrack)
            throw new Error("Исходный трек не найден в медиатеке");

        const trackArtist = sourceTrack.artist === "Неизвестный исполнитель" ? "" : sourceTrack.artist;
        const storedRemix = await api.createAndRenderRemix(sourceTrack.path, sourceTrack.title, trackArtist, remixSpeed, effects);
        const remix = mapStoredTrack(storedRemix);
        state.tracks.push(remix);
        
        if (!state.playbackQueuePlaylistId)
            state.playbackQueueTrackIds.push(remix.id);
        let remixPlaylist = state.playlists.find((playlist) => playlist.id === REMIXES_PLAYLIST_ID);
        
        if (!remixPlaylist) {
            state.playlists = (await api.getPlaylists()).map(mapStoredPlaylist);
            remixPlaylist = state.playlists.find((playlist) => playlist.id === REMIXES_PLAYLIST_ID);
        }
        
        if (!remixPlaylist)
            throw new Error("Системный плейлист «Ремиксы» не найден");
        remixPlaylist.trackIds.push(remix.id);
        renderMediaLibrary();
        renderPlaylists();
        updateHomeRemixesCount();
        
        if (state.activeView === "playlist-detail" && state.selectedPlaylistId === REMIXES_PLAYLIST_ID) {
            renderPlaylistDetail();
        }
        closeRemixModals();
        showToast(`Ремикс «${remix.title}» добавлен в медиатеку`);
    } catch (error) {
        console.error("Не удалось создать ремикс:", error);
        showToast(`Не удалось создать ремикс: ${String(error)}`, true);
    } finally {
        remixElements.remixCreateBtn.disabled = false;
        remixElements.remixSkipBtn.disabled = false;
        remixInProgress = false;
        remixElements.remixCreateBtn.querySelector("span")!.textContent = "Создать ремикс";
    }
}
