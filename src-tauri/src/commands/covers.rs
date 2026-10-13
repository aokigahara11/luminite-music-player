use std::{fs, path::PathBuf};

use tauri::State;
use uuid::Uuid;

use crate::{
    database::core::Database,
    database::{covers, playlists, tracks},
    models::{Cover, CoverKind, FAVORITES_PLAYLIST_ID},
};

#[tauri::command]
pub fn get_covers(database: State<'_, Database>) -> Result<Vec<Cover>, String> {
    let connection = database
        .connection
        .lock()
        .map_err(|_| "Соединение с базой данных недоступно".to_string())?;
    covers::all(&connection)
}

#[tauri::command]
pub fn set_cover(
    database: State<'_, Database>,
    kind: CoverKind,
    entity_id: String,
    file_path: String,
) -> Result<Cover, String> {
    if kind == CoverKind::Playlist && entity_id == FAVORITES_PLAYLIST_ID {
        return Err("Обложку плейлиста «Избранное» нельзя изменить".to_string());
    }
    let source_path = PathBuf::from(file_path);
    if !source_path.is_file() {
        return Err("Файл обложки не найден".to_string());
    }
    let extension = source_path
        .extension()
        .and_then(|value| value.to_str())
        .map(str::to_ascii_lowercase)
        .filter(|value| ["jpg", "jpeg", "png", "webp"].contains(&value.as_str()))
        .ok_or_else(|| "Поддерживаются только JPG, PNG и WebP".to_string())?;

    let connection = database
        .connection
        .lock()
        .map_err(|_| "Соединение с базой данных недоступно".to_string())?;
    let exists = match kind {
        CoverKind::Track => tracks::get(&connection, &entity_id)?.is_some(),
        CoverKind::Playlist => playlists::all(&connection)?
            .iter()
            .any(|playlist| playlist.id == entity_id),
    };
    if !exists {
        return Err("Объект для обложки не найден".to_string());
    }

    let cover = Cover {
        id: Uuid::new_v4().to_string(),
        kind,
        entity_id,
        path_file: database
            .covers_dir
            .join(format!("{}.{}", Uuid::new_v4(), extension))
            .to_string_lossy()
            .to_string(),
    };
    fs::copy(&source_path, &cover.path_file)
        .map_err(|error| format!("Ошибка копирования обложки: {error}"))?;
    match covers::set(&connection, &cover) {
        Ok(old_path) => {
            drop(connection);
            if let Some(old_path) = old_path.filter(|path| path != &cover.path_file) {
                let _ = fs::remove_file(old_path);
            }
            Ok(cover)
        }
        Err(error) => {
            let _ = fs::remove_file(&cover.path_file);
            Err(error)
        }
    }
}
