pub mod core;
pub mod covers;
pub mod migration;
pub mod player_config;
pub mod playlists;
pub mod recently_played;
pub mod tracks;

use core::Database;
pub fn initialize_schema(database: &Database) -> Result<(), String> {
    let connection = database
        .connection
        .lock()
        .map_err(|_| "Соединение с базой данных недоступно".to_string())?;
    tracks::initialize(&connection)?;
    playlists::initialize(&connection)?;
    covers::initialize(&connection)?;
    recently_played::initialize(&connection)?;
    player_config::initialize(&connection)?;
    migration::initialize(&connection, &database.app_dir)
}
