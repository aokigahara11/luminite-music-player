use std::path::Path;

use tauri::State;
use uuid::Uuid;

use crate::{
    audio::{self, AudioEngine, AudioStatus},
    commands::tracks::import_generated_track,
    database::{core::Database, covers, playlists, tracks},
    models::{Cover, CoverKind, Track, REMIXES_PLAYLIST_ID},
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
    let source_cover = {
        let connection = database
            .connection
            .lock()
            .map_err(|_| "Соединение с базой данных недоступно".to_string())?;
        tracks::all(&connection)?
            .into_iter()
            .find(|track| track.path == file_path)
            .map(|track| {
                covers::get(&connection, CoverKind::Track, &track.id)
                    .map(|cover| cover.map(|cover| cover.path_file).or(track.cover))
            })
            .transpose()?
            .flatten()
    };

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

    let mut track = match import_generated_track(&database, &remix_path, &track_artist) {
        Ok(track) => track,
        Err(error) => return Err(with_output_cleanup(error, &output_dir)),
    };

    if let Err(error) = copy_track_cover(&database, &mut track, source_cover.as_deref()) {
        let cleanup_errors = cleanup_imported_remix(&database, &track);
        let cleanup_details = format_cleanup_errors(cleanup_errors);
        let message = format!("Не удалось сохранить обложку исходного трека: {error}");
        return Err(with_output_cleanup(
            format!("{message}{cleanup_details}"),
            &output_dir,
        ));
    }

    let playlist_result = database
        .connection
        .lock()
        .map_err(|_| "Соединение с базой данных недоступно".to_string())
        .and_then(|connection| {
            playlists::ensure_remixes(&connection)?;
            playlists::add_track(&connection, REMIXES_PLAYLIST_ID, &track.id)
        });

    if let Err(error) = playlist_result {
        let cleanup_details = format_cleanup_errors(cleanup_imported_remix(&database, &track));
        let message = format!("Не удалось сохранить ремикс в плейлисте «Ремиксы»: {error}");
        return Err(with_output_cleanup(
            format!("{message}{cleanup_details}"),
            &output_dir,
        ));
    }

    if let Err(error) = std::fs::remove_dir(&output_dir) {
        eprintln!("Не удалось удалить временную папку ремикса: {error}");
    }
    Ok(track)
}

fn copy_track_cover(
    database: &Database,
    remix: &mut Track,
    source_cover: Option<&str>,
) -> Result<(), String> {
    let Some(source_cover) = source_cover else {
        return Ok(());
    };
    
    let source_path = Path::new(source_cover);
    
    if source_path.is_file() {
        let extension = source_path
            .extension()
            .and_then(|value| value.to_str())
            .filter(|value| ["jpg", "jpeg", "png", "webp"].contains(value))
            .ok_or_else(|| "Формат обложки исходного трека не поддерживается".to_string())?;

        let cover_path = database
            .covers_dir
            .join(format!("{}.{}", Uuid::new_v4(), extension));
        std::fs::copy(source_path, &cover_path)
            .map_err(|error| format!("Не удалось скопировать обложку ремикса: {error}"))?;

        let cover_path = cover_path.to_string_lossy().into_owned();

        let cover = Cover {
            id: Uuid::new_v4().to_string(),
            kind: CoverKind::Track,
            entity_id: remix.id.clone(),
            path_file: cover_path.clone(),
        };

        let result = (|| {
            
            let connection = database
                .connection
                .lock()
                .map_err(|_| "Соединение с базой данных недоступно".to_string())?;
            
            let transaction = connection.unchecked_transaction().map_err(|error| {
                format!("Не удалось начать сохранение обложки ремикса: {error}")
            })?;
            covers::set(&transaction, &cover)?;
            tracks::set_cover(&transaction, &remix.id, Some(&cover_path))?;
            transaction
                .commit()
                .map_err(|error| format!("Не удалось сохранить обложку ремикса: {error}"))
        })();
        
        if let Err(error) = result {
            let _ = std::fs::remove_file(&cover_path);
            return Err(error);
        }
        remix.cover = Some(cover_path);
        return Ok(());
    }

    if !source_cover.starts_with("https://") && !source_cover.starts_with("http://") {
        return Err("Обложка исходного трека больше недоступна".to_string());
    }
    
    let connection = database
        .connection
        .lock()
        .map_err(|_| "Соединение с базой данных недоступно".to_string())?;
    tracks::set_cover(&connection, &remix.id, Some(source_cover))?;
    remix.cover = Some(source_cover.to_string());
    Ok(())
}

fn cleanup_imported_remix(database: &Database, track: &Track) -> Vec<String> {
    let mut errors = Vec::new();
    let cover_paths = match database.connection.lock() {
        Ok(connection) => {
            if let Err(error) = tracks::delete(&connection, &track.id) {
                errors.push(format!("не удалось удалить запись трека: {error}"));
            }
            match covers::remove_entity(&connection, CoverKind::Track, &track.id) {
                Ok(paths) => paths,
                Err(error) => {
                    errors.push(format!("не удалось удалить запись обложки: {error}"));
                    Vec::new()
                }
            }
        }
        Err(_) => {
            errors.push("соединение с базой данных недоступно для очистки".to_string());
            Vec::new()
        }
    };
    for path in std::iter::once(track.path.as_str()).chain(cover_paths.iter().map(String::as_str)) {
        if let Err(error) = std::fs::remove_file(path) {
            if Path::new(path).exists() {
                errors.push(format!("не удалось удалить файл «{path}»: {error}"));
            }
        }
    }
    errors
}

fn format_cleanup_errors(errors: Vec<String>) -> String {
    if errors.is_empty() {
        String::new()
    } else {
        format!(" Ошибки очистки: {}", errors.join("; "))
    }
}

fn with_output_cleanup(message: String, output_dir: &Path) -> String {
    match std::fs::remove_dir(output_dir) {
        Ok(()) => message,
        Err(_) if !output_dir.exists() => message,
        Err(error) => format!("{message}. Не удалось удалить временную папку: {error}"),
    }
}
