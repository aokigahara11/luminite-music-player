# luminite-music-player

Лаконичный и быстрый локальный аудиоплеер, созданный с использованием Tauri v2, Rust и TypeScript (Vite).

## Стек технологий

* **Backend:** Rust, Tauri v2
* **Frontend:** TypeScript, HTML5, CSS3 / Vite
* **IPC Communication:** Tauri Command System

## Импорт аудио

В разделе «Импорт» можно загрузить отдельный трек или плейлист с помощью встроенных `yt-dlp` и `ffmpeg`. Подтверждайте загрузку только для материалов, которые вы вправе сохранять. Для релиза должны быть включены sidecar-бинарники, перечисленные в `src-tauri/tauri.conf.json`, с суффиксом целевой платформы.

Загруженные файлы импортируются в медиатеку, а обложки сохраняются вместе с треками и плейлистами. Плейлист из треков одного исполнителя автоматически классифицируется как EP (меньше шести треков) или альбом (шесть и более); подборка с разными исполнителями остаётся плейлистом.

---

## Структура проекта

```text
├── src/                  # Фронтенд (UI, логика плеера, стили)
│   ├── assets/           # Иконки и статические ресурсы интерфейса
│   ├── core/             # Состояние плеера, навигация и константы
│   ├── elements/         # DOM-ссылки по областям интерфейса
│   ├── init/events.ts    # Подключение обработчиков приложения
│   ├── modules/          # library, tracks, playlists, playerbar, sidebar,
│   │                     # downloader, covers, recentlyPlayed, remix,
│   │                     # search и settings
│   ├── utils/            # format.ts и toast.ts
│   ├── main.ts           # Композиция модулей и точка входа
│   ├── elements.ts       # Общий экспорт DOM-ссылок
│   └── styles.css        # Стили приложения
├── src-tauri/            # Бэкенд (Rust)
│   ├── src/
│   │   ├── commands/     # Команды Tauri для IPC: audio, tracks, playlists,
│   │   │                 # covers, downloader, playback, настройки и история
│   │   ├── database/     # SQLite: схема, миграции и запросы по сущностям
│   │   ├── audio.rs     # AudioEngine и обработка/рендеринг аудио
│   │   ├── models.rs    # Модели данных, сериализуемые через Serde
│   │   ├── lib.rs       # Инициализация приложения, состояния и IPC-команд
│   │   └── main.rs      # Точка входа Rust-приложения
│   ├── capabilities/     # Настройки прав и разрешений
│   ├── icons/            # Иконки приложения для сборки
│   ├── Cargo.toml        # Зависимости Rust
│   └── tauri.conf.json   # Конфигурация Tauri
└── package.json          # Зависимости Node.js / Скрипты
```

## Установка

Самый простой и быстрый способ установить Luminite на Windows — скачать готовый инсталлятор из официальных релизов:

* Перейдите на страницу [GitHub Releases](https://github.com/aokigahara11/luminite-music-player/releases).

* В блоке последней версии найдите раздел Assets.

* Скачайте MSI-установщик для вашей системы из раздела Assets.

* Запустите скачанный файл и следуйте инструкциям на экране, чтобы завершить установку.

### Из корня проекта:

```bash
# Запустить приложение в режиме разработки
npm run tauri dev

# Собрать приложение
npm run tauri build

# Проверить Rust-бэкенд
cargo check --manifest-path src-tauri/Cargo.toml

# Проверить форматирование Rust-кода
cargo fmt --manifest-path src-tauri/Cargo.toml -- --check
```
