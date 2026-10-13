use crate::models::{Cover, CoverKind};
use rusqlite::{params, Connection, OptionalExtension};

pub fn initialize(connection: &Connection) -> Result<(), String> {
    connection
        .execute_batch(
            "CREATE TABLE IF NOT EXISTS covers (
                 id TEXT PRIMARY KEY NOT NULL,
                 kind TEXT NOT NULL,
                 entity_id TEXT NOT NULL,
                 path_file TEXT NOT NULL,
                 UNIQUE (kind, entity_id)
             );",
        )
        .map_err(|error| format!("Не удалось создать таблицу covers: {error}"))
}

pub fn all(connection: &Connection) -> Result<Vec<Cover>, String> {
    let mut statement = connection
        .prepare("SELECT id, kind, entity_id, path_file FROM covers ORDER BY rowid")
        .map_err(|error| format!("Не удалось получить обложки: {error}"))?;
    let covers = statement
        .query_map([], |row| {
            let kind: String = row.get(1)?;
            Ok(Cover {
                id: row.get(0)?,
                kind: if kind == "track" {
                    CoverKind::Track
                } else {
                    CoverKind::Playlist
                },
                entity_id: row.get(2)?,
                path_file: row.get(3)?,
            })
        })
        .map_err(|error| format!("Не удалось прочитать обложки: {error}"))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| format!("Не удалось прочитать обложку: {error}"))?;
    Ok(covers)
}

pub fn set(connection: &Connection, cover: &Cover) -> Result<Option<String>, String> {
    let old_path = connection
        .query_row(
            "SELECT path_file FROM covers WHERE kind = ?1 AND entity_id = ?2",
            params![cover.kind.as_str(), cover.entity_id],
            |row| row.get(0),
        )
        .optional()
        .map_err(|error| format!("Не удалось получить предыдущую обложку: {error}"))?;
    connection
        .execute(
            "INSERT INTO covers (id, kind, entity_id, path_file) VALUES (?1, ?2, ?3, ?4)
             ON CONFLICT(kind, entity_id) DO UPDATE SET id = excluded.id, path_file = excluded.path_file",
            params![cover.id, cover.kind.as_str(), cover.entity_id, cover.path_file],
        )
        .map_err(|error| format!("Не удалось сохранить обложку: {error}"))?;
    Ok(old_path)
}

pub fn remove_entity(
    connection: &Connection,
    kind: CoverKind,
    entity_id: &str,
) -> Result<Vec<String>, String> {
    let old_paths = connection
        .prepare("SELECT path_file FROM covers WHERE kind = ?1 AND entity_id = ?2")
        .and_then(|mut statement| {
            statement
                .query_map(params![kind.as_str(), entity_id], |row| row.get(0))?
                .collect::<Result<Vec<String>, _>>()
        })
        .map_err(|error| format!("Не удалось получить старые обложки: {error}"))?;
    connection
        .execute(
            "DELETE FROM covers WHERE kind = ?1 AND entity_id = ?2",
            params![kind.as_str(), entity_id],
        )
        .map_err(|error| format!("Не удалось удалить обложку: {error}"))?;
    Ok(old_paths)
}
