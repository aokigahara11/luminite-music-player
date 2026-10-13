#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use lofty::file::{AudioFile, TaggedFileExt};
use lofty::probe::Probe;
use lofty::config::WriteOptions;
use lofty::tag::{Accessor, Tag};
use serde::{Deserialize, Serialize};
use rand::seq::SliceRandom;
use std::{fs, path::Path, path::PathBuf};
use tauri::Manager;
use uuid::Uuid;

const FAVORITES_PLAYLIST_ID: &str = "favorites";

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
            get_recently_played,
            record_recently_played,
            delete_playlist,
            edit_metadata_playlist,
            get_player_config,
            save_player_config,
            edit_metadata_track,
            get_covers,
            set_cover,
            get_next_track_id,
            get_previous_track_id
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

// Рандомный трек
fn random_track_id(track_ids: &[String], current_track_id: Option<&str>) -> Option<String> {
    let candidates = track_ids
        .iter()
        .filter(|track_id| Some(track_id.as_str()) != current_track_id)
        .collect::<Vec<_>>();
    candidates
        .choose(&mut rand::thread_rng())
        .map(|track_id| (*track_id).clone())
}

// Получить id следущего трека
#[tauri::command]
fn get_next_track_id(
    track_ids: Vec<String>,
    current_track_id: Option<String>,
    repeat_mode: String,
    shuffle_enabled: bool,
    natural_end: bool,
) -> Option<String> {
    if track_ids.is_empty() {
        return None;
    }

    if repeat_mode == "one" && natural_end {
        return current_track_id.filter(|id| track_ids.contains(id));
    }

    if shuffle_enabled {
        return random_track_id(&track_ids, current_track_id.as_deref()).or_else(|| {
            (repeat_mode != "off")
                .then(|| current_track_id.filter(|id| track_ids.contains(id)))
                .flatten()
        });
    }

    let Some(current_index) = track_ids
        .iter()
        .position(|id| Some(id) == current_track_id.as_ref())
    else {
        return track_ids.first().cloned();
    };

    let next_index = current_index + 1;
    if next_index < track_ids.len() {
        Some(track_ids[next_index].clone())
    } else if repeat_mode == "all" {
        track_ids.first().cloned()
    } else {
        None
    }
}

// Получить id предыдущего трека
#[tauri::command]
fn get_previous_track_id(
    track_ids: Vec<String>,
    current_track_id: Option<String>,
    shuffle_enabled: bool,
) -> Option<String> {
    if track_ids.is_empty() {
        return None;
    }

    if shuffle_enabled {
        return random_track_id(&track_ids, current_track_id.as_deref());
    }

    let Some(current_index) = track_ids
        .iter()
        .position(|id| Some(id) == current_track_id.as_ref())
    else {
        return track_ids.last().cloned();
    };

    let previous_index = if current_index == 0 {
        track_ids.len() - 1
    } else {
        current_index - 1
    };
    track_ids.get(previous_index).cloned()
}

// Структура с базовыми путями
pub struct AppPaths {
    pub app_dir: PathBuf,
    pub media_dir: PathBuf,
    pub covers_dir: PathBuf,
    pub covers_path: PathBuf,
    pub library_path: PathBuf,
    pub config_path: PathBuf,
    pub recent_path: PathBuf,
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

#[derive(Serialize, Deserialize, Debug, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum CoverKind {
    Track,
    Playlist,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct Cover {
    pub id: String,
    pub kind: CoverKind,
    pub entity_id: String,
    pub path_file: String,
}

#[derive(Serialize, Deserialize, Debug, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
enum RecentItemKind {
    Track,
    Playlist,
}

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, Eq)]
struct RecentItem {
    kind: RecentItemKind,
    entity_id: String,
}

#[derive(Serialize, Debug, Clone)]
#[serde(tag = "source", content = "path", rename_all = "snake_case")]
enum RecentCover {
    Asset(String),
    File(String),
}

#[derive(Serialize, Debug, Clone)]
struct RecentEntry {
    kind: RecentItemKind,
    entity_id: String,
    title: String,
    subtitle: String,
    cover: RecentCover,
}

const RECENT_ITEMS_LIMIT: usize = 5;
const DEFAULT_TRACK_COVER: &str = "./src/assets/media_library.jpg";
const DEFAULT_FAVORITES_COVER: &str = "./src/assets/favorites.jpg";

// Добавить последний прослушанный трек
fn push_recent_item(items: &mut Vec<RecentItem>, item: RecentItem) {
    items.retain(|existing| existing.kind != item.kind || existing.entity_id != item.entity_id);
    items.insert(0, item);
    items.truncate(RECENT_ITEMS_LIMIT);
}

// Загрузить последние прослушанные треки
fn load_recent_items(path: &Path) -> Result<Vec<RecentItem>, String> {
    if !path.exists() {
        save_recent_items(path, &[])?;
        return Ok(Vec::new());
    }

    let contents = fs::read_to_string(path)
        .map_err(|error| format!("Не удалось прочитать recently_played.json: {}", error))?;
    serde_json::from_str(&contents)
        .map_err(|error| format!("Не удалось разобрать recently_played.json: {}", error))
}

// Сохранение последних прослушанных треков
fn save_recent_items(path: &Path, items: &[RecentItem]) -> Result<(), String> {
    let contents = serde_json::to_string_pretty(items)
        .map_err(|error| format!("Не удалось сериализовать историю: {}", error))?;
    fs::write(path, contents)
        .map_err(|error| format!("Не удалось сохранить recently_played.json: {}", error))
}

fn resolve_recent_items(items: &[RecentItem], app_data: &AppData, covers: &[Cover]) -> Vec<RecentEntry> {
    items
        .iter()
        .filter_map(|item| {
            let (title, subtitle, cover_kind, default_cover) = match item.kind {
                RecentItemKind::Track => {
                    let track = app_data.tracks.iter().find(|track| track.id == item.entity_id)?;
                    (
                        track.title.clone(),
                        track.artist.clone().unwrap_or_else(|| "Неизвестный исполнитель".to_string()),
                        CoverKind::Track,
                        DEFAULT_TRACK_COVER,
                    )
                }
                RecentItemKind::Playlist => {
                    let playlist = app_data.playlists.iter().find(|playlist| playlist.id == item.entity_id)?;
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

#[cfg(test)]
mod recent_items_tests {
    use super::{push_recent_item, RecentItem, RecentItemKind, RECENT_ITEMS_LIMIT};

    #[test]
    fn stack_obeys_limit_and_moves_replayed_item_to_front() {
        let mut items = (0..RECENT_ITEMS_LIMIT)
            .map(|index| RecentItem {
                kind: RecentItemKind::Track,
                entity_id: format!("track-{index}"),
            })
            .collect::<Vec<_>>();

        push_recent_item(&mut items, RecentItem {
            kind: RecentItemKind::Playlist,
            entity_id: "playlist-1".to_string(),
        });
        push_recent_item(&mut items, RecentItem {
            kind: RecentItemKind::Track,
            entity_id: "track-0".to_string(),
        });

        assert_eq!(items.len(), RECENT_ITEMS_LIMIT);
        assert_eq!(items[0].entity_id, "track-0");
        assert_eq!(items.iter().filter(|item| item.entity_id == "track-0").count(), 1);
        let oldest_track_id = format!("track-{}", RECENT_ITEMS_LIMIT - 1);
        assert!(!items.iter().any(|item| item.entity_id == oldest_track_id));
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
    fn default() -> Self { // дефолтные настройки конфига
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
    let covers_path = app_dir.join("covers.json");
    let library_path = app_dir.join("library.json");
    let config_path = app_dir.join("config.json");
    let recent_path = app_dir.join("recently_played.json");

    fs::create_dir_all(&media_dir)
        .map_err(|e| format!("Ошибка создания папки media: {}", e))?;

    fs::create_dir_all(&covers_dir)
        .map_err(|e| format!("Ошибка создания папки covers: {}", e))?;

    Ok(AppPaths {
        app_dir,
        media_dir,
        covers_dir,
        covers_path,
        library_path,
        config_path,
        recent_path,
    })
}

// Чтение всей базы данных из JSON
fn load_covers(covers_path: &Path) -> Result<Vec<Cover>, String> {
    if !covers_path.exists() {
        return Ok(Vec::new());
    }

    let content = fs::read_to_string(covers_path)
        .map_err(|error| format!("Ошибка чтения covers.json: {}", error))?;
    serde_json::from_str(&content)
        .map_err(|error| format!("Ошибка чтения данных covers.json: {}", error))
}

fn save_covers(covers_path: &Path, covers: &[Cover]) -> Result<(), String> {
    let content = serde_json::to_string_pretty(covers)
        .map_err(|error| format!("Ошибка сериализации covers.json: {}", error))?;
    fs::write(covers_path, content)
        .map_err(|error| format!("Ошибка записи covers.json: {}", error))
}

// Удаление обложки
fn remove_covers_for_entity(covers_path: &Path, kind: CoverKind, entity_id: &str) -> Result<(), String> {
    let mut covers = load_covers(covers_path)?;
    let removed_paths: Vec<PathBuf> = covers
        .iter()
        .filter(|cover| cover.kind == kind && cover.entity_id == entity_id)
        .map(|cover| PathBuf::from(&cover.path_file))
        .collect();
    covers.retain(|cover| cover.kind != kind || cover.entity_id != entity_id);
    save_covers(covers_path, &covers)?;

    for path in removed_paths {
        let _ = fs::remove_file(path);
    }

    Ok(())
}

// Получить все обложки
#[tauri::command]
fn get_covers(app: tauri::AppHandle) -> Result<Vec<Cover>, String> {
    let paths = get_all_paths(&app)?;
    let covers = load_covers(&paths.covers_path)?;
    if !paths.covers_path.exists() {
        save_covers(&paths.covers_path, &covers)?;
    }
    Ok(covers)
}

// Поставить обложку
#[tauri::command]
fn set_cover(app: tauri::AppHandle, kind: CoverKind, entity_id: String, file_path: String) -> Result<Cover, String> {
    if kind == CoverKind::Playlist && entity_id == FAVORITES_PLAYLIST_ID {
        return Err("Обложку плейлиста «Избранное» нельзя изменить".to_string());
    }
    let paths = get_all_paths(&app)?;
    let app_data = load_app_data(&paths.library_path);
    let entity_exists = match kind {
        CoverKind::Track => app_data.tracks.iter().any(|track| track.id == entity_id),
        CoverKind::Playlist => app_data.playlists.iter().any(|playlist| playlist.id == entity_id),
    };
    if !entity_exists {
        return Err("Объект для обложки не найден".to_string());
    }

    let src_path = PathBuf::from(file_path);
    if !src_path.is_file() {
        return Err("Файл обложки не найден".to_string());
    }

    let extension = src_path
        .extension()
        .and_then(|value| value.to_str())
        .map(|value| value.to_ascii_lowercase())
        .filter(|value| ["jpg", "jpeg", "png", "webp"].contains(&value.as_str()))
        .ok_or_else(|| "Поддерживаются только JPG, PNG и WebP".to_string())?;
    let cover = Cover {
        id: Uuid::new_v4().to_string(),
        kind,
        entity_id: entity_id.clone(),
        path_file: paths
            .covers_dir
            .join(format!("{}.{}", Uuid::new_v4(), extension))
            .to_string_lossy()
            .to_string(),
    };
    let dest_path = PathBuf::from(&cover.path_file);
    fs::copy(&src_path, &dest_path)
        .map_err(|error| format!("Ошибка копирования обложки: {}", error))?;

    let mut covers = match load_covers(&paths.covers_path) {
        Ok(covers) => covers,
        Err(error) => {
            let _ = fs::remove_file(&dest_path);
            return Err(error);
        }
    };
    let old_paths: Vec<PathBuf> = covers
        .iter()
        .filter(|item| item.kind == kind && item.entity_id == entity_id)
        .map(|item| PathBuf::from(&item.path_file))
        .collect();
    covers.retain(|item| item.kind != kind || item.entity_id != entity_id);
    covers.push(cover.clone());

    if let Err(error) = save_covers(&paths.covers_path, &covers) {
        let _ = fs::remove_file(&dest_path);
        return Err(error);
    }

    for old_path in old_paths {
        let _ = fs::remove_file(old_path);
    }

    Ok(cover)
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
    remove_covers_for_entity(&paths.covers_path, CoverKind::Track, &track_id)?;
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
    let mut app_data = load_app_data(&paths.library_path);
    if !app_data.playlists.iter().any(|playlist| playlist.id == FAVORITES_PLAYLIST_ID) {
        app_data.playlists.push(Playlist {
            id: FAVORITES_PLAYLIST_ID.to_string(),
            name: "Избранное".to_string(),
            category: PlaylistCategory::Playlist,
            id_tracks: Vec::new(),
        });
        save_app_data(&paths.library_path, &app_data)?;
    }
    Ok(app_data.playlists)
}

#[tauri::command]
fn get_recently_played(app: tauri::AppHandle) -> Result<Vec<RecentEntry>, String> {
    let paths = get_all_paths(&app)?;
    let app_data = load_app_data(&paths.library_path);
    let mut items = load_recent_items(&paths.recent_path)?;
    let original_len = items.len();
    items.retain(|item| match item.kind {
        RecentItemKind::Track => app_data.tracks.iter().any(|track| track.id == item.entity_id),
        RecentItemKind::Playlist => app_data.playlists.iter().any(|playlist| playlist.id == item.entity_id),
    });
    items.truncate(RECENT_ITEMS_LIMIT);
    if items.len() != original_len {
        save_recent_items(&paths.recent_path, &items)?;
    }
    let covers = load_covers(&paths.covers_path)?;
    Ok(resolve_recent_items(&items, &app_data, &covers))
}

#[tauri::command]
fn record_recently_played(
    app: tauri::AppHandle,
    kind: RecentItemKind,
    entity_id: String,
) -> Result<Vec<RecentEntry>, String> {
    let paths = get_all_paths(&app)?;
    let app_data = load_app_data(&paths.library_path);
    let entity_exists = match kind {
        RecentItemKind::Track => app_data.tracks.iter().any(|track| track.id == entity_id),
        RecentItemKind::Playlist => app_data.playlists.iter().any(|playlist| playlist.id == entity_id),
    };
    if !entity_exists {
        return Err("Трек или плейлист для истории не найден".to_string());
    }

    let mut items = load_recent_items(&paths.recent_path)?;
    push_recent_item(&mut items, RecentItem { kind, entity_id });
    save_recent_items(&paths.recent_path, &items)?;
    let covers = load_covers(&paths.covers_path)?;
    Ok(resolve_recent_items(&items, &app_data, &covers))
}

// Удалить плейлист
#[tauri::command]
fn delete_playlist(app: tauri::AppHandle, playlist_id: String) -> Result<Vec<Playlist>, String> {
    if playlist_id == FAVORITES_PLAYLIST_ID {
        return Err("Плейлист «Избранное» нельзя удалить".to_string());
    }
    let paths = get_all_paths(&app)?;
    let mut app_data = load_app_data(&paths.library_path);

    app_data.playlists.retain(|p| p.id != playlist_id);
    save_app_data(&paths.library_path, &app_data)?;
    remove_covers_for_entity(&paths.covers_path, CoverKind::Playlist, &playlist_id)?;

    Ok(app_data.playlists)
}

// Загрузка конфига
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

// Получить конфиг пользователя
#[tauri::command]
fn get_player_config(app: tauri::AppHandle) -> Result<PlayerConfig, String> {
    let paths = get_all_paths(&app)?;
    Ok(load_player_config(&paths.config_path))
}

// Сохранить конфиг пользователя
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

// Редактирование метаданных трека
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

// Редактирование метаданных плейлиста
#[tauri::command]
fn edit_metadata_playlist(app: tauri::AppHandle, id: String, name: String, category: PlaylistCategory) -> Result<Playlist, String> {
    if id == FAVORITES_PLAYLIST_ID {
        return Err("Плейлист «Избранное» нельзя переименовать".to_string());
    }
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
