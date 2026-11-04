use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_global_shortcut::{
    Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutEvent, ShortcutState,
};

use crate::audio::AudioEngine;

const VOLUME_STEP: f64 = 0.05;

fn register_shortcut(app: &AppHandle, modifiers: Modifiers, code: Code, name: &str) {
    let shortcut = Shortcut::new(Some(modifiers), code);
    if let Err(error) = app.global_shortcut().register(shortcut) {
        eprintln!("Не удалось зарегистрировать глобальное сочетание клавиш {name}: {error}");
    }
}

pub fn register_shortcuts(app: &AppHandle) {
    register_shortcut(app, Modifiers::ALT, Code::Space, "Alt+Space");
    register_shortcut(app, Modifiers::CONTROL, Code::ArrowRight, "Ctrl+Right");
    register_shortcut(app, Modifiers::CONTROL, Code::ArrowLeft, "Ctrl+Left");
    register_shortcut(app, Modifiers::CONTROL, Code::ArrowUp, "Ctrl+Up");
    register_shortcut(app, Modifiers::CONTROL, Code::ArrowDown, "Ctrl+Down");
    // register_shortcut(app, Modifiers::CONTROL, Code::KeyS, "Ctrl+S");
    register_shortcut(app, Modifiers::CONTROL, Code::KeyR, "Ctrl+R");
}

pub fn handle_shortcut_event(app: &AppHandle, shortcut: &Shortcut, event: ShortcutEvent) {
    if event.state() != ShortcutState::Pressed {
        return;
    }

    let action_play_pause = Shortcut::new(Some(Modifiers::ALT), Code::Space);
    let action_next_track = Shortcut::new(Some(Modifiers::CONTROL), Code::ArrowRight);
    let action_prev_track = Shortcut::new(Some(Modifiers::CONTROL), Code::ArrowLeft);
    let action_volume_up = Shortcut::new(Some(Modifiers::CONTROL), Code::ArrowUp);
    let action_volume_down = Shortcut::new(Some(Modifiers::CONTROL), Code::ArrowDown);
    let action_toggle_shuffle = Shortcut::new(Some(Modifiers::CONTROL), Code::KeyS);
    let action_toggle_repeat = Shortcut::new(Some(Modifiers::CONTROL), Code::KeyR);

    if shortcut == &action_volume_up || shortcut == &action_volume_down {
        let delta = if shortcut == &action_volume_up {
            VOLUME_STEP
        } else {
            -VOLUME_STEP
        };

        if let Err(error) = app.state::<AudioEngine>().adjust_volume_by(delta) {
            eprintln!("Не удалось изменить громкость сочетанием клавиш: {error}");
        }
        return;
    }

    let action = if shortcut == &action_play_pause {
        Some("play-pause")
    } else if shortcut == &action_next_track {
        Some("next-track")
    } else if shortcut == &action_prev_track {
        Some("previous-track")
    } else if shortcut == &action_toggle_shuffle {
        Some("toggle-shuffle")
    } else if shortcut == &action_toggle_repeat {
        Some("toggle-repeat")
    } else {
        None
    };

    if let Some(action) = action {
        if let Err(error) = app.emit("player-shortcut-action", action) {
            eprintln!("Не удалось передать действие горячей клавиши в интерфейс: {error}");
        }
    }
}
