import { elements as navigationElements } from "./elements/navigation";
import { elements as settingsElements } from "./elements/settings";
import { elements as downloaderElements } from "./elements/downloader";
import { elements as homeElements } from "./elements/home";
import { elements as playlistsElements } from "./elements/playlists";
import { elements as playerbarElements } from "./elements/playerbar";
import { elements as sidebarElements } from "./elements/sidebar";
import { elements as notificationsElements } from "./elements/notifications";
import { elements as dataElements } from "./elements/data";
import { elements as remixElements } from "./elements/remix";
import { elements as searchElements } from "./elements/search";

export const elements = {
    ...navigationElements,
    ...settingsElements,
    ...downloaderElements,
    ...homeElements,
    ...playlistsElements,
    ...playerbarElements,
    ...sidebarElements,
    ...notificationsElements,
    ...dataElements,
    ...remixElements,
    ...searchElements,
};
