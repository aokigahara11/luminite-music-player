import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { emit, listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import type { AudioStatus, StoredCover, StoredTrack } from "../types";

const title = document.getElementById("player-title") as HTMLElement;
const artist = document.getElementById("player-artist") as HTMLElement;
const cover = document.getElementById("player-cover") as HTMLImageElement;
const playButton = document.getElementById("play-btn") as HTMLButtonElement;
const prevButton = document.getElementById("prev-btn") as HTMLButtonElement;
const nextButton = document.getElementById("next-btn") as HTMLButtonElement;
const closeButton = document.getElementById("close-miniplayer-btn") as HTMLButtonElement;

const defaultCover = new URL("../assets/media_library.png", import.meta.url).href;
const THEMES = [
    "theme-purple",
    "theme-emerald",
    "theme-red",
    "theme-blue",
    "theme-orange",
    "theme-pink",
    "theme-yellow",
] as const;
const THEME_CLASSES = new Set<string>(THEMES);
let isPlaying = false;

function applyTheme(theme: string): void {
    if (!THEME_CLASSES.has(theme))
        return;

    document.documentElement.classList.remove(...THEMES);
    document.documentElement.classList.add(theme);
}

try {
    const savedTheme = localStorage.getItem("luminite-theme");
    if (savedTheme)
        applyTheme(savedTheme);
} catch (error) {
    console.error("Не удалось загрузить тему миниплеера:", error);
}

function setPlayIcon(): void {
    playButton.innerHTML = isPlaying
        ? '<svg class="icon-svg" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>'
        : '<svg class="icon-svg" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><polygon points="6,4 20,12 6,20"/></svg>';
    playButton.setAttribute("aria-label", isPlaying ? "Пауза" : "Воспроизвести");
}

async function updateTrack(trackPath: string | null): Promise<void> {
    if (!trackPath) {
        title.textContent = "Трек не выбран";
        artist.textContent = "Выберите трек для воспроизведения";
        cover.src = defaultCover;
        return;
    }

    try {
        const [tracks, covers] = await Promise.all([
            invoke<StoredTrack[]>("get_library"),
            invoke<StoredCover[]>("get_covers"),
        ]);
        const track = tracks.find((item) => item.path === trackPath);
        if (!track) return;

        title.textContent = track.title;
        artist.textContent = track.artist || "Неизвестный исполнитель";

        const trackCover = track.cover || covers.find((item) => item.kind === "track" && item.entity_id === track.id)?.path_file;
        cover.src = trackCover
            ? (/^(https?:|data:|blob:)/i.test(trackCover) ? trackCover : convertFileSrc(trackCover))
            : defaultCover;
        cover.alt = track.title;
    } catch (error) {
        console.error("Не удалось обновить информацию миниплеера:", error);
    }
}

playButton.addEventListener("click", () => void emit("player-shortcut-action", "play-pause"));
prevButton.addEventListener("click", () => void emit("player-shortcut-action", "previous-track"));
nextButton.addEventListener("click", () => void emit("player-shortcut-action", "next-track"));
closeButton.addEventListener("click", () => void getCurrentWindow().hide());

void listen<string>("theme-changed", ({ payload }) => applyTheme(payload)).catch((error) => {
    console.error("Не удалось подписаться на смену темы для миниплеера:", error);
});

void listen<AudioStatus>("audio-state", ({ payload }) => {
    isPlaying = payload.isPlaying;
    setPlayIcon();
    void updateTrack(payload.trackPath);
});