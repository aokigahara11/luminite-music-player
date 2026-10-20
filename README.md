# luminite-music-player

Лаконичный и быстрый локальный аудиоплеер, созданный с использованием Tauri v2, Rust и TypeScript (Vite).

## Стек технологий

* **Backend:** Rust, Tauri v2
* **Frontend:** TypeScript, HTML5, CSS3 / Vite
* **IPC Communication:** Tauri Command System

---

## Структура проекта

```text
├── src/                  # Фронтенд (UI, логика плеера, стили)
│   ├── assets/           # Иконки и статические ресурсы интерфейса
│   ├── main.ts           # Точка входа TypeScript
│   └── styles.css        # Стили приложения
├── src-tauri/            # Бэкенд (Rust)
│   ├── src/
│   │   ├── lib.rs        # Инициализация Tauri и обработка IPC
│   │   └── main.rs       # Точка входа Rust-приложения
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

* Скачайте файл установщика .msi (например, luminite_1.0.0_x64_en-US.msi).

* Запустите скачанный файл и следуйте инструкциям на экране, чтобы завершить установку.

