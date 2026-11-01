use tauri::State;

use crate::{database::core::Database, database::player_config, models::PlayerConfig};

// Получить конфиг пользователя
#[tauri::command]
pub fn get_player_config(database: State<'_, Database>) -> Result<PlayerConfig, String> {
    let connection = database
        .connection
        .lock()
        .map_err(|_| "Соединение с базой данных недоступно".to_string())?;
    player_config::get(&connection)
}

/// Сохрнаить текущий конфиг пользователя
#[tauri::command]
pub fn save_player_config(
    database: State<'_, Database>,
    current_track_id: Option<String>,
    position_secs: f64,
    volume: f64,
    is_playing: bool,
) -> Result<(), String> {
    // Проверка и нормализация позиции
    let normalized_position = if position_secs.is_finite() {
        position_secs.max(0.0)
    } else {
        0.0
    };

    // Проверка и нормализация громкости
    let normalized_volume = if volume.is_finite() {
        volume.clamp(0.0, 1.0)
    } else {
        0.7
    };

    let config = PlayerConfig {
        current_track_id,
        position_secs: normalized_position,
        volume: normalized_volume,
        is_playing,
    };

    let connection = database
        .connection
        .lock()
        .map_err(|_| "Соединение с базой данных недоступно".to_string())?;

    player_config::save(&connection, &config)
}
