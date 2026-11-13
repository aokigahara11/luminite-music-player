import { elements } from "../elements/search";
import { state } from "../state";
import { getDefaultPlaylistCover, getDefaultTrackCover } from "../assets";
import { escapeHtml } from "../utils/format";

export function setupSearch(
    onTrackSelected: (trackId: string) => void,
    onLibraryFilterChanged: (filter: { byArtist: boolean; byNameTrack: boolean; query: string }) => void,
    onPlaylistSelected: (playlistId: string) => void,
): void {
    elements.searchInput?.addEventListener("input", (event) => {
        const query = (event.target as HTMLInputElement).value.toLocaleLowerCase().trim();
        if (!query) {
            elements.searchDropdown?.classList.add("hidden");
            return;
        }

        const matchedTracks = state.tracks.filter((track) =>
            track.title.toLocaleLowerCase().includes(query) || track.artist.toLocaleLowerCase().includes(query),
        ).map((track) => ({
            kind: "track" as const,
            id: track.id,
            title: track.title,
            subtitle: `Трек · ${track.artist}`,
            cover: track.cover || getDefaultTrackCover(),
            type: "track",
            ariaLabel: `Воспроизвести трек ${track.title}`,
        }));
        const matchedPlaylists = state.playlists.filter((playlist) =>
            playlist.title.toLocaleLowerCase().includes(query)
            || playlist.category.toLocaleLowerCase().includes(query),
        ).map((playlist) => ({
            kind: "playlist" as const,
            id: playlist.id,
            title: playlist.title,
            subtitle: `${playlist.category} · ${playlist.trackIds.length} треков`,
            cover: getDefaultPlaylistCover(playlist.id) || playlist.cover || getDefaultTrackCover(),
            type: playlist.category === "Альбом" ? "album" : playlist.category === "EP" ? "ep" : "playlist",
            ariaLabel: `Открыть ${playlist.category.toLocaleLowerCase()} ${playlist.title}`,
        }));
        const matched = [...matchedTracks, ...matchedPlaylists];

        elements.searchDropdown?.classList.remove("hidden");
        elements.searchResultsList.innerHTML = matched.length
            ? matched.map((item) => `
                <button class="search-item ${item.kind}" type="button" data-kind="${item.kind}" data-id="${escapeHtml(item.id)}" aria-label="${escapeHtml(item.ariaLabel)}">
                    <img class="search-item-cover" src="${escapeHtml(item.cover)}" alt="" />
                    <span class="search-item-info">
                        <span class="search-item-title">${escapeHtml(item.title)}</span>
                        <span class="search-item-sub">${escapeHtml(item.subtitle)}</span>
                    </span>
                </button>
            `).join("")
            : '<div class="search-no-results">Ничего не найдено</div>';

        elements.searchResultsList.querySelectorAll<HTMLButtonElement>(".search-item").forEach((item) => {
            item.addEventListener("click", () => {
                const id = item.dataset.id;
                if (!id)
                    return;
                if (item.dataset.kind === "playlist")
                    onPlaylistSelected(id);
                else
                    onTrackSelected(id);
                elements.searchDropdown?.classList.add("hidden");
            });
        });
    });

    const applyLibraryFilter = () => {
        onLibraryFilterChanged({
            byArtist: elements.libraryFilterByArtist.checked,
            byNameTrack: elements.libraryFilterByName.checked,
            query: elements.libraryFilterQuery.value,
        });
    };

    elements.libraryFilterButton?.addEventListener("click", () => {
        const isOpen = elements.libraryFilterPanel.classList.toggle("hidden") === false;
        elements.libraryFilterButton.setAttribute("aria-expanded", String(isOpen));
        if (isOpen)
            elements.libraryFilterQuery.focus();
    });

    elements.libraryFilterByName?.addEventListener("change", applyLibraryFilter);
    elements.libraryFilterByArtist?.addEventListener("change", applyLibraryFilter);
    elements.libraryFilterQuery?.addEventListener("input", applyLibraryFilter);

    document.addEventListener("click", (event) => {
        const target = event.target;
        if (target instanceof Element && !target.closest(".media-library-filter-control")) {
            elements.libraryFilterPanel?.classList.add("hidden");
            elements.libraryFilterButton?.setAttribute("aria-expanded", "false");
        }
    });

    document.addEventListener("keydown", (event) => {
        if (event.key !== "Escape" || elements.libraryFilterPanel?.classList.contains("hidden"))
            return;
        elements.libraryFilterPanel.classList.add("hidden");
        elements.libraryFilterButton?.setAttribute("aria-expanded", "false");
        elements.libraryFilterButton?.focus();
    });

    applyLibraryFilter();
}
