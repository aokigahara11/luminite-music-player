import { api } from "../api";
import { switchView } from "../core/views";
import { elements as homeElements } from "../elements/home";
import { state } from "../state";
import type { RecentItemKind } from "../types";
import { escapeHtml } from "../utils/format";
import { playTrack } from "./playerbar";
import { resolveCoverSource } from "../assets";

export let recentSaveQueue: Promise<void> = Promise.resolve();

// Отрисовка недавних прослушанных треков и плейлистов на главной странице
export function renderRecentlyPlayed() {
    const items = state.recentItems;
    if (items.length === 0) {
        homeElements.recentlyPlayedGrid.innerHTML = '<p class="recently-played-empty">Пока ничего не прослушано</p>';
        return;
    }

    homeElements.recentlyPlayedGrid.innerHTML = items.map((item) => {
        const coverPath = resolveCoverSource(item.cover.path);
        const cover = escapeHtml(coverPath);
        const title = escapeHtml(item.title);
        const cardCover = item.kind === "track"
            ? `<button class="card-play-btn" type="button" aria-label="Воспроизвести ${title}">
                   <svg class="icon-svg" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><polygon points="6,4 20,12 6,20" /></svg>
               </button>`
            : "";
        return `
            <div class="media-card" data-recent-kind="${item.kind}" data-id="${escapeHtml(item.entity_id)}">
                <div class="card-cover-wrapper">
                    <img src="${cover}" alt="Обложка: ${title}" class="card-cover" />
                    ${cardCover}
                </div>
                <div class="card-title">${title}</div>
                <div class="card-artist">${escapeHtml(item.subtitle)}</div>
            </div>`;
    }).join("");

    homeElements.recentlyPlayedGrid.querySelectorAll<HTMLElement>(".media-card").forEach((card) => {
        card.addEventListener("click", () => {
            const id = card.dataset.id;
            if (!id)
                return;
            if (card.dataset.recentKind === "track") {
                playTrack(id);
            }
            else {
                state.selectedPlaylistId = id;
                switchView("playlist-detail");
            }
        });
    });
}

// Сохранение истории прослушивания трека или плейлиста
export function recordRecentlyPlayed(kind: RecentItemKind, entityId: string) {
    recentSaveQueue = recentSaveQueue
        .then(async () => {
        state.recentItems = await api.recordRecentlyPlayed(kind, entityId);
        renderRecentlyPlayed();
    })
        .catch((error) => console.error("Не удалось сохранить историю прослушивания:", error));
}
