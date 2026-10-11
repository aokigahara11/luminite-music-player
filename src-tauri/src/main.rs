#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use lofty::file::{AudioFile, TaggedFileExt};
use lofty::probe::Probe;
use lofty::tag::Accessor;
use serde::{Deserialize, Serialize};
use std::{fs, path::Path, path::PathBuf};
use tauri::Manager;
use tauri_plugin_dialog::DialogExt;
use uuid::Uuid;

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            pick_files,
            get_library,
            delete_track,
            search_library,
            create_playlist,
            add_track_to_playlist,
            remove_track_from_playlist,
            get_playlists,
            delete_playlist
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
    pub id_tracks: Vec<String>,
}

// Единая структура корневого JSON файла
#[derive(Serialize, Deserialize, Debug, Clone, Default)]
pub struct AppData {
    pub tracks: Vec<Track>,
    pub playlists: Vec<Playlist>,
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

    fs::create_dir_all(&media_dir)
        .map_err(|e| format!("Ошибка создания папки media: {}", e))?;

    fs::create_dir_all(&covers_dir)
        .map_err(|e| format!("Ошибка создания папки covers: {}", e))?;

    Ok(AppPaths {
        app_dir,
        media_dir,
        covers_dir,
        library_path,
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
        Ok(content) => serde_json::from_str(&content).unwrap_or_default(),
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

// Выбрать аудиофайл и добавить в медиатеку
#[tauri::command]
async fn pick_files(app: tauri::AppHandle) -> Result<Option<Track>, String> {
    let paths = get_all_paths(&app)?;

    let file_path = app
        .dialog()
        .file()
        .set_title("Выберите трек")
        .add_filter("Audio", &["mp3", "wav", "flac"])
        .blocking_pick_file();

    match file_path {
        Some(file_path) => {
            let src_path = file_path.into_path().map_err(|e| e.to_string())?;
            let file_name = src_path
                .file_name()
                .ok_or_else(|| "Не удалось получить имя файла".to_string())?;

            let dest_path = paths.media_dir.join(file_name);

            fs::copy(&src_path, &dest_path)
                .map_err(|err| format!("Ошибка копирования: {}", err))?;

            let track = parse_track_metadata(&dest_path)?;

            let mut app_data = load_app_data(&paths.library_path);
            app_data.tracks.push(track.clone());
            save_app_data(&paths.library_path, &app_data)?;

            Ok(Some(track))
        }
        None => Ok(None),
    }
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
fn create_playlist(app: tauri::AppHandle, name: String) -> Result<Playlist, String> {
    let paths = get_all_paths(&app)?;
    let mut app_data = load_app_data(&paths.library_path);

    let playlist = Playlist {
        id: Uuid::new_v4().to_string(),
        name,
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
