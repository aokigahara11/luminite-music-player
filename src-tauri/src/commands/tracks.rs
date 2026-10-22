use std::{
    fs,
    path::{Path, PathBuf},
};

use lofty::{
    config::WriteOptions,
    file::{AudioFile, TaggedFileExt},
    probe::Probe,
    tag::{Accessor, Tag},
};
use tauri::State;
use uuid::Uuid;

use crate::{
    database::core::Database,
    database::{covers, recently_played, tracks},
    models::{CoverKind, RecentItemKind, Track},
};

#[tauri::command]
pub fn import_track(database: State<'_, Database>, file_path: String) -> Result<Track, String> {
    import_track_file(&database, Path::new(&file_path), false)
}

pub fn import_generated_track(
    database: &Database,
    file_path: &Path,
    artist: &str,
) -> Result<Track, String> {
    let artist = artist.trim();
    if !artist.is_empty() {
        let mut tagged_file = Probe::open(file_path)
            .map_err(|error| format!("Ошибка открытия ремикса для записи исполнителя: {error}"))?
            .read()
            .map_err(|error| format!("Ошибка чтения метаданных ремикса: {error}"))?;
        if tagged_file.primary_tag().is_none() {
            tagged_file.insert_tag(Tag::new(tagged_file.primary_tag_type()));
        }
        if let Some(tag) = tagged_file.primary_tag_mut() {
            tag.set_artist(artist.to_string());
        }
        tagged_file
            .save_to_path(file_path, WriteOptions::default())
            .map_err(|error| format!("Не удалось сохранить исполнителя в ремиксе: {error}"))?;
    }
    import_track_file(database, file_path, true)
}

fn import_track_file(
    database: &Database,
    source_path: &Path,
    move_source: bool,
) -> Result<Track, String> {
    if !source_path.is_file() {
        return Err("Исходный аудиофайл не найден".to_string());
    }
    let extension = source_path
        .extension()
        .and_then(|value| value.to_str())
        .map(|value| format!(".{value}"))
        .unwrap_or_default();
    let destination_path = database
        .media_dir
        .join(format!("{}{}", Uuid::new_v4(), extension));
    let mut track = parse_track_metadata(source_path)?;
    let file_operation = if move_source {
        fs::rename(source_path, &destination_path)
    } else {
        fs::copy(source_path, &destination_path).map(|_| ())
    };
    file_operation.map_err(|error| {
        if move_source {
            format!("Не удалось переместить созданный трек: {error}")
        } else {
            format!("Ошибка копирования: {error}")
        }
    })?;

    track.path = destination_path.to_string_lossy().into_owned();
    track.id = Uuid::new_v4().to_string();
    let result = (|| {
        let connection = database
            .connection
            .lock()
            .map_err(|_| "Соединение с базой данных недоступно".to_string())?;
        tracks::insert(&connection, &track)?;
        Ok(track)
    })();
    if result.is_err() {
        let _ = fs::remove_file(&destination_path);
    }
    result
}

#[tauri::command]
pub fn get_library(database: State<'_, Database>) -> Result<Vec<Track>, String> {
    let connection = database
        .connection
        .lock()
        .map_err(|_| "Соединение с базой данных недоступно".to_string())?;
    tracks::all(&connection)
}

#[tauri::command]
pub fn search_library(database: State<'_, Database>, query: String) -> Result<Vec<Track>, String> {
    let connection = database
        .connection
        .lock()
        .map_err(|_| "Соединение с базой данных недоступно".to_string())?;
    tracks::search(&connection, &query)
}

#[tauri::command]
pub fn delete_track(database: State<'_, Database>, track_id: String) -> Result<Vec<Track>, String> {
    let connection = database
        .connection
        .lock()
        .map_err(|_| "Соединение с базой данных недоступно".to_string())?;
    let track = tracks::get(&connection, &track_id)?
        .ok_or_else(|| "Трек с таким ID не найден".to_string())?;
    tracks::delete(&connection, &track_id)?;
    let cover_paths = covers::remove_entity(&connection, CoverKind::Track, &track_id)?;
    recently_played::remove_entity(&connection, RecentItemKind::Track, &track_id)?;
    drop(connection);

    let _ = fs::remove_file(track.path);
    for path in cover_paths {
        let _ = fs::remove_file(path);
    }
    get_library(database)
}

#[tauri::command]
pub fn edit_metadata_track(
    database: State<'_, Database>,
    id: String,
    title: String,
    artist: String,
) -> Result<Track, String> {
    let title = title.trim();
    let artist = artist.trim();
    if title.is_empty() {
        return Err("Название трека не может быть пустым".to_string());
    }
    let connection = database
        .connection
        .lock()
        .map_err(|_| "Соединение с базой данных недоступно".to_string())?;
    let mut track =
        tracks::get(&connection, &id)?.ok_or_else(|| "Трек с таким ID не найден".to_string())?;
    let track_path = PathBuf::from(&track.path);
    if !track_path.is_file() {
        return Err("Файл трека не найден".to_string());
    }

    let mut tagged_file = Probe::open(&track_path)
        .map_err(|error| format!("Ошибка открытия трека: {error}"))?
        .read()
        .map_err(|error| format!("Ошибка чтения тегов трека: {error}"))?;
    if tagged_file.primary_tag().is_none() {
        tagged_file.insert_tag(Tag::new(tagged_file.primary_tag_type()));
    }
    if let Some(tag) = tagged_file.primary_tag_mut() {
        tag.set_title(title.to_string());
        if artist.is_empty() {
            tag.remove_artist();
        } else {
            tag.set_artist(artist.to_string());
        }
    }
    tagged_file
        .save_to_path(&track_path, WriteOptions::default())
        .map_err(|error| format!("Ошибка сохранения тегов трека: {error}"))?;

    track.title = title.to_string();
    track.artist = (!artist.is_empty()).then(|| artist.to_string());
    tracks::update_metadata(&connection, &id, &track.title, track.artist.as_deref())?;
    Ok(track)
}

pub fn parse_track_metadata(file_path: &std::path::Path) -> Result<Track, String> {
    let tagged_file = Probe::open(file_path)
        .map_err(|error| format!("Ошибка открытия трека: {error}"))?
        .read()
        .map_err(|error| format!("Ошибка чтения трека: {error}"))?;
    let tag = tagged_file
        .primary_tag()
        .or_else(|| tagged_file.first_tag());
    let title = tag
        .and_then(|value| value.title().map(|value| value.to_string()))
        .unwrap_or_else(|| {
            file_path
                .file_stem()
                .map(|value| value.to_string_lossy().to_string())
                .unwrap_or_else(|| "Неизвестный трек".to_string())
        });
    Ok(Track {
        id: Uuid::new_v4().to_string(),
        path: file_path.to_string_lossy().to_string(),
        title,
        artist: tag.and_then(|value| value.artist().map(|value| value.to_string())),
        duration: tagged_file.properties().duration().as_secs() as u32,
    })
}
