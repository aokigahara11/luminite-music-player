#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use lofty::file::{AudioFile, TaggedFileExt};
use lofty::probe::Probe;
use lofty::config::WriteOptions;
use lofty::tag::{Accessor, Tag};
use serde::{Deserialize, Serialize};
use std::{fs, path::Path, path::PathBuf};
use tauri::Manager;
use uuid::Uuid;

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            import_track,
            get_library,
            delete_track,
            search_library,
            create_playlist,
            add_track_to_playlist,
            remove_track_from_playlist,
            get_playlists,
            delete_playlist,
            edit_metadata_playlist,
            get_player_config,
            save_player_config,
            edit_metadata_track
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

// Структура с базовыми путями
pub struct AppPaths {
    pub app_dir: PathBuf,
    pub media_dir: PathBuf,
    pub covers_dir: PathBuf,
    pub library_path: PathBuf,
    pub config_path: PathBuf,
}

// Структура для работы с данными трека
#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct Track {
    pub id: String,
    pub path: String,
    pub title: String,
    pub artist: Option<String>,
    pub duration: u32,
}

// Структура для работы с плейлистом
#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct Playlist {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub category: PlaylistCategory,
    pub id_tracks: Vec<String>,
}

#[derive(Serialize, Deserialize, Debug, Clone, Copy, PartialEq, Eq)]
pub enum PlaylistCategory {
    #[serde(rename = "EP")]
    Ep,
    #[serde(rename = "Альбом")]
    Album,
    #[serde(rename = "Плейлист")]
    Playlist,
}

impl Default for PlaylistCategory {
    fn default() -> Self {
        Self::Playlist
    }
}

// Единая структура корневого JSON файла
#[derive(Serialize, Deserialize, Debug, Clone, Default)]
pub struct AppData {
    pub tracks: Vec<Track>,
    pub playlists: Vec<Playlist>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct PlayerConfig {
    pub current_track_id: Option<String>,
    pub position_secs: f64,
    pub volume: f64,
    pub is_playing: bool,
}

impl Default for PlayerConfig {
    fn default() -> Self {
        Self {
            current_track_id: None,
            position_secs: 0.0,
            volume: 0.7,
            is_playing: false,
        }
    }
}

// Получить директории приложения в AppData
pub fn get_all_paths(app: &tauri::AppHandle) -> Result<AppPaths, String> {
    let app_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Не удалось получить app_data_dir: {}", e))?;

    let media_dir = app_dir.join("media");
    let covers_dir = app_dir.join("covers");
    let library_path = app_dir.join("library.json");
    let config_path = app_dir.join("config.json");

    fs::create_dir_all(&media_dir)
        .map_err(|e| format!("Ошибка создания папки media: {}", e))?;

    fs::create_dir_all(&covers_dir)
        .map_err(|e| format!("Ошибка создания папки covers: {}", e))?;

    Ok(AppPaths {
        app_dir,
        media_dir,
        covers_dir,
        library_path,
        config_path,
    })
}

// Чтение всей базы данных из JSON
pub fn load_app_data(library_path: &Path) -> AppData {
    if !library_path.exists() {
        let default_data = AppData::default();
        if let Ok(json) = serde_json::to_string_pretty(&default_data) {
            let _ = fs::write(library_path, json);
        }
        return default_data;
    }

    match fs::read_to_string(library_path) {
        Ok(content) => match serde_json::from_str::<AppData>(&content) {
            Ok(app_data) => {
                let needs_migration = serde_json::from_str::<serde_json::Value>(&content)
                    .ok()
                    .and_then(|value| {
                        value.get("playlists")?.as_array().map(|playlists| {
                            playlists.iter().any(|playlist| playlist.get("category").is_none())
                        })
                    })
                    .unwrap_or(false);

                if needs_migration {
                    let _ = save_app_data(library_path, &app_data);
                }

                app_data
            }
            Err(_) => AppData::default(),
        },
        Err(_) => AppData::default(),
    }
}

// Запись базы данных в JSON
pub fn save_app_data(library_path: &Path, data: &AppData) -> Result<(), String> {
    let json_data = serde_json::to_string_pretty(data)
        .map_err(|e| format!("Ошибка сериализации JSON: {}", e))?;

    fs::write(library_path, json_data)
        .map_err(|e| format!("Ошибка записи в library.json: {}", e))?;

    Ok(())
}

// Парсинг метаданных трека
pub fn parse_track_metadata(file_path: &Path) -> Result<Track, String> {
    let tagged_file = Probe::open(file_path)
        .map_err(|e| format!("Ошибка открытия трека: {}", e))?
        .read()
        .map_err(|e| format!("Ошибка чтения трека: {}", e))?;

    let tag = tagged_file.primary_tag().or_else(|| tagged_file.first_tag());

    let title = tag
        .and_then(|t| t.title().map(|s| s.to_string()))
        .unwrap_or_else(|| {
            file_path
                .file_stem()
                .map(|s| s.to_string_lossy().to_string())
                .unwrap_or_else(|| "Неизвестный трек".to_string())
        });

    let artist = tag.and_then(|t| t.artist().map(|s| s.to_string()));
    let duration = tagged_file.properties().duration().as_secs() as u32;

    Ok(Track {
        id: Uuid::new_v4().to_string(),
        path: file_path.to_string_lossy().to_string(),
        title,
        artist,
        duration,
    })
}

// Скопировать трек в хранилище приложения и добавить его в библиотеку
#[tauri::command]
fn import_track(app: tauri::AppHandle, file_path: String) -> Result<Track, String> {
    let paths = get_all_paths(&app)?;
    let src_path = PathBuf::from(file_path);
    if !src_path.is_file() {
        return Err("Исходный аудиофайл не найден".to_string());
    }

    let extension = src_path
        .extension()
        .and_then(|value| value.to_str())
        .map(|value| format!(".{}", value))
        .unwrap_or_default();
    let dest_path = paths.media_dir.join(format!("{}{}", Uuid::new_v4(), extension));
    fs::copy(&src_path, &dest_path).map_err(|err| format!("Ошибка копирования: {}", err))?;

    let track = match parse_track_metadata(&dest_path) {
        Ok(track) => track,
        Err(error) => {
            let _ = fs::remove_file(&dest_path);
            return Err(error);
        }
    };

    let mut app_data = load_app_data(&paths.library_path);
    app_data.tracks.push(track.clone());
    if let Err(error) = save_app_data(&paths.library_path, &app_data) {
        let _ = fs::remove_file(&dest_path);
        return Err(error);
    }

    Ok(track)
}

// Получить все треки
#[tauri::command]
fn get_library(app: tauri::AppHandle) -> Result<Vec<Track>, String> {
    let paths = get_all_paths(&app)?;
    let app_data = load_app_data(&paths.library_path);
    Ok(app_data.tracks)
}

// Удаление файла и его ID из всех плейлистов
#[tauri::command]
fn delete_track(app: tauri::AppHandle, track_id: String) -> Result<Vec<Track>, String> {
    let paths = get_all_paths(&app)?;
    let mut app_data = load_app_data(&paths.library_path);

    if let Some(track_to_remove) = app_data.tracks.iter().find(|t| t.id == track_id) {
        let file_path = Path::new(&track_to_remove.path);
        if file_path.exists() {
            let _ = fs::remove_file(file_path);
        }
    } else {
        return Err("Трек с таким ID не найден".to_string());
    }

    // Удаляем сам трек
    app_data.tracks.retain(|track| track.id != track_id);

    // Вычищаем его ID из всех плейлистов для сохранения целостности данных
    for playlist in app_data.playlists.iter_mut() {
        playlist.id_tracks.retain(|id| id != &track_id);
    }

    save_app_data(&paths.library_path, &app_data)?;
    Ok(app_data.tracks)
}

// Поиск по трекам
#[tauri::command]
fn search_library(app: tauri::AppHandle, query: String) -> Result<Vec<Track>, String> {
    let paths = get_all_paths(&app)?;
    let app_data = load_app_data(&paths.library_path);

    let q = query.trim().to_lowercase();
    if q.is_empty() {
        return Ok(app_data.tracks);
    }

    let filtered = app_data
        .tracks
        .into_iter()
        .filter(|track| {
            let title_match = track.title.to_lowercase().contains(&q);
            let artist_match = track
                .artist
                .as_deref()
                .map(|a| a.to_lowercase().contains(&q))
                .unwrap_or(false);

            title_match || artist_match
        })
        .collect();

    Ok(filtered)
}

// Создать плейлист
#[tauri::command]
fn create_playlist(app: tauri::AppHandle, name: String, category: PlaylistCategory) -> Result<Playlist, String> {
    let paths = get_all_paths(&app)?;
    let mut app_data = load_app_data(&paths.library_path);

    let playlist = Playlist {
        id: Uuid::new_v4().to_string(),
        name,
        category,
        id_tracks: Vec::new(),
    };

    app_data.playlists.push(playlist.clone());
    save_app_data(&paths.library_path, &app_data)?;

    Ok(playlist)
}

// Добавить трек в плейлист
#[tauri::command]
fn add_track_to_playlist(app: tauri::AppHandle, playlist_id: String, track_id: String) -> Result<(), String> {
    let paths = get_all_paths(&app)?;
    let mut app_data = load_app_data(&paths.library_path);

    if let Some(playlist) = app_data.playlists.iter_mut().find(|p| p.id == playlist_id) {
        if !playlist.id_tracks.contains(&track_id) {
            playlist.id_tracks.push(track_id);
            save_app_data(&paths.library_path, &app_data)?;
        }
        Ok(())
    } else {
        Err("Плейлист не найден".to_string())
    }
}

// Удалить трек из плейлиста
#[tauri::command]
fn remove_track_from_playlist(app: tauri::AppHandle, playlist_id: String, track_id: String) -> Result<(), String> {
    let paths = get_all_paths(&app)?;
    let mut app_data = load_app_data(&paths.library_path);

    if let Some(playlist) = app_data.playlists.iter_mut().find(|p| p.id == playlist_id) {
        playlist.id_tracks.retain(|id| id != &track_id);
        save_app_data(&paths.library_path, &app_data)?;
        Ok(())
    } else {
        Err("Плейлист не найден".to_string())
    }
}

// Получить список всех плейлистов
#[tauri::command]
fn get_playlists(app: tauri::AppHandle) -> Result<Vec<Playlist>, String> {
    let paths = get_all_paths(&app)?;
    let app_data = load_app_data(&paths.library_path);
    Ok(app_data.playlists)
}

// Удалить плейлист
#[tauri::command]
fn delete_playlist(app: tauri::AppHandle, playlist_id: String) -> Result<Vec<Playlist>, String> {
    let paths = get_all_paths(&app)?;
    let mut app_data = load_app_data(&paths.library_path);

    app_data.playlists.retain(|p| p.id != playlist_id);
    save_app_data(&paths.library_path, &app_data)?;

    Ok(app_data.playlists)
}

fn load_player_config(config_path: &Path) -> PlayerConfig {
    let config = fs::read_to_string(config_path)
        .ok()
        .and_then(|content| serde_json::from_str::<PlayerConfig>(&content).ok())
        .unwrap_or_default();

    PlayerConfig {
        position_secs: if config.position_secs.is_finite() {
            config.position_secs.max(0.0)
        } else {
            0.0
        },
        volume: if config.volume.is_finite() {
            config.volume.clamp(0.0, 1.0)
        } else {
            0.7
        },
        ..config
    }
}

#[tauri::command]
fn get_player_config(app: tauri::AppHandle) -> Result<PlayerConfig, String> {
    let paths = get_all_paths(&app)?;
    Ok(load_player_config(&paths.config_path))
}

#[tauri::command]
fn save_player_config(
    app: tauri::AppHandle,
    current_track_id: Option<String>,
    position_secs: f64,
    volume: f64,
    is_playing: bool) -> Result<(), String> {
    let paths = get_all_paths(&app)?;
    let config = PlayerConfig {
        current_track_id,
        position_secs: if position_secs.is_finite() {
            position_secs.max(0.0)
        } else {
            0.0
        },
        volume: if volume.is_finite() {
            volume.clamp(0.0, 1.0)
        } else {
            0.7
        },
        is_playing,
    };
    let json = serde_json::to_string_pretty(&config)
        .map_err(|error| format!("Ошибка сериализации config.json: {}", error))?;
    fs::write(&paths.config_path, json)
        .map_err(|error| format!("Ошибка записи config.json: {}", error))
}

#[tauri::command]
fn edit_metadata_track(app: tauri::AppHandle, id: String, title: String, artist: String) -> Result<Track, String> {
    let paths = get_all_paths(&app)?;
    let mut app_data = load_app_data(&paths.library_path);
    let title = title.trim();
    let artist = artist.trim();

    if title.is_empty() {
        return Err("Название трека не может быть пустым".to_string());
    }

    let track = app_data
        .tracks
        .iter_mut()
        .find(|track| track.id == id)
        .ok_or_else(|| "Трек с таким ID не найден".to_string())?;
    let track_path = PathBuf::from(&track.path);
    if !track_path.is_file() {
        return Err("Файл трека не найден".to_string());
    }

    let mut tagged_file = Probe::open(&track_path)
        .map_err(|error| format!("Ошибка открытия трека: {}", error))?
        .read()
        .map_err(|error| format!("Ошибка чтения тегов трека: {}", error))?;

    if tagged_file.primary_tag().is_none() {
        let tag_type = tagged_file.primary_tag_type();
        tagged_file.insert_tag(Tag::new(tag_type));
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
        .map_err(|error| format!("Ошибка сохранения тегов трека: {}", error))?;

    track.title = title.to_string();
    track.artist = if artist.is_empty() {
        None
    } else {
        Some(artist.to_string())
    };

    let updated_track = track.clone();
    save_app_data(&paths.library_path, &app_data)?;

    Ok(updated_track)
}

#[tauri::command]
fn edit_metadata_playlist(app: tauri::AppHandle, id: String, name: String, category: PlaylistCategory) -> Result<Playlist, String> {
    let paths = get_all_paths(&app)?;
    let mut app_data = load_app_data(&paths.library_path);
    let id = id.trim();
    let name = name.trim();

    if name.is_empty() {
        return Err("Название плейлиста не должно быть пустым.".to_string());
    }

    let playlist = app_data
        .playlists
        .iter_mut()
        .find(|playlist| playlist.id == id)
        .ok_or_else(|| "Плейлист с таким ID не найден.".to_string())?;
    playlist.name = name.to_string();
    playlist.category = category;

    let updated_playlist = playlist.clone();
    save_app_data(&paths.library_path, &app_data)?;

    Ok(updated_playlist)
}
