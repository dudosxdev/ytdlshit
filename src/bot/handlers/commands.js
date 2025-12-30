import { InlineKeyboard } from '../gramjs/inline-keyboard.js';

const registerCommandHandlers = ({
  bot,
  botAdminId,
  userLanguages,
  saveLangCache,
  upsertUser,
  User,
  Message,
  Op,
  sequelize,
  fileIdCacheStore,
  t,
  replyOpts,
  botUsernameSuffix,
}) => {
  bot.command('start', async (ctx) => {
    const userId = ctx.from?.id || 'N/A';
    console.log(`[Command /start] User ${userId} used /start. Prompting for language.`);
    const keyboard = new InlineKeyboard().text('English 🇬🇧', 'set_lang:en').text('Русский 🇷🇺', 'set_lang:ru');
    await ctx.reply(t('en', 'language_select'), {
      reply_markup: keyboard,
      parse_mode: undefined,
    });
  });

  bot.command('stats', async (ctx) => {
    const userId = ctx.from?.id;
    if (userId !== botAdminId) {
      console.log(`[Command /stats] Unauthorized attempt by user ${userId}`);
      return ctx.reply('⛔️ Access denied.', { parse_mode: undefined });
    }
    console.log(`[Command /stats] Admin ${userId} requested stats.`);
    if (!User || !Message || !Op || !sequelize) {
      console.error('[Command /stats] Database models or Sequelize not initialized.');
      return ctx.reply('⚠️ Error: Database connection or models not ready.', { parse_mode: undefined });
    }
    try {
      await ctx.replyWithChatAction('typing');
      const now = new Date();
      const oneHourAgo = new Date(now.getTime() - 1 * 60 * 60 * 1000);
      const twentyFourHoursAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
      const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

      const fileIdCache = fileIdCacheStore.getCache();

      const [
        totalUsers,
        activeLast1h,
        activeLast24h,
        activeLast7d,
        activeLast30d,
        totalMessages,
        messagesLast1h,
        messagesLast24h,
        messagesLast7d,
        messagesLast30d,
        usersByLangRaw,
        firstMessageDate,
        lastMessageDate,
      ] = await Promise.all([
        User.count().catch(() => -1),
        User.count({ where: { lastInteractionAt: { [Op.gte]: oneHourAgo } } }).catch(() => -1),
        User.count({ where: { lastInteractionAt: { [Op.gte]: twentyFourHoursAgo } } }).catch(() => -1),
        User.count({ where: { lastInteractionAt: { [Op.gte]: sevenDaysAgo } } }).catch(() => -1),
        User.count({ where: { lastInteractionAt: { [Op.gte]: thirtyDaysAgo } } }).catch(() => -1),
        Message.count().catch(() => -1),
        Message.count({ where: { messageDate: { [Op.gte]: oneHourAgo } } }).catch(() => -1),
        Message.count({ where: { messageDate: { [Op.gte]: twentyFourHoursAgo } } }).catch(() => -1),
        Message.count({ where: { messageDate: { [Op.gte]: sevenDaysAgo } } }).catch(() => -1),
        Message.count({ where: { messageDate: { [Op.gte]: thirtyDaysAgo } } }).catch(() => -1),
        User.findAll({
          attributes: ['languageCode', [sequelize.fn('COUNT', sequelize.col('userId')), 'count']],
          group: ['languageCode'],
          raw: true,
          order: [[sequelize.fn('COUNT', sequelize.col('userId')), 'DESC']],
        }).catch(() => []),
        Message.min('messageDate').catch(() => null),
        Message.max('messageDate').catch(() => null),
      ]);

      const formatCount = (count) => (count === -1 ? 'Error' : count);
      const formatDate = (date) => (date ? date.toLocaleString('en-GB', { timeZone: 'UTC' }) + ' UTC' : 'N/A');

      let langStats = 'Not available or error fetching';
      if (usersByLangRaw && usersByLangRaw.length > 0) {
        langStats = usersByLangRaw
          .map((item) => `  - ${item.languageCode || 'Unknown'}: ${item.count}`)
          .join('\n');
      } else if (!usersByLangRaw) {
        langStats = 'Error fetching language stats';
      } else {
        langStats = 'No users found with language preference.';
      }

      const statsMessage = `<b>📊 Bot Statistics</b>\n\n` +
        `<b>👤 Users (DB):</b>\n` +
        `  - Total Unique: ${formatCount(totalUsers)}\n` +
        `  - Active (Last 1h): ${formatCount(activeLast1h)}\n` +
        `  - Active (Last 24h): ${formatCount(activeLast24h)}\n` +
        `  - Active (Last 7d): ${formatCount(activeLast7d)}\n` +
        `  - Active (Last 30d): ${formatCount(activeLast30d)}\n\n` +
        `<b>💬 Messages (Links Processed):</b>\n` +
        `  - Total Recorded: ${formatCount(totalMessages)}\n` +
        `  - Last 1h: ${formatCount(messagesLast1h)}\n` +
        `  - Last 24h: ${formatCount(messagesLast24h)}\n` +
        `  - Last 7d: ${formatCount(messagesLast7d)}\n` +
        `  - Last 30d: ${formatCount(messagesLast30d)}\n\n` +
        `<b>🌐 Users by Language (DB):</b>\n${langStats}\n\n` +
        `<b>🗄️ Cache:</b>\n` +
        `  - File IDs: ${Object.keys(fileIdCache).length}\n` +
        `  - User Languages: ${Object.keys(userLanguages).length}\n\n` +
        `<b>🕰️ Message Timeline:</b>\n` +
        `  - First Recorded: ${formatDate(firstMessageDate)}\n` +
        `  - Last Recorded: ${formatDate(lastMessageDate)}`;

      await ctx.reply(statsMessage, replyOpts());
      console.log(`[Command /stats] Stats sent to admin ${userId}.`);
    } catch (error) {
      console.error('[Command /stats] Error fetching statistics:', error);
      await ctx.reply('⚠️ An error occurred while fetching statistics.', { parse_mode: undefined });
    }
  });

  bot.callbackQuery(/^set_lang:(en|ru)$/, async (ctx) => {
    const langCode = ctx.match[1];
    const userId = ctx.from.id;
    console.log(`[Callback set_lang] User ${userId} selected language: ${langCode}`);
    userLanguages[userId] = langCode;
    ctx.lang = langCode;
    await saveLangCache();

    upsertUser(ctx.from, langCode).catch((dbError) => {
      console.error(`[Callback set_lang] Failed to update language preference in DB for user ${userId}:`, dbError);
    });

    try {
      await ctx.answerCallbackQuery({ text: `Language set to ${langCode === 'en' ? 'English' : 'Русский'}` });
      await ctx.editMessageText(ctx.t('welcome') + botUsernameSuffix(), {
        ...replyOpts(),
        reply_markup: undefined,
      });
    } catch (error) {
      if (!error.description?.includes('modified') && !error.description?.includes('not found')) {
        console.error(`[Callback set_lang] Error processing language change confirmation for ${userId}:`, error);
        await ctx.answerCallbackQuery({ text: 'Error setting language', show_alert: true }).catch(() => {});
      } else {
        await ctx
          .answerCallbackQuery({ text: `Language set to ${langCode === 'en' ? 'English' : 'Русский'}` })
          .catch(() => {});
      }
    }
  });
};

export { registerCommandHandlers };
