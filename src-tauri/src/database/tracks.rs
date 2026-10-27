use crate::models::Track;
use rusqlite::{params, Connection, OptionalExtension};

pub fn initialize(connection: &Connection) -> Result<(), String> {
    connection
        .execute_batch(
            "CREATE TABLE IF NOT EXISTS tracks (
                 id TEXT PRIMARY KEY NOT NULL,
                 path TEXT NOT NULL,
                 title TEXT NOT NULL,
                 artist TEXT,
                 duration INTEGER NOT NULL,
                 play_count INTEGER NOT NULL DEFAULT 0
             );",
        )
        .map_err(|error| format!("Не удалось создать таблицу tracks: {error}"))?;

    let has_play_count: bool = connection
        .query_row(
            "SELECT EXISTS(
                SELECT 1 FROM pragma_table_info('tracks') WHERE name = 'play_count'
             )",
            [],
            |row| row.get(0),
        )
        .map_err(|error| format!("Не удалось проверить столбцы таблицы tracks: {error}"))?;
    if !has_play_count {
        connection
            .execute(
                "ALTER TABLE tracks ADD COLUMN play_count INTEGER NOT NULL DEFAULT 0",
                [],
            )
            .map_err(|error| format!("Не удалось добавить счётчик прослушиваний: {error}"))?;
    }
    Ok(())
}

pub fn all(connection: &Connection) -> Result<Vec<Track>, String> {
    let mut statement = connection
        .prepare("SELECT id, path, title, artist, duration, play_count FROM tracks ORDER BY rowid")
        .map_err(|error| format!("Не удалось получить треки: {error}"))?;
    let tracks = statement
        .query_map([], |row| {
            Ok(Track {
                id: row.get(0)?,
                path: row.get(1)?,
                title: row.get(2)?,
                artist: row.get(3)?,
                duration: row.get(4)?,
                play_count: row.get(5)?,
            })
        })
        .map_err(|error| format!("Не удалось прочитать треки: {error}"))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| format!("Не удалось прочитать трек: {error}"))?;
    Ok(tracks)
}

pub fn get(connection: &Connection, id: &str) -> Result<Option<Track>, String> {
    connection
        .query_row(
            "SELECT id, path, title, artist, duration, play_count FROM tracks WHERE id = ?1",
            [id],
            |row| {
                Ok(Track {
                    id: row.get(0)?,
                    path: row.get(1)?,
                    title: row.get(2)?,
                    artist: row.get(3)?,
                    duration: row.get(4)?,
                    play_count: row.get(5)?,
                })
            },
        )
        .optional()
        .map_err(|error| format!("Не удалось найти трек: {error}"))
}

pub fn insert(connection: &Connection, track: &Track) -> Result<(), String> {
    connection
        .execute(
            "INSERT INTO tracks (id, path, title, artist, duration) VALUES (?1, ?2, ?3, ?4, ?5)",
            params![
                track.id,
                track.path,
                track.title,
                track.artist,
                track.duration
            ],
        )
        .map(|_| ())
        .map_err(|error| format!("Не удалось сохранить трек: {error}"))
}

pub fn record_play(connection: &Connection, id: &str) -> Result<u32, String> {
    let changed = connection
        .execute(
            "UPDATE tracks SET play_count = play_count + 1 WHERE id = ?1",
            [id],
        )
        .map_err(|error| format!("Не удалось записать прослушивание трека: {error}"))?;
    
    if changed == 0 {
        return Err("Трек с таким ID не найден".to_string());
    }

    connection
        .query_row("SELECT play_count FROM tracks WHERE id = ?1", [id], |row| {
            row.get(0)
        })
        .map_err(|error| format!("Не удалось получить число прослушиваний: {error}"))
}

pub fn update_metadata(
    connection: &Connection,
    id: &str,
    title: &str,
    artist: Option<&str>,
) -> Result<(), String> {
    let changed = connection
        .execute(
            "UPDATE tracks SET title = ?1, artist = ?2 WHERE id = ?3",
            params![title, artist, id],
        )
        .map_err(|error| format!("Не удалось обновить трек: {error}"))?;
    if changed == 0 {
        return Err("Трек с таким ID не найден".to_string());
    }
    Ok(())
}

pub fn delete(connection: &Connection, id: &str) -> Result<(), String> {
    let changed = connection
        .execute("DELETE FROM tracks WHERE id = ?1", [id])
        .map_err(|error| format!("Не удалось удалить трек: {error}"))?;
    if changed == 0 {
        return Err("Трек с таким ID не найден".to_string());
    }
    Ok(())
}

pub fn search(connection: &Connection, query: &str) -> Result<Vec<Track>, String> {
    let normalized = query.trim().to_lowercase();
    if normalized.is_empty() {
        return all(connection);
    }
    all(connection).map(|tracks| {
        tracks
            .into_iter()
            .filter(|track| {
                track.title.to_lowercase().contains(&normalized)
                    || track
                        .artist
                        .as_deref()
                        .unwrap_or_default()
                        .to_lowercase()
                        .contains(&normalized)
            })
            .collect()
    })
}

#[cfg(test)]
mod tests {
    use super::{initialize, record_play};
    use rusqlite::Connection;

    #[test]
    fn adds_play_count_to_existing_tracks_table_and_records_plays() {
        let connection = Connection::open_in_memory().unwrap();
        connection
            .execute_batch(
                "CREATE TABLE tracks (
                    id TEXT PRIMARY KEY NOT NULL,
                    path TEXT NOT NULL,
                    title TEXT NOT NULL,
                    artist TEXT,
                    duration INTEGER NOT NULL
                );
                INSERT INTO tracks (id, path, title, duration)
                VALUES ('track-1', 'song.mp3', 'Song', 120);",
            )
            .unwrap();

        initialize(&connection).unwrap();
        assert_eq!(record_play(&connection, "track-1").unwrap(), 1);
        assert_eq!(record_play(&connection, "track-1").unwrap(), 2);
    }
}
