import { elements } from "../elements/navigation";
import { state } from "../state";
import type { AppState } from "../types";

interface ViewRenderers {
    renderMediaLibrary(): void;
    renderPlaylists(): void;
    renderPlaylistDetail(): void;
}

let renderers: ViewRenderers | null = null;

// Функция для настройки рендереров представлений
export function configureViewRenderers(viewFunctions: ViewRenderers): void {
    renderers = viewFunctions;
}

// Открытие модального окна
export function openModal(modal: HTMLElement): void {
    modal.classList.remove("hidden");
}

// Закрытие модального окна
export function closeModal(modal: HTMLElement): void {
    modal.classList.add("hidden");
}

// Смена секуции в приложении 
export function switchView(view: AppState["activeView"]): void {
    state.activeView = view;

    [
        elements.viewMain,
        elements.viewMediaLibrary,
        elements.viewPlaylists,
        elements.viewSettings,
        elements.viewDownloader,
        elements.viewPlaylistDetail,
    ].forEach((section) => section?.classList.remove("active"));
    [
        elements.mainBtn,
        elements.mediaLibraryBtn,
        elements.playlistsBtn,
        elements.settingsBtn,
        elements.downloaderBtn,
    ].forEach((button) => button?.classList.remove("active"));

    if (view === "main") {
        elements.viewMain?.classList.add("active");
        elements.mainBtn?.classList.add("active");
    } else if (view === "media-library") {
        elements.viewMediaLibrary?.classList.add("active");
        elements.mediaLibraryBtn?.classList.add("active");
        requireRenderers().renderMediaLibrary();
    } else if (view === "playlists") {
        elements.viewPlaylists?.classList.add("active");
        elements.playlistsBtn?.classList.add("active");
        requireRenderers().renderPlaylists();
    } else if (view === "settings") {
        elements.viewSettings?.classList.add("active");
        elements.settingsBtn?.classList.add("active");
    } else if (view === "downloader") {
        elements.viewDownloader?.classList.add("active");
        elements.downloaderBtn?.classList.add("active");
    } else if (view === "playlist-detail") {
        elements.viewPlaylistDetail?.classList.add("active");
        requireRenderers().renderPlaylistDetail();
    }
}

function requireRenderers(): ViewRenderers {
    if (!renderers) {
        throw new Error("View renderers have not been configured");
    }
    return renderers;
}
