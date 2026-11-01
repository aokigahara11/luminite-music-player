export const elements = {
    sidebarTitle: document.getElementById("sidebar-title") as HTMLElement,
    sidebarArtist: document.getElementById("sidebar-artist") as HTMLElement,
    sidebarPlayCount: document.getElementById("sidebar-play-count") as HTMLElement,
    sidebarCover: document.getElementById("sidebar-cover") as HTMLImageElement,
    sidebarCoverWrapper: document.querySelector(".sidebar-cover-wrapper") as HTMLElement,
    changeTrackCoverBtn: document.getElementById("change-track-cover-btn") as HTMLButtonElement,
    favoriteBtn: document.getElementById("add-btn") as HTMLButtonElement,
    sidebarPlayerActions: document.querySelector(".sidebar-player-actions") as HTMLElement,
    editTrackBtn: document.getElementById("edit-track-btn") as HTMLButtonElement,
    sidebarRemixBtn: document.getElementById("create-remix-btn") as HTMLButtonElement,
    sidebarAddToPlaylistBtn: document.getElementById("add-to-playlist-btn") as HTMLButtonElement,
    trackEditForm: document.getElementById("track-edit-form") as HTMLFormElement,
    trackTitleInput: document.getElementById("track-title-input") as HTMLInputElement,
    trackArtistInput: document.getElementById("track-artist-input") as HTMLInputElement,
    saveTrackEditBtn: document.getElementById("save-track-edit-btn") as HTMLButtonElement,
    cancelTrackEditBtn: document.getElementById("cancel-track-edit-btn") as HTMLButtonElement,
    trackEditStatus: document.getElementById("track-edit-status") as HTMLElement
};
