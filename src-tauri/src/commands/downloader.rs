use std::{
    collections::HashMap,
    fs,
    path::{Path, PathBuf},
};

use serde::Serialize;
use serde_json::Value;
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_shell::{process::CommandEvent, ShellExt};
use uuid::Uuid;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadedFile {
    path: String,
    cover_path: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadResult {
    download_id: String,
    collection_title: Option<String>,
    is_collection: bool,
    expected_tracks: usize,
    files: Vec<DownloadedFile>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct DownloadProgress {
    stage: String,
    percentage: Option<f64>,
}

/// Отслеживание скачивание прогресса
fn emit_download_progress(app: &AppHandle, stage: &str, percentage: Option<f64>) {
    let progress = DownloadProgress {
        stage: stage.to_string(),
        percentage,
    };

    if let Err(error) = app.emit("download-progress", progress) {
        eprintln!("Не удалось отправить прогресс загрузки: {error}");
    }
}

/// Процент текущей загрузки
fn download_percentage(line: &str) -> Option<f64> {
    if !line.contains("[download]") {
        return None;
    }

    let before_percent = line.split_once('%')?.0;
    before_percent
        .split_whitespace()
        .last()?
        .parse::<f64>()
        .ok()
}

/// Париснг строки для определения процента и стадии загрузки
fn emit_progress_parsing_line(
    app: &AppHandle,
    current_stage: &mut &'static str,
    line: &str,
) -> bool {
    let percentage = download_percentage(line);

    let stage = if percentage.is_some() {
        Some("downloading")
    } else if line.contains("[ExtractAudio]") || line.contains("[ffmpeg]") {
        Some("converting")
    } else if line.contains("[Metadata]")
        || line.contains("[EmbedThumbnail]")
        || line.contains("[ThumbnailsConvertor]")
        || line.contains("[Fixup")
    {
        Some("finalizing")
    } else {
        None
    };

    if let Some(stage) = stage {
        if *current_stage != stage || percentage.is_some() {
            *current_stage = stage;
            emit_download_progress(app, stage, percentage);
        }
        true
    } else {
        false
    }
}

/// Скачивание трека
#[tauri::command]
pub async fn download_tracks(app: AppHandle, url: String) -> Result<DownloadResult, String> {
    // Иницализация отображения прогресса
    let url = validate_url(&url)?;
    emit_download_progress(&app, "preparing", None);

    let metadata = app
        .shell()
        .sidecar("yt-dlp")
        .map_err(|error| format!("Не удалось найти yt-dlp: {error}"))?
        .args([
            "--dump-single-json",
            "--flat-playlist",
            "--no-warnings",
            "--",
            &url,
        ])
        .output()
        .await
        .map_err(|error| format!("Не удалось получить информацию о ссылке: {error}"))?;

    if !metadata.status.success() {
        return Err(format!(
            "yt-dlp не смог прочитать ссылку: {}",
            String::from_utf8_lossy(&metadata.stderr).trim()
        ));
    }

    let metadata: Value = serde_json::from_slice(&metadata.stdout)
        .map_err(|error| format!("yt-dlp вернул некорректные метаданные: {error}"))?;

    let entries = metadata
        .get("entries")
        .and_then(Value::as_array)
        .map(|entries| entries.iter().filter(|entry| !entry.is_null()).count())
        .unwrap_or(1);

    let mut track_ids = metadata
        .get("entries")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|entry| entry.get("id").and_then(Value::as_str))
        .map(str::to_string)
        .collect::<Vec<_>>();
    if track_ids.is_empty() {
        if let Some(track_id) = metadata.get("id").and_then(Value::as_str) {
            track_ids.push(track_id.to_string());
        }
    }

    let is_collection =
        metadata.get("_type").and_then(Value::as_str) == Some("playlist") || entries > 1;

    let collection_title = is_collection
        .then(|| metadata.get("title").and_then(Value::as_str).map(str::trim))
        .flatten()
        .filter(|title| !title.is_empty())
        .map(str::to_string);

    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("Не удалось определить папку приложения: {error}"))?;

    // Создание изолированной временной папки
    let download_id = Uuid::new_v4();

    let download_dir = app_data_dir.join("downloads").join(download_id.to_string());
    fs::create_dir_all(&download_dir)
        .map_err(|error| format!("Не удалось создать временную папку загрузки: {error}"))?;

    let ffmpeg_path = match find_ffmpeg(&app) {
        Ok(path) => path,
        Err(error) => {
            log_cleanup_error(&download_dir);
            return Err(error);
        }
    };

    let output_template = download_dir.join("%(title).200B [%(id)s].%(ext)s");
    let output_template = output_template.to_string_lossy().into_owned();

    let sidecar = match app.shell().sidecar("yt-dlp") {
        Ok(sidecar) => sidecar,
        Err(error) => {
            log_cleanup_error(&download_dir);
            return Err(format!("Не удалось найти yt-dlp: {error}"));
        }
    };

    // Параметры и запуск процесса скачивания
    let command = sidecar
        .args([
            "--extract-audio",
            "--audio-format",
            "mp3",
            "--audio-quality",
            "0",
            "--embed-metadata",
            "--embed-thumbnail",
            "--write-thumbnail",
            "--convert-thumbnails",
            "jpg",
            "--windows-filenames",
            "--no-overwrites",
            "--newline",
            "--progress",
            "--ffmpeg-location",
        ])
        .arg(ffmpeg_path)
        .args(["-o", &output_template, "--", &url]);

    let (mut events, _child) = match command.spawn() {
        Ok(process) => process,
        Err(error) => {
            log_cleanup_error(&download_dir);
            return Err(format!("Не удалось запустить загрузку: {error}"));
        }
    };

    let mut current_stage = "downloading";
    emit_download_progress(&app, current_stage, None);

    let mut exit_code = None;

    let mut last_error = String::new();

    // Обработка событий
    while let Some(event) = events.recv().await {
        match event {
            CommandEvent::Stdout(bytes) => {
                let line = String::from_utf8_lossy(&bytes).trim().to_string();
                emit_progress_parsing_line(&app, &mut current_stage, &line);
            }
            CommandEvent::Stderr(bytes) => {
                let line = String::from_utf8_lossy(&bytes).trim().to_string();
                if !line.is_empty() && !emit_progress_parsing_line(&app, &mut current_stage, &line)
                {
                    last_error = line;
                }
            }
            CommandEvent::Error(error) => {
                last_error = error;
            }
            CommandEvent::Terminated(payload) => {
                exit_code = payload.code;
                break;
            }
            _ => {}
        }
    }

    if exit_code != Some(0) {
        log_cleanup_error(&download_dir);
        let detail = if last_error.is_empty() {
            "yt-dlp завершился с ошибкой".to_string()
        } else {
            last_error
        };
        return Err(format!("Не удалось загрузить материал: {detail}"));
    }

    emit_download_progress(&app, "finalizing", None);

    // Поиск и сбор скачанных файлов
    let mut output_paths = Vec::new();
    if let Ok(entries) = fs::read_dir(&download_dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_file() {
                if let Some(ext) = path.extension().and_then(|e| e.to_str()) {
                    let ext_lower = ext.to_lowercase();
                    if matches!(
                        ext_lower.as_str(),
                        "mp3" | "m4a" | "opus" | "webm" | "flac" | "wav" | "ogg"
                    ) {
                        output_paths.push(path);
                    }
                }
            }
        }
    }

    sort_download_paths(&mut output_paths, &track_ids);
    output_paths.dedup();

    // Привязка обложек
    let files = output_paths
        .into_iter()
        .map(|path| {
            let cover_path = find_cover(&path).map(|cover| cover.to_string_lossy().into_owned());
            DownloadedFile {
                path: path.to_string_lossy().into_owned(),
                cover_path,
            }
        })
        .collect::<Vec<_>>();

    if files.is_empty() {
        log_cleanup_error(&download_dir);
        return Err("yt-dlp завершился, но аудиофайлы не найдены".to_string());
    }

    Ok(DownloadResult {
        download_id: download_id.to_string(),
        collection_title,
        is_collection,
        expected_tracks: entries,
        files,
    })
}

fn sort_download_paths(output_paths: &mut [PathBuf], track_ids: &[String]) {
    let track_order = track_ids
        .iter()
        .enumerate()
        .map(|(index, track_id)| (track_id.as_str(), index))
        .collect::<HashMap<_, _>>();

    output_paths.sort_by_key(|path| {
        let order = downloaded_track_id(path)
            .and_then(|track_id| track_order.get(track_id).copied())
            .unwrap_or(usize::MAX);
        (order, path.clone())
    });
}

fn downloaded_track_id(path: &Path) -> Option<&str> {
    path.file_stem()?
        .to_str()?
        .rsplit_once(" [")?
        .1
        .strip_suffix(']')
}

/// Очистить временную папку конкретной загрузки по её ID
#[tauri::command]
pub fn cleanup_download(app: AppHandle, download_id: String) -> Result<(), String> {
    let download_id = Uuid::parse_str(&download_id)
        .map_err(|_| "Некорректный идентификатор временной загрузки".to_string())?;
    let download_dir = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("Не удалось определить папку приложения: {error}"))?
        .join("downloads")
        .join(download_id.to_string());
    remove_download_dir(&download_dir)
}

/// Валидация URL
fn validate_url(url: &str) -> Result<String, String> {
    let url = url.trim();

    let Some((scheme, rest)) = url.split_once("://") else {
        return Err("Введите полную ссылку, начинающуюся с https://".to_string());
    };

    let host = rest.split(['/', '?', '#']).next().unwrap_or_default();

    if !matches!(scheme, "https" | "http")
        || host.is_empty()
        || host.starts_with('.')
        || host.ends_with('.')
        || url.chars().any(char::is_whitespace)
        || url.chars().any(char::is_control)
    {
        return Err("Введите корректную ссылку http:// или https://".to_string());
    }
    Ok(url.to_string())
}

/// Обнаружение бинарника ffmpeg
fn find_ffmpeg(app: &AppHandle) -> Result<PathBuf, String> {
    let target_suffix = if cfg!(target_os = "windows") {
        format!("{}-pc-windows-msvc.exe", std::env::consts::ARCH)
    } else if cfg!(target_os = "linux") {
        format!("{}-unknown-linux-gnu", std::env::consts::ARCH)
    } else if cfg!(target_os = "macos") {
        format!("{}-apple-darwin", std::env::consts::ARCH)
    } else {
        return Err("Для этой платформы нет встроенного ffmpeg".to_string());
    };

    let mut directories = Vec::new();

    if let Ok(resource_dir) = app.path().resource_dir() {
        directories.push(resource_dir.clone());
        directories.push(resource_dir.join("binaries"));
    }

    if let Ok(executable) = std::env::current_exe() {
        if let Some(parent) = executable.parent() {
            directories.push(parent.to_path_buf());
            directories.push(parent.join("binaries"));
        }
    }

    if let Ok(current_dir) = std::env::current_dir() {
        directories.push(current_dir.join("src-tauri").join("binaries"));
    }

    let names = [
        format!("ffmpeg-{target_suffix}"),
        format!("ffmpeg-{target_suffix}.exe"),
        if cfg!(target_os = "windows") {
            "ffmpeg.exe".to_string()
        } else {
            "ffmpeg".to_string()
        },
    ];

    directories
        .into_iter()
        .flat_map(|directory| names.iter().map(move |name| directory.join(name)))
        .find(|path| path.is_file())
        .ok_or_else(|| "Не удалось найти встроенный ffmpeg".to_string())
}

/// Нахождение скаченных обложек
fn find_cover(audio_path: &Path) -> Option<PathBuf> {
    ["jpg", "jpeg", "png", "webp"]
        .iter()
        .map(|extension| audio_path.with_extension(extension))
        .find(|path| path.is_file())
}

/// Удаление временной директории для загрузки
fn remove_download_dir(download_dir: &Path) -> Result<(), String> {
    match fs::remove_dir_all(download_dir) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(format!(
            "Не удалось удалить временные файлы загрузки: {error}"
        )),
    }
}

/// Обработка ошибок
fn log_cleanup_error(download_dir: &Path) {
    if let Err(error) = remove_download_dir(download_dir) {
        eprintln!("{error}");
    }
}
