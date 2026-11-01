use rand::seq::IteratorRandom;

/// Рандомный трек, с условием что он не был предыдущем
fn random_track_id(track_ids: &[String], current_track_id: Option<&str>) -> Option<String> {
    track_ids
        .iter()
        .filter(|track_id| Some(track_id.as_str()) != current_track_id)
        .choose(&mut rand::thread_rng())
        .cloned()
}

/// Получить следующий трек
#[tauri::command]
pub fn get_next_track_id(
    track_ids: Vec<String>,
    current_track_id: Option<String>,
    repeat_mode: String,
    shuffle_enabled: bool,
    natural_end: bool,
) -> Option<String> {
    if track_ids.is_empty() {
        return None;
    }

    // Если включен повтор одного трека
    if repeat_mode == "one" && natural_end {
        return current_track_id.filter(|id| track_ids.contains(id));
    }

    // Если включено перемешивание
    if shuffle_enabled {
        return random_track_id(&track_ids, current_track_id.as_deref()).or_else(|| {
            (repeat_mode != "off")
                .then(|| current_track_id.filter(|id| track_ids.contains(id)))
                .flatten()
        });
    }

    // Поиск текущего трека
    let Some(current_index) = track_ids
        .iter()
        .position(|id| Some(id) == current_track_id.as_ref())
    else {
        return track_ids.first().cloned();
    };

    // Переход к следующему треку
    let next_index = current_index + 1;
    if next_index < track_ids.len() {
        Some(track_ids[next_index].clone())
    } else if repeat_mode == "all" {
        track_ids.first().cloned() // Если это был последний трек, и никаких флагов не было, то возвращаемся к первому треку
    } else {
        None
    }
}

/// Получить предыдущий трек
#[tauri::command]
pub fn get_previous_track_id(
    track_ids: Vec<String>,
    current_track_id: Option<String>,
    shuffle_enabled: bool,
) -> Option<String> {
    if track_ids.is_empty() {
        return None;
    }

    // Если включено перемешивание, то берём рандомный трек
    if shuffle_enabled {
        return random_track_id(&track_ids, current_track_id.as_deref());
    }

    // Поиск текущего трека
    let Some(current_index) = track_ids
        .iter()
        .position(|id| Some(id) == current_track_id.as_ref())
    else {
        return track_ids.last().cloned();
    };

    // Переход к предыдущему индексу
    let previous_index = if current_index == 0 {
        track_ids.len() - 1
    } else {
        current_index - 1
    };

    track_ids.get(previous_index).cloned()
}
