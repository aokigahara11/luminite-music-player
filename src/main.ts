import { configureViewRenderers, switchView } from "./core/views";
import { initEvents } from "./init/events";
import { loadSavedData } from "./modules/library";
import { renderMediaLibrary } from "./modules/tracks";
import { renderPlaylists, renderPlaylistDetail } from "./modules/playlists";
import { initTooltips } from "./utils/tooltips";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";

configureViewRenderers({ renderMediaLibrary, renderPlaylists, renderPlaylistDetail });

const SPLASH_MIN_DURATION_MS = 1500;
const startupTime = performance.now();

async function showMainWindow(): Promise<void> {
    const remainingTime = SPLASH_MIN_DURATION_MS - (performance.now() - startupTime);
    if (remainingTime > 0) {
        await new Promise<void>((resolve) => window.setTimeout(resolve, remainingTime));
    }

    const splashWindow = await WebviewWindow.getByLabel("splashscreen");
    await getCurrentWindow().show();
    await splashWindow?.close();
}

document.addEventListener('contextmenu', (e) => {
    e.preventDefault();
});

document.addEventListener("DOMContentLoaded", async () => {
    try {
        initTooltips();
        await initEvents();
        try {
            await loadSavedData();
        } catch (error) {
            console.error("Не удалось загрузить сохранённую библиотеку:", error);
        }
        switchView("main");
    } finally {
        try {
            await showMainWindow();
        } catch (error) {
            console.error("Не удалось завершить показ загрузочного экрана:", error);
        }
    }
});
