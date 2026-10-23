use std::{
    fs::File,
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicU32, Ordering},
        mpsc::{self, Receiver, Sender, SyncSender},
        Arc,
    },
    thread,
    time::{Duration, Instant},
};

use crate::{commands::tracks::import_generated_track, database::core::Database, models::Track};
use rodio::{Decoder, OutputStream, OutputStreamHandle, Sink, Source};
use serde::Serialize;
use tauri::{AppHandle, Emitter, State};
use uuid::Uuid;

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AudioStatus {
    position_secs: f64,
    duration_secs: f64,
    track_path: Option<String>,
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
    SetEqualizer {
        gains: [f32; 6],
        reply: SyncSender<Result<AudioStatus, String>>,
    },
    SetTransitionDuration {
        duration_secs: f64,
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
            | Self::SetVolume { reply, .. }
            | Self::SetEqualizer { reply, .. }
            | Self::SetTransitionDuration { reply, .. } => reply,
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

const EQUALIZER_FREQUENCIES: [f32; 6] = [60.0, 150.0, 400.0, 1_000.0, 2_400.0, 15_000.0];

struct EqualizerSource<S> {
    input: S,
    gains: Arc<[AtomicU32; 6]>,
    filters: Vec<[Biquad; 6]>,
    channel_index: usize,
}

impl<S> EqualizerSource<S>
where
    S: Source<Item = f32>,
{
    fn new(input: S, gains: Arc<[AtomicU32; 6]>) -> Self {
        let channels = input.channels().max(1) as usize;
        Self {
            input,
            gains,
            filters: (0..channels)
                .map(|_| std::array::from_fn(|_| Biquad::default()))
                .collect(),
            channel_index: 0,
        }
    }
}

impl<S> Iterator for EqualizerSource<S>
where
    S: Source<Item = f32>,
{
    type Item = f32;

    fn next(&mut self) -> Option<Self::Item> {
        let mut sample = self.input.next()?;
        let channel = self.channel_index;
        self.channel_index = (self.channel_index + 1) % self.filters.len();
        let sample_rate = self.input.sample_rate() as f32;
        let filters = &mut self.filters[channel];

        for (index, filter) in filters.iter_mut().enumerate() {
            let gain = f32::from_bits(self.gains[index].load(Ordering::Relaxed)).clamp(-12.0, 12.0);
            if filter.gain_db != gain {
                filter.configure(EQUALIZER_FREQUENCIES[index], gain, sample_rate);
            }
            sample = filter.process(sample);
        }
        Some(sample)
    }
}

impl<S> Source for EqualizerSource<S>
where
    S: Source<Item = f32>,
{
    fn current_frame_len(&self) -> Option<usize> {
        self.input.current_frame_len()
    }

    fn channels(&self) -> u16 {
        self.input.channels()
    }

    fn sample_rate(&self) -> u32 {
        self.input.sample_rate()
    }

    fn total_duration(&self) -> Option<Duration> {
        self.input.total_duration()
    }

    fn try_seek(&mut self, position: Duration) -> Result<(), rodio::source::SeekError> {
        self.input.try_seek(position)?;
        for filters in &mut self.filters {
            for filter in filters {
                filter.reset();
            }
        }
        self.channel_index = 0;
        Ok(())
    }
}

#[derive(Clone, Copy)]
struct Biquad {
    b0: f32,
    b1: f32,
    b2: f32,
    a1: f32,
    a2: f32,
    x1: f32,
    x2: f32,
    y1: f32,
    y2: f32,
    gain_db: f32,
}

impl Default for Biquad {
    fn default() -> Self {
        Self {
            b0: 1.0,
            b1: 0.0,
            b2: 0.0,
            a1: 0.0,
            a2: 0.0,
            x1: 0.0,
            x2: 0.0,
            y1: 0.0,
            y2: 0.0,
            gain_db: f32::INFINITY,
        }
    }
}

impl Biquad {
    fn configure(&mut self, frequency: f32, gain_db: f32, sample_rate: f32) {
        let frequency = frequency.min(sample_rate * 0.45);
        let omega = 2.0 * std::f32::consts::PI * frequency / sample_rate;
        let alpha = omega.sin() / 2.0;
        let amplitude = 10.0_f32.powf(gain_db / 40.0);
        let a0 = 1.0 + alpha / amplitude;

        self.b0 = (1.0 + alpha * amplitude) / a0;
        self.b1 = (-2.0 * omega.cos()) / a0;
        self.b2 = (1.0 - alpha * amplitude) / a0;
        self.a1 = (-2.0 * omega.cos()) / a0;
        self.a2 = (1.0 - alpha / amplitude) / a0;
        self.gain_db = gain_db;
    }

    fn process(&mut self, input: f32) -> f32 {
        let output = self.b0 * input + self.b1 * self.x1 + self.b2 * self.x2
            - self.a1 * self.y1
            - self.a2 * self.y2;
        self.x2 = self.x1;
        self.x1 = input;
        self.y2 = self.y1;
        self.y1 = output;
        output
    }

    fn reset(&mut self) {
        self.x1 = 0.0;
        self.x2 = 0.0;
        self.y1 = 0.0;
        self.y2 = 0.0;
    }
}

struct AudioWorker {
    app: AppHandle,
    _output_stream: Option<OutputStream>,
    output_handle: Option<OutputStreamHandle>,
    sink: Option<Sink>,
    transition_sink: Option<Sink>,
    transition_started: Option<Instant>,
    transition_duration: f64,
    equalizer_gains: Arc<[AtomicU32; 6]>,
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
            track_path: self
                .track_path
                .as_ref()
                .map(|path| path.to_string_lossy().into_owned()),
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
                self.finish_transition();
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
                self.finish_transition();
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
                self.update_transition();
            }
            AudioCommand::SetEqualizer { gains, .. } => {
                for (stored, gain) in self.equalizer_gains.iter().zip(gains) {
                    stored.store(gain.clamp(-12.0, 12.0).to_bits(), Ordering::Relaxed);
                }
            }
            AudioCommand::SetTransitionDuration { duration_secs, .. } => {
                self.transition_duration = if duration_secs.is_finite() {
                    duration_secs.clamp(0.0, 8.0)
                } else {
                    self.transition_duration
                };
                if self.transition_duration == 0.0 {
                    self.finish_transition();
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
        sink.set_volume(0.0);
        sink.append(EqualizerSource::new(
            decoder.convert_samples::<f32>(),
            Arc::clone(&self.equalizer_gains),
        ));

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
        self.finish_transition();
        if let Some(previous_sink) = self.sink.take() {
            if should_play
                && !previous_sink.is_paused()
                && !previous_sink.empty()
                && self.transition_duration > 0.0
            {
                previous_sink.set_volume(volume as f32);
                sink.set_volume(0.0);
                self.transition_sink = Some(previous_sink);
                self.transition_started = Some(Instant::now());
            } else {
                previous_sink.stop();
                sink.set_volume(volume as f32);
            }
        } else {
            sink.set_volume(volume as f32);
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

    fn update_transition(&mut self) {
        let (Some(started), Some(previous_sink)) =
            (self.transition_started, self.transition_sink.as_ref())
        else {
            return;
        };
        let progress = (started.elapsed().as_secs_f64() / self.transition_duration).clamp(0.0, 1.0);
        previous_sink.set_volume((self.volume * (1.0 - progress)) as f32);
        if let Some(sink) = &self.sink {
            sink.set_volume((self.volume * progress) as f32);
        }
        if progress >= 1.0 {
            self.finish_transition();
        }
    }

    fn finish_transition(&mut self) {
        if let Some(previous_sink) = self.transition_sink.take() {
            previous_sink.stop();
        }
        self.transition_started = None;
        if let Some(sink) = &self.sink {
            sink.set_volume(self.volume as f32);
        }
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
        transition_sink: None,
        transition_started: None,
        transition_duration: 0.0,
        equalizer_gains: Arc::new(std::array::from_fn(|_| AtomicU32::new(0.0_f32.to_bits()))),
        track_path: None,
        duration_secs: 0.0,
        volume: 0.7,
        track_loaded: false,
        ended_emitted: false,
        end_when_empty: false,
    };
    let mut last_status_emit = Instant::now();

    loop {
        match receiver.recv_timeout(Duration::from_millis(20)) {
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
                last_status_emit = Instant::now();
            }
            Err(mpsc::RecvTimeoutError::Timeout) => {
                worker.update_transition();
                if last_status_emit.elapsed() >= Duration::from_millis(200) {
                    worker.emit_status();
                    last_status_emit = Instant::now();
                }
            }
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

// Устанваливает эквалайзер
#[tauri::command]
pub fn set_equalizer(
    engine: State<'_, AudioEngine>,
    gains: [f32; 6],
) -> Result<AudioStatus, String> {
    if gains.iter().any(|gain| !gain.is_finite()) {
        return Err("Значения эквалайзера должны быть конечными числами".to_string());
    }
    engine.request(|reply| AudioCommand::SetEqualizer { gains, reply })
}

#[tauri::command]
pub fn set_transition_duration(
    engine: State<'_, AudioEngine>,
    duration_secs: f64,
) -> Result<AudioStatus, String> {
    engine.request(|reply| AudioCommand::SetTransitionDuration {
        duration_secs,
        reply,
    })
}

#[cfg(test)]
mod equalizer_tests {
    use super::Biquad;

    #[test]
    fn zero_gain_is_transparent_and_positive_gain_boosts() {
        let mut flat = Biquad::default();
        flat.configure(1_000.0, 0.0, 48_000.0);
        for sample in [-0.5, 0.25, 0.75, -0.125] {
            assert!((flat.process(sample) - sample).abs() < 0.00001);
        }

        let mut boosted = Biquad::default();
        boosted.configure(1_000.0, 6.0, 48_000.0);
        assert!(boosted.process(1.0) > 1.0);
    }
}

pub struct AutoPan<I> {
    input: I,
    sample_rate: u32,
    channels: u16,
    angle: f32,
    rate: f32,
    channel_index: u16,
}

impl<I> AutoPan<I>
where
    I: Source<Item = f32>,
{
    pub fn new(input: I, rate: f32) -> Self {
        let sample_rate = input.sample_rate();
        let channels = input.channels();
        Self {
            input,
            sample_rate,
            channels,
            angle: 0.0,
            rate,
            channel_index: 0,
        }
    }
}

impl<I> Iterator for AutoPan<I>
where
    I: Source<Item = f32>,
{
    type Item = f32;

    fn next(&mut self) -> Option<Self::Item> {
        let sample = self.input.next()?;
        if self.channels == 2 {
            // Обновляем угол один раз за стереофрейм (при обработке левого канала)
            if self.channel_index == 0 {
                self.angle += (2.0 * std::f32::consts::PI * self.rate) / self.sample_rate as f32;
                if self.angle >= 2.0 * std::f32::consts::PI {
                    self.angle -= 2.0 * std::f32::consts::PI;
                }
            }

            // Плавное панорамирование постоянной мощности (Constant-Power Panning)
            let pan_pos = self.angle.sin(); // от -1.0 до 1.0
            let theta = (pan_pos + 1.0) * 0.25 * std::f32::consts::PI;
            let gain = if self.channel_index == 0 {
                theta.cos() * std::f32::consts::SQRT_2
            } else {
                theta.sin() * std::f32::consts::SQRT_2
            };

            self.channel_index = (self.channel_index + 1) % self.channels;
            return Some(sample * gain);
        }
        Some(sample)
    }
}

impl<I> Source for AutoPan<I>
where
    I: Source<Item = f32>,
{
    fn current_frame_len(&self) -> Option<usize> {
        self.input.current_frame_len()
    }

    fn channels(&self) -> u16 {
        self.channels
    }

    fn sample_rate(&self) -> u32 {
        self.sample_rate
    }

    fn total_duration(&self) -> Option<Duration> {
        self.input.total_duration()
    }
}

struct Echo<I> {
    input: I,
    delay_buffer: Vec<f32>,
    buffer_position: usize,
    tail_remaining: usize,
    amplitude: f32,
    sample_rate: u32,
    channels: u16,
}

impl<I> Echo<I>
where
    I: Source<Item = f32>,
{
    fn new(input: I, duration: Duration, amplitude: f32) -> Self {
        let sample_rate = input.sample_rate();
        let channels = input.channels().max(1);
        let frames = (duration.as_secs_f64() * sample_rate as f64) as usize;
        let total_samples = frames * channels as usize;
        Self {
            input,
            delay_buffer: vec![0.0; total_samples.max(channels as usize)],
            buffer_position: 0,
            tail_remaining: total_samples,
            amplitude,
            sample_rate,
            channels,
        }
    }
}

impl<I> Iterator for Echo<I>
where
    I: Source<Item = f32>,
{
    type Item = f32;

    fn next(&mut self) -> Option<Self::Item> {
        let sample = match self.input.next() {
            Some(sample) => {
                self.tail_remaining = self.delay_buffer.len();
                sample
            }
            None if self.tail_remaining > 0 => {
                self.tail_remaining -= 1;
                0.0
            }
            None => return None,
        };

        let delayed = self.delay_buffer[self.buffer_position];
        self.delay_buffer[self.buffer_position] = sample + delayed * self.amplitude;

        Some(sample * 0.75 + delayed * self.amplitude * 0.4)
    }
}

impl<I> Source for Echo<I>
where
    I: Source<Item = f32>,
{
    fn current_frame_len(&self) -> Option<usize> {
        self.input.current_frame_len()
    }

    fn channels(&self) -> u16 {
        self.channels
    }

    fn sample_rate(&self) -> u32 {
        self.sample_rate
    }

    fn total_duration(&self) -> Option<Duration> {
        self.input.total_duration().map(|duration| {
            duration
                + Duration::from_secs_f64(
                    self.delay_buffer.len() as f64
                        / (self.sample_rate as f64 * self.channels as f64),
                )
        })
    }
}

// Рендер ремикса
fn render_remix(
    file_path: &Path,
    track_title: &str,
    output_dir: &Path,
    speed_type: &str,
    effects: &[String],
) -> Result<PathBuf, Box<dyn std::error::Error>> {
    let file = File::open(file_path)?;
    let decoder = Decoder::new(file)?;
    let channels = decoder.channels();
    let mut processed: Box<dyn Source<Item = f32> + Send> =
        Box::new(decoder.convert_samples::<f32>());

    let speed_factor = match speed_type {
        "normal" => 1.0,
        "slowed" => 0.82,
        "speed_up" => 1.25,
        _ => return Err(format!("Неизвестный режим скорости: {speed_type}").into()),
    };

    if speed_factor != 1.0 {
        processed = Box::new(processed.speed(speed_factor));
    }

    let mut has_lofi = false;
    let mut has_reverb = false;
    let mut has_8d = false;

    for effect in effects {
        match effect.as_str() {
            "lofi" => has_lofi = true,
            "reverb" => has_reverb = true,
            "8d" | "8daudio" => has_8d = true,
            _ => return Err(format!("Неизвестный эффект: {effect}").into()),
        }
    }

    if has_lofi {
        processed = Box::new(processed.low_pass(2500));
    }
    if has_reverb {
        processed = Box::new(Echo::new(processed, Duration::from_millis(350), 0.3));
    }
    if has_8d {
        processed = Box::new(AutoPan::new(processed, 0.08));
    }

    std::fs::create_dir_all(output_dir)?;

    let source_name = track_title
        .chars()
        .map(|character| {
            if character.is_control()
                || ['<', '>', ':', '"', '/', '\\', '|', '?', '*'].contains(&character)
            {
                '_'
            } else {
                character
            }
        })
        .collect::<String>();
    let source_name = source_name.trim().trim_matches('.').trim();
    let source_name = if source_name.is_empty() {
        "track"
    } else {
        source_name
    };

    let mut labels = Vec::new();

    match speed_type {
        "slowed" => labels.push("slowed"),
        "speed_up" => labels.push("speed up"),
        _ => {}
    }

    for effect in effects {
        labels.push(match effect.as_str() {
            "8daudio" => "8d",
            other => other,
        });
    }

    if labels.is_empty() {
        labels.push("remix");
    }

    let remix_name = format!("{} ({}).wav", source_name, labels.join(" + "));
    let mut output_path = output_dir.join(&remix_name);
    let mut collision_index = 2;

    while output_path.exists() {
        output_path = output_dir.join(format!(
            "{} ({} - {}).wav",
            source_name,
            labels.join(" + "),
            collision_index
        ));
        collision_index += 1;
    }

    let spec = hound::WavSpec {
        channels,
        sample_rate: processed.sample_rate(),
        bits_per_sample: 32,
        sample_format: hound::SampleFormat::Float,
    };

    let mut writer = hound::WavWriter::create(&output_path, spec)?;

    for sample in processed {
        if let Err(error) = writer.write_sample(sample) {
            drop(writer);
            let _ = std::fs::remove_file(&output_path);
            return Err(error.into());
        }
    }

    if let Err(error) = writer.finalize() {
        let _ = std::fs::remove_file(&output_path);
        return Err(error.into());
    }

    Ok(output_path)
}

// Создание и рендер ремикса
#[tauri::command]
pub fn create_and_render_remix(
    database: State<'_, Database>,
    file_path: String,
    track_title: String,
    track_artist: String,
    speed_type: String,
    effects: Vec<String>,
) -> Result<Track, String> {
    let output_dir = database
        .app_dir
        .join("remix-temp")
        .join(Uuid::new_v4().to_string());
    let remix_path = match render_remix(
        Path::new(&file_path),
        &track_title,
        &output_dir,
        &speed_type,
        &effects,
    ) {
        Ok(path) => path,
        Err(error) => {
            let render_error = format!("Не удалось создать ремикс: {error}");
            if !output_dir.exists() {
                return Err(render_error);
            }
            return match std::fs::remove_dir(&output_dir) {
                Ok(()) => Err(render_error),
                Err(cleanup_error) => Err(format!(
                    "{render_error}. Не удалось удалить временную папку: {cleanup_error}"
                )),
            };
        }
    };

    match import_generated_track(&database, &remix_path, &track_artist) {
        Ok(track) => {
            if let Err(error) = std::fs::remove_dir(&output_dir) {
                eprintln!("Не удалось удалить временную папку ремикса: {error}");
            }
            Ok(track)
        }
        Err(error) => match std::fs::remove_dir(&output_dir) {
            Ok(()) => Err(format!("Не удалось добавить ремикс в медиатеку: {error}")),
            Err(cleanup_error) => Err(format!(
                "Не удалось добавить ремикс в медиатеку: {error}. Также не удалось удалить временную папку: {cleanup_error}"
            )),
        },
    }
}
