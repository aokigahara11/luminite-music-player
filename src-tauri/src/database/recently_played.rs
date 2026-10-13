use crate::models::{RecentItem, RecentItemKind};
use rusqlite::{params, Connection};

const RECENT_ITEMS_LIMIT: usize = 5;

pub fn initialize(connection: &Connection) -> Result<(), String> {
    connection
        .execute_batch(
            "CREATE TABLE IF NOT EXISTS recent_items (
                 kind TEXT NOT NULL,
                 entity_id TEXT NOT NULL,
                 position INTEGER NOT NULL,
                 PRIMARY KEY (kind, entity_id)
             );",
        )
        .map_err(|error| format!("Не удалось создать таблицу recent_items: {error}"))
}

pub fn all(connection: &Connection) -> Result<Vec<RecentItem>, String> {
    let mut statement = connection
        .prepare("SELECT kind, entity_id FROM recent_items ORDER BY position LIMIT ?1")
        .map_err(|error| format!("Не удалось получить историю: {error}"))?;
    let items = statement
        .query_map([RECENT_ITEMS_LIMIT], |row| {
            let kind: String = row.get(0)?;
            Ok(RecentItem {
                kind: if kind == "track" {
                    RecentItemKind::Track
                } else {
                    RecentItemKind::Playlist
                },
                entity_id: row.get(1)?,
            })
        })
        .map_err(|error| format!("Не удалось прочитать историю: {error}"))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| format!("Не удалось прочитать запись истории: {error}"))?;
    Ok(items)
}

pub fn record(connection: &Connection, item: &RecentItem) -> Result<(), String> {
    let transaction = connection
        .unchecked_transaction()
        .map_err(|error| format!("Не удалось начать транзакцию истории: {error}"))?;
    transaction
        .execute(
            "DELETE FROM recent_items WHERE kind = ?1 AND entity_id = ?2",
            params![item.kind.as_str(), item.entity_id],
        )
        .map_err(|error| format!("Не удалось обновить историю: {error}"))?;
    transaction
        .execute("UPDATE recent_items SET position = position + 1", [])
        .map_err(|error| format!("Не удалось упорядочить историю: {error}"))?;
    transaction
        .execute(
            "INSERT INTO recent_items (kind, entity_id, position) VALUES (?1, ?2, 0)",
            params![item.kind.as_str(), item.entity_id],
        )
        .map_err(|error| format!("Не удалось добавить запись истории: {error}"))?;
    transaction
        .execute(
            "DELETE FROM recent_items WHERE position >= ?1",
            [RECENT_ITEMS_LIMIT],
        )
        .map_err(|error| format!("Не удалось ограничить историю: {error}"))?;
    transaction
        .commit()
        .map_err(|error| format!("Не удалось завершить транзакцию истории: {error}"))
}

pub fn remove_entity(
    connection: &Connection,
    kind: RecentItemKind,
    entity_id: &str,
) -> Result<(), String> {
    connection
        .execute(
            "DELETE FROM recent_items WHERE kind = ?1 AND entity_id = ?2",
            params![kind.as_str(), entity_id],
        )
        .map(|_| ())
        .map_err(|error| format!("Не удалось удалить запись истории: {error}"))
}

#[cfg(test)]
mod tests {
    use super::{all, initialize, record};
    use crate::models::{RecentItem, RecentItemKind};
    use rusqlite::Connection;

    #[test]
    fn recording_moves_item_to_front_and_limits_history() {
        let connection = Connection::open_in_memory().unwrap();
        initialize(&connection).unwrap();
        for index in 0..6 {
            record(
                &connection,
                &RecentItem {
                    kind: RecentItemKind::Track,
                    entity_id: format!("track-{index}"),
                },
            )
            .unwrap();
        }
        record(
            &connection,
            &RecentItem {
                kind: RecentItemKind::Track,
                entity_id: "track-1".to_string(),
            },
        )
        .unwrap();

        let history = all(&connection).unwrap();
        assert_eq!(history.len(), 5);
        assert_eq!(history[0].entity_id, "track-1");
        assert!(!history.iter().any(|item| item.entity_id == "track-0"));
    }
}
