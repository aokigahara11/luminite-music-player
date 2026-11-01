use std::path::Path;

use tauri::State;
use uuid::Uuid;

use crate::{
    audio::{self, AudioEngine, AudioStatus},
    commands::tracks::import_generated_track,
    database::{core::Database, playlists, tracks},
    models::{Track, REMIXES_PLAYLIST_ID},
};

// Загружает и воспроизводит аудиофайл с указанной позиции и громкостью.
#[tauri::command]
pub fn play_audio(
    engine: State<'_, AudioEngine>,
    path: String,
    position_secs: f64,
    should_play: bool,
    volume: f64,
) -> Result<AudioStatus, String> {
    engine.play(path, position_secs, should_play, volume)
}

// Приостанавливает текущий трек.
#[tauri::command]
pub fn pause_audio(engine: State<'_, AudioEngine>) -> Result<AudioStatus, String> {
    engine.pause()
}

// Возобновляет воспроизведение; завершённый трек запускает сначала.
#[tauri::command]
pub fn resume_audio(engine: State<'_, AudioEngine>) -> Result<AudioStatus, String> {
    engine.resume()
}

// Останавливает воспроизведение и освобождает текущий трек.
#[tauri::command]
pub fn stop_audio(engine: State<'_, AudioEngine>) -> Result<AudioStatus, String> {
    engine.stop()
}

// Перемещает воспроизведение к указанной позиции в секундах.
#[tauri::command]
pub fn seek_audio(
    engine: State<'_, AudioEngine>,
    position_secs: f64,
) -> Result<AudioStatus, String> {
    engine.seek(position_secs)
}

// Устанавливает громкость в диапазоне от 0.0 до 1.0.
#[tauri::command]
pub fn set_audio_volume(
    engine: State<'_, AudioEngine>,
    volume: f64,
) -> Result<AudioStatus, String> {
    engine.set_volume(volume)
}

// Устанавливает значения полос эквалайзера.
#[tauri::command]
pub fn set_equalizer(
    engine: State<'_, AudioEngine>,
    gains: [f32; 6],
) -> Result<AudioStatus, String> {
    engine.set_equalizer(gains)
}

// Устанавливает длительность перехода между треками.
#[tauri::command]
pub fn set_transition_duration(
    engine: State<'_, AudioEngine>,
    duration_secs: f64,
) -> Result<AudioStatus, String> {
    engine.set_transition_duration(duration_secs)
}

// Создаёт ремикс, добавляет его в медиатеку и плейлист «Ремиксы».
#[tauri::command]
pub fn create_and_render_remix(
    database: State<'_, Database>,
    file_path: String,
    track_title: String,
    track_artist: String,
    speed_type: String,
    effects: Vec<String>,
) -> Result<Track, String> {
    let output_dir = database
        .app_dir
        .join("remix-temp")
        .join(Uuid::new_v4().to_string());
    let remix_path = match audio::render_remix(
        Path::new(&file_path),
        &track_title,
        &output_dir,
        &speed_type,
        &effects,
    ) {
        Ok(path) => path,
        Err(error) => {
            let render_error = format!("Не удалось создать ремикс: {error}");
            if !output_dir.exists() {
                return Err(render_error);
            }
            return match std::fs::remove_dir(&output_dir) {
                Ok(()) => Err(render_error),
                Err(cleanup_error) => Err(format!(
                    "{render_error}. Не удалось удалить временную папку: {cleanup_error}"
                )),
            };
        }
    };

    match import_generated_track(&database, &remix_path, &track_artist) {
        Ok(track) => {
            let playlist_result = database
                .connection
                .lock()
                .map_err(|_| "Соединение с базой данных недоступно".to_string())
                .and_then(|connection| {
                    playlists::ensure_remixes(&connection)?;
                    playlists::add_track(&connection, REMIXES_PLAYLIST_ID, &track.id)
                });
            if let Err(error) = playlist_result {
                let mut cleanup_errors = Vec::new();
                match database.connection.lock() {
                    Ok(connection) => {
                        if let Err(cleanup_error) = tracks::delete(&connection, &track.id) {
                            cleanup_errors.push(format!(
                                "не удалось удалить запись трека: {cleanup_error}"
                            ));
                        }
                    }
                    Err(_) => cleanup_errors
                        .push("соединение с базой данных недоступно для очистки".to_string()),
                }
                if let Err(cleanup_error) = std::fs::remove_file(&track.path) {
                    if Path::new(&track.path).exists() {
                        cleanup_errors
                            .push(format!("не удалось удалить файл трека: {cleanup_error}"));
                    }
                }
                let cleanup_details = if cleanup_errors.is_empty() {
                    String::new()
                } else {
                    format!(" Ошибки очистки: {}", cleanup_errors.join("; "))
                };
                return Err(format!(
                    "Не удалось сохранить ремикс в плейлисте «Ремиксы»: {error}.{cleanup_details}"
                ));
            }
            if let Err(error) = std::fs::remove_dir(&output_dir) {
                eprintln!("Не удалось удалить временную папку ремикса: {error}");
            }
            Ok(track)
        }
        Err(error) => match std::fs::remove_dir(&output_dir) {
            Ok(()) => Err(format!("Не удалось добавить ремикс в медиатеку: {error}")),
            Err(cleanup_error) => Err(format!(
                "Не удалось добавить ремикс в медиатеку: {error}. Также не удалось удалить временную папку: {cleanup_error}"
            )),
        },
    }
}
