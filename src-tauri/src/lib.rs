pub mod audio;
pub mod commands;
pub mod database;
pub mod models;

use database::core::Database;
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_shell::init())
        .setup(|app| {
            let app_dir = app.path().app_data_dir()?;
            let database = Database::open(app_dir).map_err(std::io::Error::other)?;
            database::initialize_schema(&database).map_err(std::io::Error::other)?;
            app.manage(database);
            let audio_engine =
                audio::AudioEngine::new(app.handle().clone()).map_err(std::io::Error::other)?;
            app.manage(audio_engine);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::tracks::import_track,
            commands::tracks::get_library,
            commands::tracks::delete_track,
            commands::tracks::search_library,
            commands::tracks::edit_metadata_track,
            commands::playlists::create_playlist,
            commands::playlists::get_playlists,
            commands::playlists::add_track_to_playlist,
            commands::playlists::remove_track_from_playlist,
            commands::playlists::delete_playlist,
            commands::playlists::edit_metadata_playlist,
            commands::covers::get_covers,
            commands::covers::set_cover,
            commands::downloader::download_tracks,
            commands::downloader::cleanup_download,
            commands::recently_played::get_recently_played,
            commands::recently_played::record_recently_played,
            commands::player_config::get_player_config,
            commands::player_config::save_player_config,
            audio::play_audio,
            audio::pause_audio,
            audio::resume_audio,
            audio::stop_audio,
            audio::seek_audio,
            audio::set_audio_volume,
            audio::set_equalizer,
            audio::set_transition_duration,
            crate::audio::create_and_render_remix,
            commands::playback::get_next_track_id,
            commands::playback::get_previous_track_id
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
