use std::{fs, path::Path};

use tauri::State;

use crate::database::core::Database;

/// Удаляет сохранённые данные приложения и очищает каталоги с медиафайлами.
#[tauri::command]
pub fn delete_all_data(database: State<'_, Database>) -> Result<(), String> {
    let connection = database
        .connection
        .lock()
        .map_err(|_| "Соединение с базой данных недоступно".to_string())?;
    let transaction = connection
        .unchecked_transaction()
        .map_err(|error| format!("Не удалось начать удаление данных: {error}"))?;
    transaction
        .execute_batch(
            "DELETE FROM tracks;
             DELETE FROM playlists;
             DELETE FROM covers;
             DELETE FROM recent_items;
             UPDATE player_config SET current_track_id = NULL, position_secs = 0, volume = 0.7, is_playing = 0 WHERE id = 1;",
        )
        .map_err(|error| format!("Не удалось очистить данные приложения: {error}"))?;
    crate::database::playlists::ensure_favorites(&transaction)?;
    crate::database::playlists::ensure_remixes(&transaction)?;
    transaction
        .commit()
        .map_err(|error| format!("Не удалось завершить удаление данных: {error}"))?;
    drop(connection);

    let mut removal_errors = Vec::new();
    remove_directory_contents(&database.media_dir, &mut removal_errors);
    remove_directory_contents(&database.covers_dir, &mut removal_errors);
    for legacy_file in [
        "library.json",
        "covers.json",
        "recently_played.json",
        "config.json",
    ] {
        let path = database.app_dir.join(legacy_file);
        if path.is_file() {
            if let Err(error) = fs::remove_file(&path) {
                removal_errors.push(format!("{}: {error}", path.display()));
            }
        }
    }
    if removal_errors.is_empty() {
        Ok(())
    } else {
        Err(format!(
            "Записи удалены, но некоторые файлы не удалось удалить: {}",
            removal_errors.join("; ")
        ))
    }
}

fn remove_directory_contents(directory: &Path, errors: &mut Vec<String>) {
    let entries = match fs::read_dir(directory) {
        Ok(entries) => entries,
        Err(error) => {
            errors.push(format!("{}: {error}", directory.display()));
            return;
        }
    };

    for entry in entries {
        let entry = match entry {
            Ok(entry) => entry,
            Err(error) => {
                errors.push(format!("{}: {error}", directory.display()));
                continue;
            }
        };
        let path = entry.path();
        let result = match entry.file_type() {
            Ok(file_type) if file_type.is_dir() => fs::remove_dir_all(&path),
            Ok(_) => fs::remove_file(&path),
            Err(error) => {
                errors.push(format!("{}: {error}", path.display()));
                continue;
            }
        };
        if let Err(error) = result {
            errors.push(format!("{}: {error}", path.display()));
        }
    }
}
