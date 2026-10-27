use crate::models::{Playlist, PlaylistCategory, FAVORITES_PLAYLIST_ID, REMIXES_PLAYLIST_ID};
use rusqlite::{params, Connection, OptionalExtension};

pub fn initialize(connection: &Connection) -> Result<(), String> {
    connection
        .execute_batch(
            "CREATE TABLE IF NOT EXISTS playlists (
                 id TEXT PRIMARY KEY NOT NULL,
                 name TEXT NOT NULL,
                 category TEXT NOT NULL,
                 position INTEGER NOT NULL DEFAULT 0
             );
             CREATE TABLE IF NOT EXISTS playlist_tracks (
                 playlist_id TEXT NOT NULL REFERENCES playlists(id) ON DELETE CASCADE,
                 track_id TEXT NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
                 position INTEGER NOT NULL,
                 PRIMARY KEY (playlist_id, track_id)
             );",
        )
        .map_err(|error| format!("Не удалось создать таблицы playlists: {error}"))
}

pub fn all(connection: &Connection) -> Result<Vec<Playlist>, String> {
    let mut statement = connection
        .prepare("SELECT id, name, category FROM playlists ORDER BY position, rowid")
        .map_err(|error| format!("Не удалось получить плейлисты: {error}"))?;
    let rows = statement
        .query_map([], |row| {
            let category: String = row.get(2)?;
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?, category))
        })
        .map_err(|error| format!("Не удалось прочитать плейлисты: {error}"))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| format!("Не удалось прочитать плейлист: {error}"))?;

    rows.into_iter()
        .map(|(id, name, category)| {
            let category = parse_category(&category);
            let mut track_statement = connection
                .prepare(
                    "SELECT track_id FROM playlist_tracks WHERE playlist_id = ?1 ORDER BY position",
                )
                .map_err(|error| format!("Не удалось получить треки плейлиста: {error}"))?;
            let id_tracks = track_statement
                .query_map([&id], |row| row.get(0))
                .map_err(|error| format!("Не удалось прочитать состав плейлиста: {error}"))?
                .collect::<Result<Vec<String>, _>>()
                .map_err(|error| format!("Не удалось прочитать состав плейлиста: {error}"))?;
            Ok(Playlist {
                id,
                name,
                category,
                id_tracks,
            })
        })
        .collect()
}

pub fn create(connection: &Connection, playlist: &Playlist) -> Result<(), String> {
    let position: i64 = connection
        .query_row(
            "SELECT COALESCE(MAX(position) + 1, 0) FROM playlists",
            [],
            |row| row.get(0),
        )
        .map_err(|error| format!("Не удалось определить порядок плейлистов: {error}"))?;
    connection
        .execute(
            "INSERT INTO playlists (id, name, category, position) VALUES (?1, ?2, ?3, ?4)",
            params![
                playlist.id,
                playlist.name,
                playlist.category.as_str(),
                position
            ],
        )
        .map(|_| ())
        .map_err(|error| format!("Не удалось создать плейлист: {error}"))
}

pub fn ensure_favorites(connection: &Connection) -> Result<(), String> {
    connection
        .execute(
            "INSERT OR IGNORE INTO playlists (id, name, category, position) VALUES (?1, 'Избранное', 'Плейлист', 0)",
            [FAVORITES_PLAYLIST_ID],
        )
        .map(|_| ())
        .map_err(|error| format!("Не удалось создать плейлист «Избранное»: {error}"))
}

pub fn ensure_remixes(connection: &Connection) -> Result<(), String> {
    connection
        .execute(
            "INSERT OR IGNORE INTO playlists (id, name, category, position) VALUES (?1, 'Ремиксы', 'Плейлист', COALESCE((SELECT MAX(position) + 1 FROM playlists), 0))",
            [REMIXES_PLAYLIST_ID],
        )
        .map(|_| ())
        .map_err(|error| format!("Не удалось создать плейлист «Ремиксы»: {error}"))
}

pub fn add_track(connection: &Connection, playlist_id: &str, track_id: &str) -> Result<(), String> {
    let exists: Option<i64> = connection
        .query_row(
            "SELECT 1 FROM playlists WHERE id = ?1",
            [playlist_id],
            |row| row.get(0),
        )
        .optional()
        .map_err(|error| format!("Не удалось проверить плейлист: {error}"))?;
    if exists.is_none() {
        return Err("Плейлист не найден".to_string());
    }
    let position: i64 = connection
        .query_row(
            "SELECT COALESCE(MAX(position) + 1, 0) FROM playlist_tracks WHERE playlist_id = ?1",
            [playlist_id],
            |row| row.get(0),
        )
        .map_err(|error| format!("Не удалось определить порядок треков: {error}"))?;
    connection
        .execute(
            "INSERT OR IGNORE INTO playlist_tracks (playlist_id, track_id, position) VALUES (?1, ?2, ?3)",
            params![playlist_id, track_id, position],
        )
        .map(|_| ())
        .map_err(|error| format!("Не удалось добавить трек в плейлист: {error}"))
}

pub fn remove_track(
    connection: &Connection,
    playlist_id: &str,
    track_id: &str,
) -> Result<(), String> {
    connection
        .execute(
            "DELETE FROM playlist_tracks WHERE playlist_id = ?1 AND track_id = ?2",
            params![playlist_id, track_id],
        )
        .map(|_| ())
        .map_err(|error| format!("Не удалось удалить трек из плейлиста: {error}"))
}

pub fn replace_track(
    connection: &Connection,
    playlist_id: &str,
    track_id: &str,
    replacement_track_id: &str,
) -> Result<(), String> {
    let changed = connection
        .execute(
            "UPDATE playlist_tracks SET track_id = ?1 WHERE playlist_id = ?2 AND track_id = ?3",
            params![replacement_track_id, playlist_id, track_id],
        )
        .map_err(|error| format!("Не удалось заменить трек в плейлисте: {error}"))?;
    if changed == 0 {
        return Err("Трек не найден в плейлисте".to_string());
    }
    Ok(())
}

pub fn delete(connection: &Connection, playlist_id: &str) -> Result<(), String> {
    let changed = connection
        .execute("DELETE FROM playlists WHERE id = ?1", [playlist_id])
        .map_err(|error| format!("Не удалось удалить плейлист: {error}"))?;
    if changed == 0 {
        return Err("Плейлист не найден".to_string());
    }
    Ok(())
}

pub fn update_metadata(
    connection: &Connection,
    id: &str,
    name: &str,
    category: PlaylistCategory,
) -> Result<(), String> {
    let changed = connection
        .execute(
            "UPDATE playlists SET name = ?1, category = ?2 WHERE id = ?3",
            params![name, category.as_str(), id],
        )
        .map_err(|error| format!("Не удалось обновить плейлист: {error}"))?;
    if changed == 0 {
        return Err("Плейлист с таким ID не найден.".to_string());
    }
    Ok(())
}

fn parse_category(category: &str) -> PlaylistCategory {
    match category {
        "EP" => PlaylistCategory::Ep,
        "Альбом" => PlaylistCategory::Album,
        _ => PlaylistCategory::Playlist,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn replace_track_keeps_its_position_and_remixes_playlist_is_persistent() {
        let connection = Connection::open_in_memory().unwrap();
        connection
            .execute_batch(
                "CREATE TABLE tracks (id TEXT PRIMARY KEY NOT NULL);
                 INSERT INTO tracks (id) VALUES ('first'), ('second'), ('third'), ('replacement');",
            )
            .unwrap();
        initialize(&connection).unwrap();

        let playlist = Playlist {
            id: "playlist".to_string(),
            name: "Playlist".to_string(),
            category: PlaylistCategory::Playlist,
            id_tracks: Vec::new(),
        };
        create(&connection, &playlist).unwrap();
        add_track(&connection, &playlist.id, "first").unwrap();
        add_track(&connection, &playlist.id, "second").unwrap();
        add_track(&connection, &playlist.id, "third").unwrap();
        ensure_remixes(&connection).unwrap();
        add_track(&connection, REMIXES_PLAYLIST_ID, "replacement").unwrap();

        replace_track(&connection, &playlist.id, "second", "replacement").unwrap();
        let all_playlists = all(&connection).unwrap();
        assert_eq!(
            all_playlists
                .iter()
                .find(|item| item.id == playlist.id)
                .unwrap()
                .id_tracks,
            ["first", "replacement", "third"]
        );
        assert_eq!(
            all_playlists
                .iter()
                .find(|item| item.id == REMIXES_PLAYLIST_ID)
                .unwrap()
                .id_tracks,
            ["replacement"]
        );
        assert!(replace_track(&connection, &playlist.id, "first", "third").is_err());
    }
}
