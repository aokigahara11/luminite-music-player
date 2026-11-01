import { elements } from "../elements/search";
import { state } from "../state";

// Настройка поиска треков в медиатеке
export function setupSearch(onTrackSelected: (trackId: string) => void): void {
    elements.searchInput?.addEventListener("input", (event) => {
        const query = (event.target as HTMLInputElement).value.toLowerCase().trim();
        if (!query) {
            elements.searchDropdown?.classList.add("hidden");
            return;
        }

        const matched = state.tracks.filter((track) =>
            track.title.toLowerCase().includes(query) || track.artist.toLowerCase().includes(query),
        );

        if (matched.length === 0) {
            elements.searchDropdown?.classList.add("hidden");
            return;
        }

        elements.searchDropdown?.classList.remove("hidden");
        elements.searchResultsList.innerHTML = matched
            .map((track) => `
        <div class="search-item" data-id="${track.id}" style="padding: 8px; cursor: pointer;">
          <div>${track.title}</div>
          <small style="opacity: 0.7">${track.artist}</small>
        </div>
      `)
            .join("");

        elements.searchResultsList.querySelectorAll(".search-item").forEach((item) => {
            item.addEventListener("click", () => {
                const id = item.getAttribute("data-id");
                if (id) onTrackSelected(id);
                elements.searchDropdown?.classList.add("hidden");
            });
        });
    });
}
