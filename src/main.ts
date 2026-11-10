import { configureViewRenderers, switchView } from "./core/views";
import { initEvents } from "./init/events";
import { loadSavedData } from "./modules/library";
import { renderMediaLibrary } from "./modules/tracks";
import { renderPlaylists, renderPlaylistDetail } from "./modules/playlists";
import { initTooltips } from "./utils/tooltips";

configureViewRenderers({ renderMediaLibrary, renderPlaylists, renderPlaylistDetail });

document.addEventListener("DOMContentLoaded", async () => {
    initTooltips();
    await initEvents();
    try {
        await loadSavedData();
    } catch (error) {
        console.error("Не удалось загрузить сохранённую библиотеку:", error);
    }
    switchView("main");
});
