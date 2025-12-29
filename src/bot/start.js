import express from 'express';
import pkg from 'grammy';
import { run } from '@grammyjs/runner';
import { limit } from '@grammyjs/ratelimiter';
import { apiThrottler } from '@grammyjs/transformer-throttler';
import { autoRetry } from '@grammyjs/auto-retry';

import { loadConfig } from '../config.js';
import { createCaches } from '../state/caches.js';
import { translations } from '../i18n/translations.js';
import { createTranslator } from '../i18n/translator.js';
import { audioQualityStrings, videoQualityStrings, getQualityDisplay, replyOpts } from '../utils/formatters.js';
import { getSpotifyTrackId, isTikTokUrl } from '../utils/urls.js';
import { getVideoDetailsSafe, getTikTokDetailsSafe } from '../utils/video-details.js';
import { createInlineEditor } from '../services/inline-media.js';
import { createYouTubeDownloads } from '../services/downloads/youtube.js';
import { createSpotifyDownloads } from '../services/downloads/spotify.js';
import { createTikTokDownloads } from '../services/downloads/tiktok.js';
import { registerCommandHandlers } from './handlers/commands.js';
import { registerCallbackHandlers } from './handlers/callbacks.js';
import { registerMessageHandlers } from './handlers/messages.js';
import { registerInlineHandlers } from './handlers/inline.js';
import { registerErrorHandler } from './handlers/errors.js';
import { initializeDatabase, User, Message, Op, sequelize, upsertUser, recordMessage } from '../../db.js';

const { Bot } = pkg;

const DEFAULT_LOCALE = 'en';

const startBot = async () => {
  const { config, constants, paths } = await loadConfig();
  const caches = createCaches({ fileCachePath: paths.cacheFilePath, langCachePath: paths.userLangCachePath });

  const bot = new Bot(constants.botToken, {
    client: { apiRoot: 'http://localhost:30010' },
  });

  let botInfo;

  await caches.fileIdCache.load();
  await caches.userLangCache.load();

  const userLanguages = caches.userLangCache.getCache();

  const { t, botUsernameSuffix } = createTranslator({
    translations,
    userLanguages,
    defaultLocale: DEFAULT_LOCALE,
    getBotUsername: () => botInfo?.username,
  });

  bot.api.config.use(autoRetry());
  bot.api.config.use(apiThrottler());

  bot.use(
    limit({
      timeFrame: 3000,
      limit: 4,
      onLimitExceeded: async (ctx) => {
        if (ctx?.chat?.type === 'private') {
          const lang = userLanguages[ctx?.from?.id] || DEFAULT_LOCALE;
          const text = lang === 'ru' ? '❌ Слишком много запросов, пожалуйста, подождите.' : '❌ Too many requests, please wait.';
          if (ctx.answerCallbackQuery) {
            await ctx.answerCallbackQuery({ text, show_alert: true }).catch(() => {});
          } else if (ctx.reply) {
            await ctx.reply(text, { parse_mode: undefined }).catch(() => {});
          }
        } else if (ctx.inlineQuery) {
          try {
            await ctx
              .answerInlineQuery([], {
                cache_time: 2,
                switch_pm_text: 'Rate limit exceeded, please wait',
                switch_pm_parameter: 'rate_limit',
              })
              .catch(() => {});
          } catch (error) {
            // no-op
          }
        } else {
          console.warn(`⚠️ Rate limit exceeded in chat ${ctx?.chat?.id} by user ${ctx?.from?.id}`);
        }
      },
      keyGenerator: (ctx) => ctx?.from?.id.toString(),
    }),
  );

  bot.use(async (ctx, next) => {
    const updateType = ctx.updateType;
    const updateId = ctx.update.update_id;

    let userId = null;
    let fromObject = null;
    let langCode = DEFAULT_LOCALE;
    let userIdSource = 'N/A';

    try {
      if (ctx.from) {
        fromObject = ctx.from;
        userIdSource = `ctx.from: ${fromObject.id}`;
      } else if (ctx.inlineQuery?.from) {
        fromObject = ctx.inlineQuery.from;
        userIdSource = `ctx.inlineQuery.from: ${fromObject.id}`;
      } else if (ctx.chosenInlineResult?.from) {
        fromObject = ctx.chosenInlineResult.from;
        userIdSource = `ctx.chosenInlineResult.from: ${fromObject.id}`;
      } else if (ctx.callbackQuery?.from) {
        fromObject = ctx.callbackQuery.from;
        userIdSource = `ctx.callbackQuery.from: ${fromObject.id}`;
      } else {
        ctx.lang = DEFAULT_LOCALE;
        ctx.t = (key, data) => t(ctx.lang, key, data);
        ctx.botUsernameSuffix = botUsernameSuffix;
        console.log(`[Middleware] Update ID ${updateId} (${updateType}): Could not determine user. Using default lang.`);
        await next();
        return;
      }

      userId = fromObject.id;
      langCode = userLanguages[userId] || fromObject.language_code || DEFAULT_LOCALE;
      if (!userLanguages[userId] && fromObject.language_code) {
        userLanguages[userId] = fromObject.language_code.split('-')[0];
        langCode = userLanguages[userId];
        await caches.userLangCache.save();
      }
      if (!translations[langCode]) {
        langCode = DEFAULT_LOCALE;
      }

      upsertUser(fromObject, langCode).catch((dbError) => {
        console.error(`[Middleware DB Error] Update ID: ${updateId}, User: ${userId} - Error upserting user:`, dbError);
      });

      ctx.lang = langCode;
      ctx.t = (key, data) => t(ctx.lang, key, data);
      ctx.botUsernameSuffix = botUsernameSuffix;

      await next();
    } catch (error) {
      console.error(`[Middleware CRITICAL ERROR] Update ID: ${updateId}, Type: ${updateType}, User source: ${userIdSource}. Error during middleware processing:`, error);
      if (ctx.reply) {
        await ctx.reply('An internal error occurred in middleware. Please try again later.', { parse_mode: undefined }).catch(() => {});
      }
    }

    if (ctx.message && fromObject && userId) {
      if (!ctx.message.text?.startsWith('/')) {
        await recordMessage(ctx).catch((recordError) =>
          console.error(`[Middleware DB ERROR] Update ID: ${updateId}, User: ${userId} - Error recording message:`, recordError),
        );
      }
    }
  });

  const { editInlineMessageWithFileId } = createInlineEditor({
    userLanguages,
    defaultLocale: DEFAULT_LOCALE,
    botUsernameSuffix,
  });

  const { processYouTubeDownloadAndCache, processYouTubeDownloadRequestNormalWithCache } = createYouTubeDownloads({
    bot,
    getFileIdCache: () => caches.fileIdCache.getCache(),
    saveFileCache: () => caches.fileIdCache.save(),
    botAdminId: constants.botAdminId,
    targetChannelId: constants.targetChannelId,
    botUsernameSuffix,
    replyOpts,
    getVideoDetailsSafe,
    getQualityDisplay,
    editInlineMessageWithFileId,
  });

  const { handleSpotifyDownloadNormal, processSpotifyDownloadAndCache } = createSpotifyDownloads({
    bot,
    getFileIdCache: () => caches.fileIdCache.getCache(),
    saveFileCache: () => caches.fileIdCache.save(),
    botAdminId: constants.botAdminId,
    targetChannelId: constants.targetChannelId,
    botUsernameSuffix,
    replyOpts,
    editInlineMessageWithFileId,
  });

  const { processTikTokDownloadAndCache, processTikTokDownloadRequestNormalWithCache } = createTikTokDownloads({
    bot,
    getFileIdCache: () => caches.fileIdCache.getCache(),
    saveFileCache: () => caches.fileIdCache.save(),
    botAdminId: constants.botAdminId,
    targetChannelId: constants.targetChannelId,
    botUsernameSuffix,
    replyOpts,
    getTikTokDetailsSafe,
    editInlineMessageWithFileId,
  });

  registerCommandHandlers({
    bot,
    botAdminId: constants.botAdminId,
    userLanguages,
    saveLangCache: () => caches.userLangCache.save(),
    upsertUser,
    User,
    Message,
    Op,
    sequelize,
    fileIdCacheStore: caches.fileIdCache,
    t,
    replyOpts,
    botUsernameSuffix,
  });

  registerCallbackHandlers({
    bot,
    audioQualityStrings,
    videoQualityStrings,
    getQualityDisplay,
    processYouTubeDownloadRequestNormalWithCache,
  });

  registerMessageHandlers({
    bot,
    getSpotifyTrackId,
    isTikTokUrl,
    getTikTokDetailsSafe,
    handleSpotifyDownloadNormal,
    processTikTokDownloadRequestNormalWithCache,
    replyOpts,
  });

  registerInlineHandlers({
    bot,
    config,
    inlineSearchLimit: constants.inlineSearchLimit,
    audioQualityStrings,
    videoQualityStrings,
    getQualityDisplay,
    getVideoDetailsSafe,
    getTikTokDetailsSafe,
    getSpotifyTrackId,
    isTikTokUrl,
    fileIdCacheStore: caches.fileIdCache,
    processYouTubeDownloadAndCache,
    processSpotifyDownloadAndCache,
    processTikTokDownloadAndCache,
    editInlineMessageWithFileId,
  });

  registerErrorHandler({
    bot,
    botAdminId: constants.botAdminId,
    userLanguages,
    defaultLocale: DEFAULT_LOCALE,
    t,
    replyOpts,
    botUsernameSuffix,
  });

  let expressServer;

  const shutdown = async (signal) => {
    console.log(`\n🚦 ${signal} received. Initiating graceful shutdown...`);
    let exitCode = signal === 'SIGINT' || signal === 'SIGTERM' ? 0 : 1;
    if (signal === 'EADDRINUSE' || signal === 'STARTUP_FAILURE') exitCode = 1;

    console.log('⏳ Stopping bot runner (will happen on process exit)...');

    const cachePromises = [
      caches.fileIdCache.save().then(() => console.log('💾 File ID Cache saved.')).catch((error) => console.error('⚠️ Error saving File ID Cache:', error)),
      caches.userLangCache.save().then(() => console.log('🗣️ User Language Cache saved.')).catch((error) => console.error('⚠️ Error saving Lang Cache:', error)),
    ];

    const expressClosePromise = new Promise((resolve) => {
      if (expressServer) {
        console.log('🔌 Closing Express server...');
        expressServer.close((error) => {
          if (error) {
            console.error('⚠️ Error closing Express server:', error);
            exitCode = 1;
          } else {
            console.log('🔌 Express server closed.');
          }
          resolve();
        });
      } else {
        resolve();
      }
    });

    const dbClosePromise = new Promise(async (resolve) => {
      try {
        if (sequelize?.close) {
          console.log('🛢️ Closing database connection...');
          await sequelize.close();
          console.log('✅ Database connection closed.');
        }
      } catch (error) {
        console.error('⚠️ Error closing database connection:', error);
        exitCode = 1;
      } finally {
        resolve();
      }
    });

    await Promise.all([...cachePromises, expressClosePromise, dbClosePromise]);

    console.log(`🏁 Shutdown complete. Exiting with code ${exitCode}.`);
    setTimeout(() => {
      console.warn('⏰ Forcing exit after timeout.');
      process.exit(exitCode);
    }, 3000);
    process.exit(exitCode);
  };

  try {
    console.log('🚀 Initializing Database connection and models...');
    await initializeDatabase();

    const app = express();
    app.get('/status', (req, res) => {
      res.status(200).send('ok');
    });
    app.get('/', (req, res) => {
      res.send(`Bot is running. Health check at /status. Admin: ${constants.botAdminId}`);
    });
    expressServer = app.listen(constants.expressPort, () => {
      console.log(`🩺 Health check server listening on port ${constants.expressPort}`);
    });
    expressServer.on('error', (error) => {
      console.error(`❌ Express server error on port ${constants.expressPort}:`, error);
      if (error.code === 'EADDRINUSE') {
        console.error(`Port ${constants.expressPort} is already in use. Shutting down.`);
        shutdown('EADDRINUSE').catch(() => process.exit(1));
      }
    });

    console.log('🔧 Setting bot commands...');
    await bot.api.setMyCommands([
      { command: 'start', description: 'Start the bot / Select language' },
      { command: 'stats', description: 'Show bot usage statistics (Admin)' },
    ]);

    botInfo = await bot.api.getMe();
    console.log(`🤖 Starting bot @${botInfo.username} (ID: ${botInfo.id})...`);

    run(bot);
    console.log('✅ Bot runner started.');
    console.log(`🔑 Admin user ID for /stats: ${constants.botAdminId}`);
    console.log(`📢 Target channel ID for caching: ${constants.targetChannelId}`);
    console.log("✨ Inline mode is enabled. Ensure it's enabled in @BotFather too!");
    console.log(`🔗 Bot link: https://t.me/${botInfo.username}`);
    console.log('🚀 Supported services: YouTube, Spotify, TikTok');
  } catch (error) {
    console.error('❌ FATAL ERROR during bot startup:', error);
    await shutdown('STARTUP_FAILURE').catch(() => process.exit(1));
    process.exit(1);
  }

  process.once('SIGINT', () => shutdown('SIGINT'));
  process.once('SIGTERM', () => shutdown('SIGTERM'));
};

export { startBot };
