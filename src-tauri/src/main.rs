#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::fs;
use tauri::Manager;
use tauri_plugin_dialog::DialogExt;

fn main() {    
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![pick_files])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[tauri::command]
async fn pick_files(app: tauri::AppHandle) -> Result<Option<String>, String> {
    // Выбрать аудиофайл и скопировать его в папку приложения

    // Получаем папку приложения у пользователя
    let app_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let media_dir = app_dir.join("media");

    // Создаем директорию, если её ещё нет
    fs::create_dir_all(&media_dir).map_err(|e| e.to_string())?;

    // Диалоговое окно выбора файла
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

            let dest_path = media_dir.join(file_name);

            fs::copy(&src_path, &dest_path)
                .map_err(|err| format!("Ошибка копирования: {}", err))?;

            Ok(Some(dest_path.to_string_lossy().to_string()))
        }
        None => Ok(None),
    }
}







