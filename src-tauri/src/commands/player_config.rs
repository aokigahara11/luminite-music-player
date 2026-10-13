use tauri::State;

use crate::{database::core::Database, database::player_config, models::PlayerConfig};

#[tauri::command]
pub fn get_player_config(database: State<'_, Database>) -> Result<PlayerConfig, String> {
    let connection = database
        .connection
        .lock()
        .map_err(|_| "Соединение с базой данных недоступно".to_string())?;
    player_config::get(&connection)
}

#[tauri::command]
pub fn save_player_config(
    database: State<'_, Database>,
    current_track_id: Option<String>,
    position_secs: f64,
    volume: f64,
    is_playing: bool,
) -> Result<(), String> {
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
    let connection = database
        .connection
        .lock()
        .map_err(|_| "Соединение с базой данных недоступно".to_string())?;
    player_config::save(&connection, &config)
}
