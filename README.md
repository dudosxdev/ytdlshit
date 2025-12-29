# Telegram Downloader Bot

Небольшой Telegram-бот для скачивания видео/аудио из YouTube, Spotify и TikTok. Ниже — краткая навигация по проекту и где что лежит.

## Структура проекта

```
.
├── main.js                # Энтрипоинт приложения
├── package.json           # Скрипты и зависимости
├── db.js                  # Работа с БД (Sequelize модели и хелперы)
├── ytdl.js                # Обёртка загрузки YouTube (основной + fallback)
├── invidious-lib.js       # Фолбек-источник для YouTube
├── env.json               # Конфиг (токен, БД, сертификат, admin id)
├── file_id_cache.json     # Кэш file_id (создаётся/обновляется при работе)
├── user_languages.json    # Кэш языков пользователей (создаётся/обновляется)
└── src/
    ├── bot/
    │   ├── start.js        # Инициализация бота, middleware, запуск
    │   └── handlers/       # Хэндлеры команд, коллбеков, инлайн-запросов
    │       ├── commands.js
    │       ├── callbacks.js
    │       ├── messages.js
    │       ├── inline.js
    │       └── errors.js
    ├── config.js           # Загрузка конфигурации и базовых констант
    ├── i18n/               # Переводы и фабрика переводчика
    │   ├── translations.js
    │   └── translator.js
    ├── services/
    │   ├── downloads/       # Логика скачивания и кеширования
    │   │   ├── youtube.js
    │   │   ├── spotify.js
    │   │   └── tiktok.js
    │   └── inline-media.js  # Редактирование inline-сообщений по file_id
    ├── state/
    │   └── caches.js        # Загрузка/сохранение кэшей
    └── utils/               # Утилиты и форматирование
        ├── formatters.js
        ├── urls.js
        └── video-details.js
```

## Где что менять

- **main.js** — точка входа. Если нужен другой способ запуска — менять здесь.
- **src/bot/start.js** — место, где собирается всё приложение: middleware, хэндлеры, запуск.
- **src/bot/handlers/** — логика команд, сообщений, инлайн-поиска и коллбеков.
- **src/services/downloads/** — основная логика скачивания и кеширования.
- **db.js** — модели и функции работы с БД (Sequelize).
- **src/i18n/** — тексты и переводчик.
- **src/config.js** — загрузка `env.json` и валидация конфигурации.
- **src/state/caches.js** — кэш `file_id` и языков пользователей.

## Запуск

```bash
npm install
npm run start
```

## Конфиг `env.json`

Минимально нужны поля:
- `BOT_TOKEN`
- `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, `DB_NAME`
- `CA_CERT_PATH`
- `BOT_ADMIN_ID`

## Заметки

- Бот работает через **локальный Bot API** (`http://localhost:30010`).
- Кэш `file_id` и языков хранится в `file_id_cache.json` и `user_languages.json`.
