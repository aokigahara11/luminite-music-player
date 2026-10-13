use rusqlite::{params, Connection};
use serde::Deserialize;
use std::{fs, path::Path};

use crate::models::{Cover, PlayerConfig, Playlist, RecentItem, Track};

#[derive(Deserialize, Default)]
struct LegacyLibrary {
    #[serde(default)]
    tracks: Vec<Track>,
    #[serde(default)]
    playlists: Vec<Playlist>,
}

pub fn initialize(connection: &Connection, app_dir: &Path) -> Result<(), String> {
    connection
        .execute_batch(
            "CREATE TABLE IF NOT EXISTS migrations (
                 version INTEGER PRIMARY KEY NOT NULL,
                 applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
             );",
        )
        .map_err(|error| format!("Не удалось создать таблицу миграций: {error}"))?;

    let already_migrated: bool = connection
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM migrations WHERE version = 1)",
            [],
            |row| row.get(0),
        )
        .map_err(|error| format!("Не удалось проверить миграции: {error}"))?;
    if already_migrated {
        return Ok(());
    }

    let library =
        read_optional::<LegacyLibrary>(&app_dir.join("library.json"))?.unwrap_or_default();
    let covers = read_optional::<Vec<Cover>>(&app_dir.join("covers.json"))?.unwrap_or_default();
    let recent = read_optional::<Vec<RecentItem>>(&app_dir.join("recently_played.json"))?
        .unwrap_or_default();
    let config = read_optional::<PlayerConfig>(&app_dir.join("config.json"))?;

    let transaction = connection
        .unchecked_transaction()
        .map_err(|error| format!("Не удалось начать перенос старых данных: {error}"))?;

    for track in &library.tracks {
        transaction
            .execute(
                "INSERT OR IGNORE INTO tracks (id, path, title, artist, duration) VALUES (?1, ?2, ?3, ?4, ?5)",
                params![track.id, track.path, track.title, track.artist, track.duration],
            )
            .map_err(|error| format!("Не удалось перенести трек '{}': {error}", track.title))?;
    }

    for (playlist_position, playlist) in library.playlists.iter().enumerate() {
        transaction
            .execute(
                "INSERT OR IGNORE INTO playlists (id, name, category, position) VALUES (?1, ?2, ?3, ?4)",
                params![playlist.id, playlist.name, playlist.category.as_str(), playlist_position],
            )
            .map_err(|error| format!("Не удалось перенести плейлист '{}': {error}", playlist.name))?;
        for (track_position, track_id) in playlist.id_tracks.iter().enumerate() {
            transaction
                .execute(
                    "INSERT OR IGNORE INTO playlist_tracks (playlist_id, track_id, position)
                     SELECT ?1, id, ?3 FROM tracks WHERE id = ?2",
                    params![playlist.id, track_id, track_position],
                )
                .map_err(|error| {
                    format!(
                        "Не удалось перенести состав плейлиста '{}': {error}",
                        playlist.name
                    )
                })?;
        }
    }

    for cover in &covers {
        transaction
            .execute(
                "INSERT OR IGNORE INTO covers (id, kind, entity_id, path_file) VALUES (?1, ?2, ?3, ?4)",
                params![cover.id, cover.kind.as_str(), cover.entity_id, cover.path_file],
            )
            .map_err(|error| format!("Не удалось перенести обложку: {error}"))?;
    }

    for (position, item) in recent.iter().take(5).enumerate() {
        transaction
            .execute(
                "INSERT OR IGNORE INTO recent_items (kind, entity_id, position) VALUES (?1, ?2, ?3)",
                params![item.kind.as_str(), item.entity_id, position],
            )
            .map_err(|error| format!("Не удалось перенести историю прослушивания: {error}"))?;
    }

    if let Some(config) = config {
        let position = if config.position_secs.is_finite() {
            config.position_secs.max(0.0)
        } else {
            0.0
        };
        let volume = if config.volume.is_finite() {
            config.volume.clamp(0.0, 1.0)
        } else {
            0.7
        };
        transaction
            .execute(
                "UPDATE player_config SET current_track_id = ?1, position_secs = ?2, volume = ?3, is_playing = ?4 WHERE id = 1",
                params![config.current_track_id, position, volume, config.is_playing],
            )
            .map_err(|error| format!("Не удалось перенести настройки плеера: {error}"))?;
    }

    transaction
        .execute("INSERT INTO migrations (version) VALUES (1)", [])
        .map_err(|error| format!("Не удалось отметить перенос старых данных: {error}"))?;
    transaction
        .commit()
        .map_err(|error| format!("Не удалось завершить перенос старых данных: {error}"))
}

fn read_optional<T: for<'de> Deserialize<'de>>(path: &Path) -> Result<Option<T>, String> {
    if !path.exists() {
        return Ok(None);
    }
    let content = fs::read_to_string(path).map_err(|error| {
        format!(
            "Не удалось прочитать старый файл {}: {error}",
            path.display()
        )
    })?;
    serde_json::from_str(&content)
        .map(Some)
        .map_err(|error| format!("Не удалось перенести данные из {}: {error}", path.display()))
}

#[cfg(test)]
mod tests {
    use super::initialize;
    use rusqlite::Connection;
    use std::{fs, path::PathBuf};
    use uuid::Uuid;

    #[test]
    fn imports_legacy_files_once_and_keeps_them_as_backup() {
        let app_dir: PathBuf =
            std::env::temp_dir().join(format!("music-player-migration-{}", Uuid::new_v4()));
        fs::create_dir_all(&app_dir).unwrap();
        fs::write(
            app_dir.join("library.json"),
            r#"{"tracks":[{"id":"track-1","path":"song.mp3","title":"Song","artist":"Artist","duration":93}],"playlists":[{"id":"list-1","name":"List","category":"Плейлист","id_tracks":["track-1"]}]}"#,
        )
        .unwrap();
        fs::write(app_dir.join("covers.json"), "[]").unwrap();
        fs::write(app_dir.join("recently_played.json"), "[]").unwrap();
        fs::write(
            app_dir.join("config.json"),
            r#"{"current_track_id":"track-1","position_secs":12.5,"volume":0.4,"is_playing":false}"#,
        )
        .unwrap();

        let connection = Connection::open_in_memory().unwrap();
        super::super::tracks::initialize(&connection).unwrap();
        super::super::playlists::initialize(&connection).unwrap();
        super::super::covers::initialize(&connection).unwrap();
        super::super::recently_played::initialize(&connection).unwrap();
        super::super::player_config::initialize(&connection).unwrap();
        initialize(&connection, &app_dir).unwrap();
        initialize(&connection, &app_dir).unwrap();

        let tracks: i64 = connection
            .query_row("SELECT COUNT(*) FROM tracks", [], |row| row.get(0))
            .unwrap();
        let playlist_tracks: i64 = connection
            .query_row("SELECT COUNT(*) FROM playlist_tracks", [], |row| row.get(0))
            .unwrap();
        let position: f64 = connection
            .query_row(
                "SELECT position_secs FROM player_config WHERE id = 1",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(tracks, 1);
        assert_eq!(playlist_tracks, 1);
        assert_eq!(position, 12.5);
        assert!(app_dir.join("library.json").exists());

        fs::remove_dir_all(app_dir).unwrap();
    }
}
