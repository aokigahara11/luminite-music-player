import { api } from "../api";
import { state } from "../state";
import type { AudioStatus, PlayerConfig } from "../types";

const initialAudioStatus: AudioStatus = {
    positionSecs: 0,
    durationSecs: 0,
    trackPath: null,
    volume: 0.7,
    isPlaying: false,
    loaded: false,
    ended: false,
};

export const player = {
    audioStatus: initialAudioStatus,
    saveQueue: Promise.resolve() as Promise<void>,
    configLoaded: false,
};

// Сохранение состояния плеера в хранилище
export function savePlayerConfig(): void {
    const config: PlayerConfig = {
        current_track_id: state.currentTrackId,
        position_secs: Number.isFinite(player.audioStatus.positionSecs) ? player.audioStatus.positionSecs : 0,
        volume: player.audioStatus.volume,
        is_playing: state.isPlaying,
    };

    player.saveQueue = player.saveQueue
        .then(() => api.savePlayerConfig(config))
        .catch((error) => console.error("Не удалось сохранить состояние плеера:", error));
}
