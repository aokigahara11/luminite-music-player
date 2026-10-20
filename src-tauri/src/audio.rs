use std::{
    fs::File,
    path::PathBuf,
    sync::mpsc::{self, Receiver, Sender, SyncSender},
    thread,
    time::Duration,
};

use rodio::{Decoder, OutputStream, OutputStreamHandle, Sink, Source};
use serde::Serialize;
use tauri::{AppHandle, Emitter, State};

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AudioStatus {
    position_secs: f64,
    duration_secs: f64,
    volume: f64,
    is_playing: bool,
    loaded: bool,
    ended: bool,
}

enum AudioCommand {
    Play {
        path: PathBuf,
        position_secs: f64,
        should_play: bool,
        volume: f64,
        reply: SyncSender<Result<AudioStatus, String>>,
    },
    Pause(SyncSender<Result<AudioStatus, String>>),
    Resume(SyncSender<Result<AudioStatus, String>>),
    Stop(SyncSender<Result<AudioStatus, String>>),
    Seek {
        position_secs: f64,
        reply: SyncSender<Result<AudioStatus, String>>,
    },
    SetVolume {
        volume: f64,
        reply: SyncSender<Result<AudioStatus, String>>,
    },
}

impl AudioCommand {
    // Возвращает канал, через который вызывающая команда получит результат.
    fn reply(&self) -> &SyncSender<Result<AudioStatus, String>> {
        match self {
            Self::Play { reply, .. }
            | Self::Pause(reply)
            | Self::Resume(reply)
            | Self::Stop(reply)
            | Self::Seek { reply, .. }
            | Self::SetVolume { reply, .. } => reply,
        }
    }
}

pub struct AudioEngine {
    sender: Sender<AudioCommand>,
}

impl AudioEngine {
    // Запускает отдельный поток для обработки аудиокоманд.
    pub fn new(app: AppHandle) -> Result<Self, String> {
        let (sender, receiver) = mpsc::channel();
        thread::Builder::new()
            .name("audio-engine".to_string())
            .spawn(move || run_worker(receiver, app))
            .map_err(|error| format!("Не удалось запустить аудиодвижок: {error}"))?;
        Ok(Self { sender })
    }

    // Передаёт команду аудиопотоку и ожидает обновлённое состояние плеера.
    fn request(
        &self,
        create_command: impl FnOnce(SyncSender<Result<AudioStatus, String>>) -> AudioCommand,
    ) -> Result<AudioStatus, String> {
        let (reply, response) = mpsc::sync_channel(1);
        self.sender
            .send(create_command(reply))
            .map_err(|error| format!("Аудиодвижок недоступен: {error}"))?;
        response
            .recv()
            .map_err(|error| format!("Не удалось получить состояние аудио: {error}"))?
    }
}

struct AudioWorker {
    app: AppHandle,
    _output_stream: Option<OutputStream>,
    output_handle: Option<OutputStreamHandle>,
    sink: Option<Sink>,
    track_path: Option<PathBuf>,
    duration_secs: f64,
    volume: f64,
    track_loaded: bool,
    ended_emitted: bool,
    end_when_empty: bool,
}

impl AudioWorker {
    // Собирает текущее состояние аудиопотока для интерфейса.
    fn status(&self, ended: bool) -> AudioStatus {
        let sink = self.sink.as_ref();
        let is_playing = sink.is_some_and(|sink| !sink.is_paused() && !sink.empty());
        let position_secs = sink
            .map(|sink| sink.get_pos().as_secs_f64())
            .unwrap_or_default();

        AudioStatus {
            position_secs: if ended {
                self.duration_secs
            } else if self.duration_secs > 0.0 {
                position_secs.min(self.duration_secs)
            } else {
                position_secs
            },
            duration_secs: self.duration_secs,
            volume: self.volume,
            is_playing,
            loaded: self.track_loaded,
            ended,
        }
    }

    // Выполняет одну команду управления воспроизведением.
    fn process(&mut self, command: AudioCommand) -> Result<AudioStatus, String> {
        match command {
            AudioCommand::Play {
                path,
                position_secs,
                should_play,
                volume,
                ..
            } => self.load_track(path, position_secs, should_play, volume)?,
            AudioCommand::Pause(_) => {
                if let Some(sink) = &self.sink {
                    sink.pause();
                }
                self.end_when_empty = false;
            }
            AudioCommand::Resume(_) => {
                if self.sink.as_ref().is_some_and(Sink::empty) {
                    if let Some(path) = self.track_path.clone() {
                        self.load_track(path, 0.0, true, self.volume)?;
                    }
                } else if let Some(sink) = &self.sink {
                    sink.play();
                    self.end_when_empty = true;
                }
            }
            AudioCommand::Stop(_) => {
                if let Some(sink) = self.sink.take() {
                    sink.stop();
                }
                self.duration_secs = 0.0;
                self.track_loaded = false;
                self.ended_emitted = false;
                self.end_when_empty = false;
                self.track_path = None;
            }
            AudioCommand::Seek { position_secs, .. } => {
                if self.sink.as_ref().is_some_and(Sink::empty) {
                    if let Some(path) = self.track_path.clone() {
                        self.load_track(path, position_secs, false, self.volume)?;
                    }
                } else if let Some(sink) = &self.sink {
                    let requested_position = if position_secs.is_finite() {
                        position_secs.clamp(0.0, 3_155_760_000.0)
                    } else {
                        0.0
                    };
                    let position = if self.duration_secs > 0.0 {
                        requested_position.min(self.duration_secs)
                    } else {
                        requested_position
                    };
                    sink.try_seek(Duration::from_secs_f64(position))
                        .map_err(|error| format!("Не удалось изменить позицию аудио: {error}"))?;
                    self.ended_emitted = false;
                    self.end_when_empty = !sink.is_paused();
                }
            }
            AudioCommand::SetVolume { volume, .. } => {
                self.volume = if volume.is_finite() {
                    volume.clamp(0.0, 1.0)
                } else {
                    self.volume
                };
                if let Some(sink) = &self.sink {
                    sink.set_volume(self.volume as f32);
                }
            }
        }

        Ok(self.status(false))
    }

    // Открывает трек, настраивает устройство и начинает воспроизведение с заданной позиции.
    fn load_track(
        &mut self,
        path: PathBuf,
        position_secs: f64,
        should_play: bool,
        volume: f64,
    ) -> Result<(), String> {
        let file =
            File::open(&path).map_err(|error| format!("Не удалось открыть аудиофайл: {error}"))?;
        let decoder = Decoder::new(file)
            .map_err(|error| format!("Не удалось декодировать аудио: {error}"))?;
        let duration_secs = decoder
            .total_duration()
            .map(|duration| duration.as_secs_f64())
            .unwrap_or_default();
        let volume = if volume.is_finite() {
            volume.clamp(0.0, 1.0)
        } else {
            self.volume
        };

        if self.output_handle.is_none() {
            let (stream, handle) = OutputStream::try_default()
                .map_err(|error| format!("Не удалось открыть аудиоустройство: {error}"))?;
            self._output_stream = Some(stream);
            self.output_handle = Some(handle);
        }

        let output_handle = self
            .output_handle
            .as_ref()
            .ok_or_else(|| "Аудиоустройство не инициализировано".to_string())?;
        let sink = Sink::try_new(output_handle)
            .map_err(|error| format!("Не удалось создать аудиопоток: {error}"))?;
        sink.set_volume(volume as f32);
        sink.append(decoder);

        let position = if position_secs.is_finite() {
            position_secs.clamp(0.0, 3_155_760_000.0)
        } else {
            0.0
        };
        let position = if duration_secs > 0.0 {
            position.min(duration_secs)
        } else {
            position
        };
        if position > 0.0 {
            sink.try_seek(Duration::from_secs_f64(position))
                .map_err(|error| format!("Не удалось изменить позицию аудио: {error}"))?;
        }
        if !should_play {
            sink.pause();
        }
        if let Some(previous_sink) = self.sink.take() {
            previous_sink.stop();
        }
        self.sink = Some(sink);
        self.track_path = Some(path);
        self.duration_secs = duration_secs;
        self.track_loaded = true;
        self.ended_emitted = false;
        self.end_when_empty = should_play;
        self.volume = volume;
        Ok(())
    }

    // Отправляет интерфейсу состояние плеера и однократное уведомление о конце трека.
    fn emit_status(&mut self) {
        let ended = self.track_loaded
            && self.end_when_empty
            && !self.ended_emitted
            && self.sink.as_ref().is_some_and(Sink::empty);
        if ended {
            self.ended_emitted = true;
            self.end_when_empty = false;
        }

        if let Err(error) = self.app.emit("audio-state", self.status(ended)) {
            eprintln!("Не удалось отправить состояние аудио в интерфейс: {error}");
        }
    }
}

// Обрабатывает команды последовательно и периодически отправляет обновления состояния.
fn run_worker(receiver: Receiver<AudioCommand>, app: AppHandle) {
    let mut worker = AudioWorker {
        app,
        _output_stream: None,
        output_handle: None,
        sink: None,
        track_path: None,
        duration_secs: 0.0,
        volume: 0.7,
        track_loaded: false,
        ended_emitted: false,
        end_when_empty: false,
    };

    loop {
        match receiver.recv_timeout(Duration::from_millis(200)) {
            Ok(command) => {
                let reply = command.reply().clone();
                let result = worker.process(command);
                if let Err(error) = &result {
                    eprintln!("Ошибка аудиодвижка: {error}");
                }
                if reply.send(result).is_err() {
                    eprintln!("Интерфейс закрыл запрос к аудиодвижку до получения ответа");
                }
                worker.emit_status();
            }
            Err(mpsc::RecvTimeoutError::Timeout) => worker.emit_status(),
            Err(mpsc::RecvTimeoutError::Disconnected) => break,
        }
    }
}

// Загружает и воспроизводит аудиофайл с указанной позиции и громкостью.
#[tauri::command]
pub fn play_audio(
    engine: State<'_, AudioEngine>,
    path: String,
    position_secs: f64,
    should_play: bool,
    volume: f64,
) -> Result<AudioStatus, String> {
    engine.request(|reply| AudioCommand::Play {
        path: PathBuf::from(path),
        position_secs,
        should_play,
        volume,
        reply,
    })
}

// Приостанавливает текущий трек.
#[tauri::command]
pub fn pause_audio(engine: State<'_, AudioEngine>) -> Result<AudioStatus, String> {
    engine.request(AudioCommand::Pause)
}

// Возобновляет воспроизведение; завершённый трек запускает сначала.
#[tauri::command]
pub fn resume_audio(engine: State<'_, AudioEngine>) -> Result<AudioStatus, String> {
    engine.request(AudioCommand::Resume)
}

// Останавливает воспроизведение и освобождает текущий трек.
#[tauri::command]
pub fn stop_audio(engine: State<'_, AudioEngine>) -> Result<AudioStatus, String> {
    engine.request(AudioCommand::Stop)
}

// Перемещает воспроизведение к указанной позиции в секундах.
#[tauri::command]
pub fn seek_audio(
    engine: State<'_, AudioEngine>,
    position_secs: f64,
) -> Result<AudioStatus, String> {
    engine.request(|reply| AudioCommand::Seek {
        position_secs,
        reply,
    })
}

// Устанавливает громкость в диапазоне от 0.0 до 1.0.
#[tauri::command]
pub fn set_audio_volume(
    engine: State<'_, AudioEngine>,
    volume: f64,
) -> Result<AudioStatus, String> {
    engine.request(|reply| AudioCommand::SetVolume { volume, reply })
}
