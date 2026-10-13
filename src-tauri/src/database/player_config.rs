use crate::models::PlayerConfig;
use rusqlite::{params, Connection};

pub fn initialize(connection: &Connection) -> Result<(), String> {
    connection
        .execute_batch(
            "CREATE TABLE IF NOT EXISTS player_config (
                 id INTEGER PRIMARY KEY CHECK (id = 1),
                 current_track_id TEXT,
                 position_secs REAL NOT NULL DEFAULT 0,
                 volume REAL NOT NULL DEFAULT 0.7,
                 is_playing INTEGER NOT NULL DEFAULT 0
             );
             INSERT OR IGNORE INTO player_config (id) VALUES (1);",
        )
        .map_err(|error| format!("Не удалось создать таблицу player_config: {error}"))
}

pub fn get(connection: &Connection) -> Result<PlayerConfig, String> {
    connection
        .query_row(
            "SELECT current_track_id, position_secs, volume, is_playing FROM player_config WHERE id = 1",
            [],
            |row| {
                Ok(PlayerConfig {
                    current_track_id: row.get(0)?,
                    position_secs: row.get(1)?,
                    volume: row.get(2)?,
                    is_playing: row.get::<_, bool>(3)?,
                })
            },
        )
        .map(|mut config| {
            config.position_secs = if config.position_secs.is_finite() { config.position_secs.max(0.0) } else { 0.0 };
            config.volume = if config.volume.is_finite() { config.volume.clamp(0.0, 1.0) } else { 0.7 };
            config
        })
        .map_err(|error| format!("Не удалось прочитать настройки плеера: {error}"))
}

pub fn save(connection: &Connection, config: &PlayerConfig) -> Result<(), String> {
    connection
        .execute(
            "UPDATE player_config SET current_track_id = ?1, position_secs = ?2, volume = ?3, is_playing = ?4 WHERE id = 1",
            params![config.current_track_id, config.position_secs, config.volume, config.is_playing],
        )
        .map(|_| ())
        .map_err(|error| format!("Не удалось сохранить настройки плеера: {error}"))
}
