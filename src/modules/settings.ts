import { api } from "../api";
import { player } from "../core/player";
import { closeModal, switchView } from "../core/views";
import { elements as dataElements } from "../elements/data";
import { elements as playerbarElements } from "../elements/playerbar";
import { elements } from "../elements/settings";
import { elements as sidebarElements } from "../elements/sidebar";
import { state } from "../state";
import { getDefaultTrackCover } from "../assets";
import { showToast } from "../utils/toast";
import { loadSavedData } from "./library";
import { resetListenProgress, updateFavoriteButton } from "./sidebar";
import { updatePlayButtonIcon, updateProgressDisplay } from "./playerbar";
import { recentSaveQueue } from "./recentlyPlayed";

const AUDIO_SETTINGS_STORAGE_KEY = "luminite-audio-settings";
const THEME_STORAGE_KEY = "luminite-theme";
const THEMES = [
    "theme-purple",
    "theme-emerald",
    "theme-red",
    "theme-blue",
    "theme-orange",
    "theme-pink",
    "theme-yellow",
] as const;
const DEFAULT_THEME = THEMES[0];
const THEME_CLASSES = new Set<string>(THEMES);
const EQUALIZER_FREQUENCIES = [60, 150, 400, 1_000, 2_400, 15_000];
const LEGACY_EQUALIZER_FREQUENCIES = [60, 250, 1_000, 4_000, 12_000];

export const EQUALIZER_PRESETS: Record<string, number[]> = {
    flat: [0, 0, 0, 0, 0, 0],
    bassBoost: [7, 5, 2, 0, 0, 0],
    bassCut: [-6, -4, -1, 0, 0, 0],
    classical: [0, 0, 0, 2, 3, 4],
    dance: [5, 3, 0, 2, 4, 5],
    deep: [7, 4, 1, 0, 2, 3],
    electronic: [4, 2, -1, 2, 4, 4],
    hipHop: [6, 4, 1, 2, 3, 2],
    jazz: [3, 2, 0, 2, 3, 4],
    latin: [4, 2, 0, 2, 3, 3],
    loudness: [5, 3, 0, 0, 3, 5],
    lounge: [2, 2, 1, 1, 2, 3],
    piano: [1, 1, 0, 2, 3, 2],
    pop: [2, 3, 1, 2, 3, 2],
    rnb: [4, 3, 0, 1, 3, 4],
    rock: [4, 2, 0, 3, 4, 3],
    smallSpeakers: [-3, 3, 5, 4, 2, 0],
    speech: [-4, -2, 3, 5, 3, -2],
    trebleBoost: [0, 0, 0, 2, 5, 7],
    trebleCut: [0, 0, 0, -2, -5, -7],
    vocal: [-2, 0, 3, 5, 3, 1],
};

export interface AudioSettings {
    equalizer: number[];
    transitionDuration: number;
}

export const audioSettings: AudioSettings = {
    equalizer: [...EQUALIZER_PRESETS.flat],
    transitionDuration: 0,
};

// Отрисовка настроек звука в интерфейсе
export function renderAudioSettings(): void {
    elements.equalizerBands.querySelectorAll<HTMLInputElement>("[data-eq-band]").forEach((slider) => {
        const index = Number(slider.dataset.eqBand);
        const gain = audioSettings.equalizer[index];
        slider.value = gain.toString();
        slider.nextElementSibling!.textContent = `${gain > 0 ? "+" : ""}${gain} дБ`;
    });

    const preset = Object.entries(EQUALIZER_PRESETS)
        .find(([, gains]) => gains.every((gain, index) => gain === audioSettings.equalizer[index]));
    elements.equalizerPreset.value = preset?.[0] ?? "custom";
    elements.transitionDuration.value = audioSettings.transitionDuration.toString();
    elements.transitionDurationValue.textContent = audioSettings.transitionDuration === 0
        ? "Выкл."
        : `${audioSettings.transitionDuration.toFixed(1)} сек.`;
    elements.settingsStatus.textContent = "Настройки сохраняются автоматически на этом устройстве.";
}

// Сохранение настроек звука в локально е хранилище
export function saveAudioSettings(): void {
    try {
        localStorage.setItem(AUDIO_SETTINGS_STORAGE_KEY, JSON.stringify(audioSettings));
    } catch (error) {
        console.error("Не удалось сохранить настройки звука:", error);
        showToast("Не удалось сохранить настройки звука", true);
    }
}

// Сброс настроек звука к значения по умоливанию
export function resetAudioSettings(): void {
    audioSettings.equalizer = [...EQUALIZER_PRESETS.flat];
    audioSettings.transitionDuration = 0;
}

// Отсчистка сохранненых настроек звука из локального хранилища
export function clearSavedAudioSettings(): void {
    localStorage.removeItem(AUDIO_SETTINGS_STORAGE_KEY);
}

// Применение настроек эквалайзера к аудио
export function applyEqualizer(): void {
    void api.setEqualizer(audioSettings.equalizer).catch((error) => {
        console.error("Не удалось применить эквалайзер:", error);
        showToast(`Не удалось применить эквалайзер: ${String(error)}`, true);
    });
}

// Применение настроек длительности переходов к аудио
export function applyTransitionDuration(): void {
    void api.setTransitionDuration(audioSettings.transitionDuration).catch((error) => {
        console.error("Не удалось применить переходы:", error);
        showToast(`Не удалось применить переходы: ${String(error)}`, true);
    });
}

// Настройка событий для элементов настроек
export function setupSettingsEvents(): void {
    elements.themeRadios.forEach((radio) => {
        radio.addEventListener("change", () => {
            if (radio.checked) changeTheme(radio.value);
        });
    });

    elements.equalizerPreset?.addEventListener("change", () => {
        const preset = EQUALIZER_PRESETS[elements.equalizerPreset.value];
        if (!preset) return;
        audioSettings.equalizer = [...preset];
        renderAudioSettings();
        saveAudioSettings();
        applyEqualizer();
    });

    elements.equalizerBands?.querySelectorAll<HTMLInputElement>("[data-eq-band]").forEach((slider) => {
        slider.addEventListener("input", () => {
            const index = Number(slider.dataset.eqBand);
            audioSettings.equalizer[index] = Number(slider.value);
            renderAudioSettings();
            saveAudioSettings();
            applyEqualizer();
        });
    });

    elements.equalizerResetBtn?.addEventListener("click", () => {
        audioSettings.equalizer = [...EQUALIZER_PRESETS.flat];
        renderAudioSettings();
        saveAudioSettings();
        applyEqualizer();
    });

    elements.transitionDuration?.addEventListener("input", () => {
        audioSettings.transitionDuration = Number(elements.transitionDuration.value);
        renderAudioSettings();
        saveAudioSettings();
        applyTransitionDuration();
    });
}

function applyTheme(theme: string): void {
    document.documentElement.classList.remove(...THEMES);
    document.documentElement.classList.add(theme);
    elements.themeRadios.forEach((radio) => {
        radio.checked = radio.value === theme;
    });
}

export function loadThemeSettings(): void {
    let theme: string = DEFAULT_THEME;
    try {
        const storedTheme = localStorage.getItem(THEME_STORAGE_KEY);
        if (storedTheme && THEME_CLASSES.has(storedTheme)) {
            theme = storedTheme;
        } else if (storedTheme) {
            console.warn("Сохранена неизвестная тема оформления:", storedTheme);
        }
    } catch (error) {
        console.error("Не удалось загрузить тему оформления:", error);
        showToast("Не удалось загрузить тему оформления", true);
    }

    applyTheme(theme);
}

// Загрузка настроек звука из локального хранилища и применение их к аудио
export async function loadAudioSettings(): Promise<void> {
    try {
        const stored = localStorage.getItem(AUDIO_SETTINGS_STORAGE_KEY);
        if (stored) {
            const parsed: unknown = JSON.parse(stored);
            if (typeof parsed === "object" && parsed !== null) {
                const candidate = parsed as Partial<AudioSettings>;
                if (
                    Array.isArray(candidate.equalizer)
                    && (candidate.equalizer.length === EQUALIZER_FREQUENCIES.length
                        || candidate.equalizer.length === LEGACY_EQUALIZER_FREQUENCIES.length)
                    && candidate.equalizer.every((gain) => typeof gain === "number" && Number.isFinite(gain))
                ) {
                    const savedGains = candidate.equalizer;
                    audioSettings.equalizer = savedGains.length === LEGACY_EQUALIZER_FREQUENCIES.length
                        ? EQUALIZER_FREQUENCIES.map((frequency) => {
                            if (frequency <= LEGACY_EQUALIZER_FREQUENCIES[0]) return savedGains[0];
                            const lastIndex = LEGACY_EQUALIZER_FREQUENCIES.length - 1;
                            if (frequency >= LEGACY_EQUALIZER_FREQUENCIES[lastIndex]) return savedGains[lastIndex];
                            const upperIndex = LEGACY_EQUALIZER_FREQUENCIES.findIndex((bandFrequency) => bandFrequency >= frequency);
                            const lowerIndex = upperIndex - 1;
                            const ratio = (Math.log(frequency) - Math.log(LEGACY_EQUALIZER_FREQUENCIES[lowerIndex]))
                                / (Math.log(LEGACY_EQUALIZER_FREQUENCIES[upperIndex]) - Math.log(LEGACY_EQUALIZER_FREQUENCIES[lowerIndex]));
                            return savedGains[lowerIndex] + (savedGains[upperIndex] - savedGains[lowerIndex]) * ratio;
                        }).map((gain) => Math.min(12, Math.max(-12, gain)))
                        : savedGains.map((gain) => Math.min(12, Math.max(-12, gain)));
                }
                
                if (typeof candidate.transitionDuration === "number" && Number.isFinite(candidate.transitionDuration)) {
                    audioSettings.transitionDuration = Math.min(8, Math.max(0, candidate.transitionDuration));
                }
            }
        }
    } catch (error) {
        console.error("Не удалось загрузить настройки звука:", error);
        showToast("Не удалось загрузить настройки звука", true);
    }

    renderAudioSettings();
    try {
        await Promise.all([
            api.setEqualizer(audioSettings.equalizer),
            api.setTransitionDuration(audioSettings.transitionDuration),
        ]);
    } catch (error) {
        console.error("Не удалось восстановить настройки звука:", error);
        showToast(`Не удалось восстановить настройки звука: ${String(error)}`, true);
    }
}

// Удаления всех данных приложения, включая медиатеку, плейлисты, историю прослушивания и настройки звука
export async function deleteAllAppData() {
    dataElements.confirmDeleteDataBtn.disabled = true;
    try {
        await Promise.all([player.saveQueue, recentSaveQueue]);
        player.audioStatus = await api.stopAudio();
        state.isPlaying = false;
        state.currentTrackId = null;
        await api.deleteAllData();
        state.tracks = [];
        state.playlists = [];
        state.recentItems = [];
        state.currentTrackId = null;
        state.isPlaying = false;
        resetListenProgress();
        state.selectedPlaylistId = null;
        state.playbackQueueTrackIds = [];
        state.playbackQueuePlaylistId = null;
        resetAudioSettings();
        let localSettingsError: unknown;
        try {
            clearSavedAudioSettings();
        }
        catch (error) {
            localSettingsError = error;
            console.error("Не удалось удалить локальные настройки звука:", error);
        }
        try {
            localStorage.removeItem(THEME_STORAGE_KEY);
        } catch (error) {
            localSettingsError ??= error;
            console.error("Не удалось удалить сохраненную тему оформления:", error);
        } finally {
            applyTheme(DEFAULT_THEME);
        }
        await Promise.all([
            api.setAudioVolume(0.7),
            api.setEqualizer(audioSettings.equalizer),
            api.setTransitionDuration(0),
        ]);
        renderAudioSettings();
        closeModal(dataElements.deleteDataModal);
        playerbarElements.playerTitle.textContent = "Не выбрано";
        playerbarElements.playerArtist.textContent = "Исполнитель";
        sidebarElements.sidebarTitle.textContent = "Не выбрано";
        sidebarElements.sidebarArtist.textContent = "Исполнитель";
        sidebarElements.sidebarPlayCount.textContent = "Прослушиваний: 0";
        sidebarElements.editTrackBtn.disabled = true;
        sidebarElements.sidebarRemixBtn.disabled = true;
        sidebarElements.sidebarAddToPlaylistBtn.disabled = true;
        sidebarElements.changeTrackCoverBtn.disabled = true;
        playerbarElements.playerCover.src = getDefaultTrackCover();
        sidebarElements.sidebarCover.src = getDefaultTrackCover();
        sidebarElements.sidebarCoverWrapper.classList.remove("has-cover");
        updateFavoriteButton();
        updatePlayButtonIcon();
        updateProgressDisplay(0);
        switchView("main");
        await loadSavedData();
        if (localSettingsError) {
            showToast(`Данные удалены, но не удалось очистить локальные настройки: ${String(localSettingsError)}`, true);
        }
        else {
            showToast("Все данные удалены");
        }
    }
    catch (error) {
        console.error("Не удалось удалить все данные:", error);
        try {
            state.currentTrackId = null;
            state.isPlaying = false;
            await loadSavedData();
        }
        catch (reloadError) {
            console.error("Не удалось обновить данные после попытки удаления:", reloadError);
        }
        showToast(`Не удалось удалить все данные: ${String(error)}`, true);
    }
    finally {
        dataElements.confirmDeleteDataBtn.disabled = false;
    }
}

export function changeTheme(theme: string): void {
    if (!THEME_CLASSES.has(theme)) {
        console.error("Неизвестная тема оформления:", theme);
        return;
    }

    applyTheme(theme);
    try {
        localStorage.setItem(THEME_STORAGE_KEY, theme);
    } catch (error) {
        console.error("Не удалось сохранить тему оформления:", error);
        showToast("Не удалось сохранить тему оформления", true);
    }
}
