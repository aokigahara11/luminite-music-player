use tauri::State;
use uuid::Uuid;

use crate::{
    database::core::Database,
    database::{covers, playlists, recently_played},
    models::{CoverKind, Playlist, PlaylistCategory, RecentItemKind, FAVORITES_PLAYLIST_ID},
};

#[tauri::command]
pub fn create_playlist(
    database: State<'_, Database>,
    name: String,
    category: PlaylistCategory,
) -> Result<Playlist, String> {
    let name = name.trim();
    if name.is_empty() {
        return Err("Название плейлиста не должно быть пустым.".to_string());
    }
    let playlist = Playlist {
        id: Uuid::new_v4().to_string(),
        name: name.to_string(),
        category,
        id_tracks: Vec::new(),
    };
    let connection = database
        .connection
        .lock()
        .map_err(|_| "Соединение с базой данных недоступно".to_string())?;
    playlists::create(&connection, &playlist)?;
    Ok(playlist)
}

#[tauri::command]
pub fn get_playlists(database: State<'_, Database>) -> Result<Vec<Playlist>, String> {
    let connection = database
        .connection
        .lock()
        .map_err(|_| "Соединение с базой данных недоступно".to_string())?;
    playlists::ensure_favorites(&connection)?;
    playlists::all(&connection)
}

#[tauri::command]
pub fn add_track_to_playlist(
    database: State<'_, Database>,
    playlist_id: String,
    track_id: String,
) -> Result<(), String> {
    let connection = database
        .connection
        .lock()
        .map_err(|_| "Соединение с базой данных недоступно".to_string())?;
    playlists::add_track(&connection, &playlist_id, &track_id)
}

#[tauri::command]
pub fn remove_track_from_playlist(
    database: State<'_, Database>,
    playlist_id: String,
    track_id: String,
) -> Result<(), String> {
    let connection = database
        .connection
        .lock()
        .map_err(|_| "Соединение с базой данных недоступно".to_string())?;
    playlists::remove_track(&connection, &playlist_id, &track_id)
}

#[tauri::command]
pub fn delete_playlist(
    database: State<'_, Database>,
    playlist_id: String,
) -> Result<Vec<Playlist>, String> {
    if playlist_id == FAVORITES_PLAYLIST_ID {
        return Err("Плейлист «Избранное» нельзя удалить".to_string());
    }
    let connection = database
        .connection
        .lock()
        .map_err(|_| "Соединение с базой данных недоступно".to_string())?;
    playlists::delete(&connection, &playlist_id)?;
    let cover_paths = covers::remove_entity(&connection, CoverKind::Playlist, &playlist_id)?;
    recently_played::remove_entity(&connection, RecentItemKind::Playlist, &playlist_id)?;
    drop(connection);
    for path in cover_paths {
        let _ = std::fs::remove_file(path);
    }
    get_playlists(database)
}

#[tauri::command]
pub fn edit_metadata_playlist(
    database: State<'_, Database>,
    id: String,
    name: String,
    category: PlaylistCategory,
) -> Result<Playlist, String> {
    if id == FAVORITES_PLAYLIST_ID {
        return Err("Плейлист «Избранное» нельзя переименовать".to_string());
    }
    let name = name.trim();
    if name.is_empty() {
        return Err("Название плейлиста не должно быть пустым.".to_string());
    }
    let connection = database
        .connection
        .lock()
        .map_err(|_| "Соединение с базой данных недоступно".to_string())?;
    playlists::update_metadata(&connection, &id, name, category)?;
    playlists::all(&connection)?
        .into_iter()
        .find(|playlist| playlist.id == id)
        .ok_or_else(|| "Плейлист с таким ID не найден.".to_string())
}
