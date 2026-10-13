use rusqlite::Connection;
use std::{
    fs,
    path::{Path, PathBuf},
    sync::Mutex,
};

pub struct Database {
    pub connection: Mutex<Connection>,
    pub app_dir: PathBuf,
    pub media_dir: PathBuf,
    pub covers_dir: PathBuf,
    pub database_path: PathBuf,
}

impl Database {
    pub fn open(app_dir: impl AsRef<Path>) -> Result<Self, String> {
        let app_dir = app_dir.as_ref().to_path_buf();
        let media_dir = app_dir.join("media");
        let covers_dir = app_dir.join("covers");
        fs::create_dir_all(&media_dir)
            .map_err(|error| format!("Не удалось создать каталог media: {error}"))?;
        fs::create_dir_all(&covers_dir)
            .map_err(|error| format!("Не удалось создать каталог covers: {error}"))?;

        let database_path = app_dir.join("music-player.sqlite");
        let connection = Connection::open(&database_path)
            .map_err(|error| format!("Не удалось открыть базу данных: {error}"))?;
        connection
            .execute_batch("PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;")
            .map_err(|error| format!("Не удалось настроить соединение с базой данных: {error}"))?;

        Ok(Self {
            connection: Mutex::new(connection),
            app_dir,
            media_dir,
            covers_dir,
            database_path,
        })
    }
}
