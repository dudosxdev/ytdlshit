import pkg from 'grammy';

const { InlineKeyboard } = pkg;

const registerCallbackHandlers = ({
  bot,
  audioQualityStrings,
  videoQualityStrings,
  getQualityDisplay,
  processYouTubeDownloadRequestNormalWithCache,
}) => {
  bot.callbackQuery(/^fmt_yt:([a-zA-Z0-9_-]{11}):(mp3|mp4)$/, async (ctx) => {
    const youtubeId = ctx.match[1];
    const formatString = ctx.match[2];
    const userId = ctx.from.id;
    console.log(`[Callback fmt_yt] User ${userId} chose format ${formatString} for YT ${youtubeId}. Asking quality.`);

    await ctx.answerCallbackQuery();

    const qualityKeyboard = new InlineKeyboard();
    let qualityPrompt;
    const qualityCallbackPrefix = `q_yt:${youtubeId}:${formatString}:`;
    let qualityOptions;

    if (formatString === 'mp3') {
      qualityPrompt = ctx.t('choose_quality_audio');
      qualityOptions = [...audioQualityStrings].sort((a, b) => Number.parseInt(a, 10) - Number.parseInt(b, 10));
    } else {
      qualityPrompt = ctx.t('choose_quality_video');
      qualityOptions = [...videoQualityStrings].sort((a, b) => Number.parseInt(a, 10) - Number.parseInt(b, 10));
    }

    qualityOptions.forEach((qualityString, index) => {
      qualityKeyboard.text(getQualityDisplay(ctx, qualityString), `${qualityCallbackPrefix}${qualityString}`);
      if ((index + 1) % 2 === 0) qualityKeyboard.row();
    });
    qualityKeyboard.row().text(ctx.t('button_cancel'), 'cancel');

    try {
      await ctx.editMessageText(qualityPrompt, { parse_mode: undefined, reply_markup: qualityKeyboard });
    } catch (error) {
      if (!error.description?.includes('modified')) {
        console.error(`[Callback fmt_yt] User ${userId} - Error editing message for quality choice (${youtubeId}):`, error);
        await ctx
          .answerCallbackQuery({ text: ctx.t('general_error', { error: 'Failed to show quality options' }), show_alert: true })
          .catch(() => {});
      }
    }
  });

  bot.callbackQuery(/^q_yt:([a-zA-Z0-9_-]{11}):(mp3|mp4):([a-zA-Z0-9]+(?:kbps|p))$/, async (ctx) => {
    const youtubeId = ctx.match[1];
    const formatString = ctx.match[2];
    const chosenQualityString = ctx.match[3];
    const userId = ctx.from.id;
    console.log(`[Callback q_yt] User ${userId} chose quality ${chosenQualityString} (Format: ${formatString}) for YT ${youtubeId}. Starting download process (normal chat).`);

    await ctx.answerCallbackQuery();

    const message = ctx.callbackQuery.message;
    if (!message) {
      console.error(`[Callback q_yt] User ${userId} - CRITICAL: Cannot process quality callback for YT ${youtubeId}: message context missing.`);
      await ctx.answerCallbackQuery({ text: ctx.t('error_unexpected_action'), show_alert: true }).catch(() => {});
      return;
    }

    const editTarget = { chatId: message.chat.id, messageId: message.message_id };
    const youtubeUrl = `https://www.youtube.com/watch?v=${youtubeId}`;
    await processYouTubeDownloadRequestNormalWithCache(ctx, youtubeId, youtubeUrl, formatString, chosenQualityString, editTarget);
  });

  bot.callbackQuery('cancel', async (ctx) => {
    const userId = ctx.from.id;
    console.log(`[Callback cancel] User ${userId} cancelled the action.`);
    await ctx.answerCallbackQuery();
    try {
      await ctx.editMessageText(ctx.t('action_cancelled'), { parse_mode: undefined, reply_markup: undefined });
    } catch (error) {
      if (!error.description?.includes('modified') && !error.description?.includes('not found')) {
        console.error(`[Callback cancel] User ${userId} - Error editing message on cancel:`, error);
      }
    }
  });
};

export { registerCallbackHandlers };
