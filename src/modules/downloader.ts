import { api } from "../api";
import { elements as downloaderElements } from "../elements/downloader";
import { mapStoredCover, mapStoredPlaylist, mapStoredTrack } from "../mappers";
import { state } from "../state";
import type { DownloadProgress, PlaylistCategory, Track } from "../types";
import { showToast } from "../utils/toast";
import { renderPlaylists } from "./playlists";
import { renderRecentlyPlayed } from "./recentlyPlayed";
import { renderMediaLibrary } from "./tracks";
import { listen } from "@tauri-apps/api/event";

// Добавление загруженных треков в медиатеку или создание плейлиста, если это множество треков
export async function importDownloadedTracks(result: Awaited<ReturnType<typeof api.downloadTracks>>) {
    const importedTracks: Track[] = [];
    let failedCovers = 0;
    
    for (const downloadedFile of result.files) {
        const storedTrack = await api.importTrack(downloadedFile.path);
        const track = mapStoredTrack(storedTrack);
        state.tracks.push(track);
        importedTracks.push(track);
        if (!state.playbackQueuePlaylistId)
            state.playbackQueueTrackIds.push(track.id);
        if (downloadedFile.coverPath) {
            try {
                const storedCover = await api.setCover("track", track.id, downloadedFile.coverPath);
                track.cover = mapStoredCover(storedCover).src;
            }
            catch (error) {
                console.error(`Не удалось сохранить обложку трека «${track.title}»:`, error);
                failedCovers += 1;
            }
        }
    }

    if (result.isCollection && importedTracks.length > 1) {
        const artists = new Set(importedTracks
            .map((track) => track.artist.trim().toLocaleLowerCase())
            .filter((artist) => artist && artist !== "неизвестный исполнитель"));
        const hasUnknownArtist = importedTracks.some((track) => !track.artist.trim() || track.artist.trim().toLocaleLowerCase() === "неизвестный исполнитель");
        const sameArtist = artists.size === 1 && !hasUnknownArtist;
        const category: PlaylistCategory = sameArtist
            ? importedTracks.length < 6 ? "EP" : "Альбом"
            : "Плейлист";
        const title = result.collectionTitle?.trim()
            || (sameArtist ? importedTracks[0].artist : "Загруженный плейлист");
        const storedPlaylist = await api.createPlaylist(title, category);
        const playlist = mapStoredPlaylist(storedPlaylist);
        
        try {
            for (const track of importedTracks) {
                await api.addTrackToPlaylist(playlist.id, track.id);
                playlist.trackIds.push(track.id);
            }
            const coverPath = result.files.find((file) => file.coverPath)?.coverPath;
            
            if (coverPath) {
                try {
                    const storedCover = await api.setCover("playlist", playlist.id, coverPath);
                    playlist.cover = mapStoredCover(storedCover).src;
                }
                catch (error) {
                    console.error(`Не удалось сохранить обложку «${playlist.title}»:`, error);
                    failedCovers += 1;
                }
            }
        }
        
        catch (error) {
            try {
                await api.deletePlaylist(playlist.id);
            }
            catch (cleanupError) {
                console.error("Не удалось удалить незавершённый плейлист:", cleanupError);
            }
            throw error;
        }
        state.playlists.push(playlist);
        renderPlaylists();
    }
    renderMediaLibrary();
    renderRecentlyPlayed();
    return { importedCount: importedTracks.length, failedCovers };
}

// Обработчик события загрузки
export async function handleDownload(event: SubmitEvent) {
    event.preventDefault();
    if (!downloaderElements.downloadForm.reportValidity())
        return;
    downloaderElements.downloadSubmitBtn.disabled = true;
    downloaderElements.downloadProgress.hidden = false;
    downloaderElements.downloadProgress.value = 0;
    downloaderElements.downloadStatus.textContent = "Получаем информацию и запускаем yt-dlp…";
    let downloadId: string | null = null;
    let stopListening: (() => void) | null = null;
    try {
        stopListening = await listen<DownloadProgress>("download-progress", ({ payload }) => {
            const stageMessages: Record<DownloadProgress["stage"], string> = {
                preparing: "Проверяем ссылку и готовим загрузку…",
                downloading: "Скачиваем аудио…",
                converting: "Конвертируем аудио в MP3…",
                finalizing: "Добавляем метаданные и обложку…",
            };
            downloaderElements.downloadStatus.textContent = payload.stage === "downloading" && payload.percentage !== null
                ? `${stageMessages.downloading} ${Math.round(payload.percentage)}%`
                : stageMessages[payload.stage];
            if (payload.percentage !== null) {
                downloaderElements.downloadProgress.value = payload.percentage;
            }
        });
        const result = await api.downloadTracks(downloaderElements.downloadUrl.value);
        downloadId = result.downloadId;
        downloaderElements.downloadStatus.textContent = "Добавляем аудиофайлы в медиатеку…";
        const { importedCount, failedCovers } = await importDownloadedTracks(result);
        const importedMessage = importedCount === 1
            ? "Трек добавлен в медиатеку."
            : `Добавлено треков: ${importedCount}.`;
        downloaderElements.downloadStatus.textContent = failedCovers
            ? `${importedMessage} Не удалось сохранить обложки: ${failedCovers}.`
            : importedMessage;
        downloaderElements.downloadProgress.value = 100;
        downloaderElements.downloadUrl.value = "";
        showToast(failedCovers
            ? `${importedMessage} Ошибок обложек: ${failedCovers}.`
            : importedCount === 1 ? "Трек добавлен в медиатеку" : `Добавлено треков: ${importedCount}`, failedCovers > 0);
    }
    catch (error) {
        console.error("Не удалось загрузить аудио:", error);
        downloaderElements.downloadStatus.textContent = `Ошибка загрузки: ${String(error)}`;
        showToast(`Не удалось загрузить аудио: ${String(error)}`, true);
    }
    finally {
        stopListening?.();
        if (downloadId) {
            try {
                await api.cleanupDownload(downloadId);
            }
            catch (error) {
                console.error("Не удалось очистить временные файлы загрузки:", error);
                showToast(`Не удалось удалить временные файлы: ${String(error)}`, true);
            }
        }
        downloaderElements.downloadSubmitBtn.disabled = false;
    }
}
