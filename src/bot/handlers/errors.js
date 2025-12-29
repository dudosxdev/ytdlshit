import pkg from 'grammy';

const { GrammyError, HttpError } = pkg;

const registerErrorHandler = ({ bot, botAdminId, userLanguages, defaultLocale, t, replyOpts, botUsernameSuffix }) => {
  bot.catch((err) => {
    const ctx = err.ctx;
    const updateId = ctx?.update?.update_id || 'N/A';
    const updateType = ctx?.updateType || 'N/A';
    const userId =
      ctx?.from?.id ||
      ctx?.inlineQuery?.from?.id ||
      ctx?.chosenInlineResult?.from?.id ||
      ctx?.callbackQuery?.from?.id ||
      'N/A';
    const lang = ctx?.lang || userLanguages[userId] || defaultLocale;
    const error = err.error;

    console.error(`💥 Unhandled error caught! Update ID: ${updateId}, Type: ${updateType}, User: ${userId}`);

    if (error instanceof GrammyError) {
      console.error(`[bot.catch] GrammyError: ${error.description}`, error.payload ? `Payload: ${JSON.stringify(error.payload)}` : '');
      if (
        error.description.includes('message is not modified') ||
        error.description.includes('query is too old') ||
        error.description.includes('message to edit not found') ||
        error.description.includes("message can't be edited") ||
        error.description.includes('bot was blocked') ||
        error.description.includes('user is deactivated') ||
        error.description.includes('chat not found') ||
        error.description.includes('inline message ID is invalid') ||
        error.description.includes('QUERY_ID_INVALID')
      ) {
        console.log(`[bot.catch] (Ignoring common/expected GrammyError: ${error.description})`);
        return;
      }
    } else if (error instanceof HttpError) {
      console.error('[bot.catch] HttpError (Telegram connection):', error);
    } else if (error?.name?.startsWith('Sequelize')) {
      console.error(`[bot.catch] Sequelize Error (${error.name}):`, error.message, error.parent ? `\n  Parent: ${error.parent.message}` : '');
      bot.api.sendMessage(botAdminId, `🚨 DATABASE ERROR: ${error.name} - ${error.message}`).catch(() => {});
    } else if (error?.message?.toLowerCase().includes('spotify')) {
      console.error('[bot.catch] Spotify Library/API Error:', error.message);
    } else if (error?.message?.toLowerCase().includes('tiktok')) {
      console.error('[bot.catch] TikTok Library/API Error:', error.message);
    } else if (error?.message?.toLowerCase().includes('youtube') || error?.message?.toLowerCase().includes('cnvmp3')) {
      console.error('[bot.catch] YouTube Library/API Error:', error.message);
    } else {
      console.error('[bot.catch] Unknown or Library error:', error?.message || error);
      if (error?.stack) console.error(error.stack);
    }

    const errorMessage = t(lang, 'error_occurred_try_again');
    const errorMessageInline = t(lang, 'inline_error_general');
    const suffix = botUsernameSuffix();

    try {
      if (updateType === 'inline_query' && ctx.inlineQuery) {
        ctx
          .answerInlineQuery([
            {
              type: 'article',
              id: 'bot_error',
              title: errorMessageInline,
              input_message_content: { message_text: errorMessageInline, parse_mode: undefined },
            },
          ], { cache_time: 5 })
          .catch(() => {});
      } else if (
        (updateType === 'chosen_inline_result' || updateType === 'callback_query') &&
        (ctx.chosenInlineResult?.inline_message_id || ctx.callbackQuery?.inline_message_id)
      ) {
        const inlineMsgId = ctx.chosenInlineResult?.inline_message_id || ctx.callbackQuery?.inline_message_id;
        if (inlineMsgId) {
          ctx.api
            .editMessageTextInline(inlineMsgId, errorMessageInline, { reply_markup: undefined, parse_mode: undefined })
            .catch((inlineEditError) => {
              if (
                !inlineEditError.description?.includes('not found') &&
                !inlineEditError.description?.includes('not modified') &&
                !inlineEditError.description?.includes('invalid')
              ) {
                console.error(`[bot.catch] Failed to edit inline message ${inlineMsgId} with error:`, inlineEditError.description || inlineEditError);
              }
            });
        } else {
          console.error(`[bot.catch] Error during ${updateType} for user ${userId}, but inline_message_id missing.`);
        }
      } else if (updateType === 'callback_query' && ctx.chat?.id && ctx.callbackQuery?.message?.message_id) {
        const targetChatId = ctx.chat.id;
        const targetMessageId = ctx.callbackQuery.message.message_id;
        ctx.api
          .editMessageText(targetChatId, targetMessageId, errorMessage + suffix, { ...replyOpts(), reply_markup: undefined })
          .catch((editError) => {
            if (!editError.description?.includes('not found') && !editError.description?.includes('not modified')) {
              ctx
                .reply(errorMessage + suffix, replyOpts())
                .catch((replyError) => console.error('☠️ [bot.catch] Failed fallback error reply:', replyError.description || replyError));
            }
          });
      } else if (ctx.chat?.id) {
        ctx.reply(errorMessage + suffix, replyOpts()).catch((replyError) => console.error('☠️ [bot.catch] Failed to send error reply:', replyError.description || replyError));
      } else {
        console.error(`☠️ [bot.catch] Cannot send error notification: No chat context found for update type ${updateType}.`);
      }
    } catch (notifyError) {
      console.error('☠️ [bot.catch] Error while trying to notify user about the original error:', notifyError);
    }
  });
};

export { registerErrorHandler };
