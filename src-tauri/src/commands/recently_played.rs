use tauri::State;

use crate::{
    database::{core::Database, covers, playlists, recently_played, tracks},
    models::{
        CoverKind, RecentCover, RecentEntry, RecentItem, RecentItemKind, FAVORITES_PLAYLIST_ID,
    },
};

const RECENT_ITEMS_LIMIT: usize = 5;
const DEFAULT_TRACK_COVER: &str = "./src/assets/media_library.jpg";
const DEFAULT_FAVORITES_COVER: &str = "./src/assets/favorites.jpg";

#[tauri::command]
pub fn get_recently_played(database: State<'_, Database>) -> Result<Vec<RecentEntry>, String> {
    let connection = database
        .connection
        .lock()
        .map_err(|_| "Соединение с базой данных недоступно".to_string())?;
    let items = recently_played::all(&connection)?;
    let tracks = tracks::all(&connection)?;
    let playlists = playlists::all(&connection)?;
    let covers = covers::all(&connection)?;
    Ok(resolve_recent_items(&items, &tracks, &playlists, &covers))
}

#[tauri::command]
pub fn record_recently_played(
    database: State<'_, Database>,
    kind: RecentItemKind,
    entity_id: String,
) -> Result<Vec<RecentEntry>, String> {
    let connection = database
        .connection
        .lock()
        .map_err(|_| "Соединение с базой данных недоступно".to_string())?;
    let entity_exists = match kind {
        RecentItemKind::Track => tracks::get(&connection, &entity_id)?.is_some(),
        RecentItemKind::Playlist => playlists::all(&connection)?
            .iter()
            .any(|playlist| playlist.id == entity_id),
    };
    if !entity_exists {
        return Err("Трек или плейлист для истории не найден".to_string());
    }
    recently_played::record(&connection, &RecentItem { kind, entity_id })?;
    let items = recently_played::all(&connection)?;
    let tracks = tracks::all(&connection)?;
    let playlists = playlists::all(&connection)?;
    let covers = covers::all(&connection)?;
    Ok(resolve_recent_items(&items, &tracks, &playlists, &covers))
}

fn resolve_recent_items(
    items: &[RecentItem],
    tracks: &[crate::models::Track],
    playlists: &[crate::models::Playlist],
    covers: &[crate::models::Cover],
) -> Vec<RecentEntry> {
    items
        .iter()
        .take(RECENT_ITEMS_LIMIT)
        .filter_map(|item| {
            let (title, subtitle, cover_kind, default_cover) = match item.kind {
                RecentItemKind::Track => {
                    let track = tracks.iter().find(|track| track.id == item.entity_id)?;
                    (
                        track.title.clone(),
                        track
                            .artist
                            .clone()
                            .unwrap_or_else(|| "Неизвестный исполнитель".to_string()),
                        CoverKind::Track,
                        DEFAULT_TRACK_COVER,
                    )
                }
                RecentItemKind::Playlist => {
                    let playlist = playlists
                        .iter()
                        .find(|playlist| playlist.id == item.entity_id)?;
                    let default_cover = if playlist.id == FAVORITES_PLAYLIST_ID {
                        DEFAULT_FAVORITES_COVER
                    } else {
                        DEFAULT_TRACK_COVER
                    };
                    (
                        playlist.name.clone(),
                        format!("{} треков", playlist.id_tracks.len()),
                        CoverKind::Playlist,
                        default_cover,
                    )
                }
            };
            let cover = covers
                .iter()
                .find(|cover| cover.kind == cover_kind && cover.entity_id == item.entity_id)
                .map(|cover| RecentCover::File(cover.path_file.clone()))
                .unwrap_or_else(|| RecentCover::Asset(default_cover.to_string()));
            Some(RecentEntry {
                kind: item.kind,
                entity_id: item.entity_id.clone(),
                title,
                subtitle,
                cover,
            })
        })
        .collect()
}
