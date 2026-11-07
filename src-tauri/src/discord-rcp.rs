use std::{
    sync::Mutex,
    time::{SystemTime, UNIX_EPOCH},
};

use discord_rich_presence::{activity, DiscordIpc, DiscordIpcClient};
use tauri::State;

const DISCORD_APP_ID: &str = "1568308948858179684";
const PROJECT_URL: &str = "https://github.com/aokigahara11/luminite-music-player";
const MAX_PRESENCE_TEXT_CHARS: usize = 128;

#[derive(Default)]
pub struct DiscordState {
    client: Mutex<Option<DiscordIpcClient>>,
}

#[tauri::command]
pub fn update_discord_presence(
    state: State<'_, DiscordState>,
    track_title: String,
    artist_name: String,
    position_secs: f64,
    duration_secs: f64,
    is_playing: bool,
) -> Result<(), String> {
    if !position_secs.is_finite() || !duration_secs.is_finite() {
        return Err("Время трека должно быть конечным числом".to_string());
    }

    let duration_secs = duration_secs.max(0.0);
    
    let position_secs = if duration_secs > 0.0 {
        position_secs.clamp(0.0, duration_secs)
    } else {
        position_secs.max(0.0)
    };
    
    let artist_name = if artist_name.trim().is_empty() {
        "Неизвестный исполнитель"
    } else {
        artist_name.trim()
    };
    
    let state_text = if is_playing {
        format!("{artist_name}")
    } else {
        format!("{artist_name} | Пауза")
    };

    let mut activity = activity::Activity::new()
        .details(limit_text(&track_title))
        .state(limit_text(&state_text))
        .activity_type(activity::ActivityType::Listening)
        .buttons(vec![activity::Button::new("Слушать в Luminite", PROJECT_URL)]);
    
    
    if is_playing && duration_secs > 0.0 {
        let now_ms = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_err(|error| format!("Не удалось получить системное время: {error}"))?
            .as_millis()
            .min(i64::MAX as u128) as i64;
        let elapsed_ms = (position_secs * 1_000.0).min(i64::MAX as f64) as i64;
        let duration_ms = (duration_secs * 1_000.0).min(i64::MAX as f64) as i64;
        let start_ms = now_ms.saturating_sub(elapsed_ms);

        activity = activity.timestamps(
            activity::Timestamps::new()
                .start(start_ms)
                .end(start_ms.saturating_add(duration_ms)),
        );
    }

    let mut client = state
        .client
        .lock()
        .map_err(|error| format!("Не удалось получить доступ к Discord RPC: {error}"))?;

    if client.is_none() {
        let mut connection = DiscordIpcClient::new(DISCORD_APP_ID);
        connection
            .connect()
            .map_err(|error| format!("Не удалось подключиться к Discord: {error}"))?;
        *client = Some(connection);
    }

    client
        .as_mut()
        .ok_or_else(|| "Клиент Discord RPC недоступен".to_string())?
        .set_activity(activity)
        .map_err(|error| {
            *client = None;
            format!("Не удалось обновить статус Discord: {error}")
        })
}

#[tauri::command]
pub fn clear_discord_presence(state: State<'_, DiscordState>) -> Result<(), String> {
    let mut client = state
        .client
        .lock()
        .map_err(|error| format!("Не удалось получить доступ к Discord RPC: {error}"))?;

    if let Some(connection) = client.as_mut() {
        if let Err(error) = connection.clear_activity() {
            *client = None;
            return Err(format!("Не удалось очистить статус Discord: {error}"));
        }
    }

    Ok(())
}

fn limit_text(value: &str) -> String {
    value.chars().take(MAX_PRESENCE_TEXT_CHARS).collect()
}
