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
                 duration INTEGER NOT NULL
             );",
        )
        .map_err(|error| format!("Не удалось создать таблицу tracks: {error}"))
}

pub fn all(connection: &Connection) -> Result<Vec<Track>, String> {
    let mut statement = connection
        .prepare("SELECT id, path, title, artist, duration FROM tracks ORDER BY rowid")
        .map_err(|error| format!("Не удалось получить треки: {error}"))?;
    let tracks = statement
        .query_map([], |row| {
            Ok(Track {
                id: row.get(0)?,
                path: row.get(1)?,
                title: row.get(2)?,
                artist: row.get(3)?,
                duration: row.get(4)?,
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
            "SELECT id, path, title, artist, duration FROM tracks WHERE id = ?1",
            [id],
            |row| {
                Ok(Track {
                    id: row.get(0)?,
                    path: row.get(1)?,
                    title: row.get(2)?,
                    artist: row.get(3)?,
                    duration: row.get(4)?,
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
