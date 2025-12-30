import { getYouTubeVideoId } from 'opex-yt-id';
import { InlineKeyboard } from '../gramjs/inline-keyboard.js';

const registerMessageHandlers = ({
  bot,
  getSpotifyTrackId,
  isTikTokUrl,
  getTikTokDetailsSafe,
  handleSpotifyDownloadNormal,
  processTikTokDownloadRequestNormalWithCache,
  replyOpts,
}) => {
  bot.on('message:text', async (ctx) => {
    const userId = ctx.from.id;
    const messageText = ctx.message.text;
    const youtubeId = getYouTubeVideoId(messageText);
    const spotifyTrackId = getSpotifyTrackId(messageText);
    const isTikTok = isTikTokUrl(messageText);

    if (youtubeId) {
      console.log(`[message:text] User ${userId} sent valid YouTube URL (ID: ${youtubeId}). Asking format.`);
      const formatKeyboard = new InlineKeyboard()
        .text(ctx.t('button_mp3'), `fmt_yt:${youtubeId}:mp3`)
        .text(ctx.t('button_mp4'), `fmt_yt:${youtubeId}:mp4`)
        .row()
        .text(ctx.t('button_cancel'), 'cancel');
      try {
        await ctx.reply(ctx.t('choose_format'), { parse_mode: undefined, reply_markup: formatKeyboard });
      } catch (error) {
        console.error(`[message:text] User ${userId} - Error sending YT format choice for ${youtubeId}:`, error);
        await ctx.reply(ctx.t('general_error', { error: error.message }) + ctx.botUsernameSuffix(), replyOpts());
      }
    } else if (spotifyTrackId) {
      console.log(`[message:text] User ${userId} sent valid Spotify URL (ID: ${spotifyTrackId}). Starting download.`);
      await handleSpotifyDownloadNormal(ctx, messageText);
    } else if (isTikTok) {
      console.log(`[message:text] User ${userId} sent valid TikTok URL: ${messageText}. Asking format.`);
      const tiktokInfo = await getTikTokDetailsSafe(messageText);
      if (!tiktokInfo || !tiktokInfo.videoId) {
        console.warn(`[message:text] User ${userId} - Failed to get TikTok info for ${messageText}.`);
        await ctx.reply(ctx.t('tiktok_metadata_failed') + ctx.botUsernameSuffix(), replyOpts());
        return;
      }
      const tiktokVideoId = tiktokInfo.videoId;
      const formatKeyboard = new InlineKeyboard()
        .text(ctx.t('button_mp3'), `fmt_tk:${tiktokVideoId}:mp3`)
        .text(ctx.t('button_mp4'), `fmt_tk:${tiktokVideoId}:mp4`)
        .row()
        .text(ctx.t('button_cancel'), 'cancel');
      try {
        const title = tiktokInfo.description ? `"${tiktokInfo.description.substring(0, 50)}..."` : ctx.t('fallback_tiktok_title');
        await ctx.reply(`${ctx.t('choose_format_tiktok')} (${title})`, { parse_mode: undefined, reply_markup: formatKeyboard });
      } catch (error) {
        console.error(`[message:text] User ${userId} - Error sending TikTok format choice for ${tiktokVideoId}:`, error);
        await ctx.reply(ctx.t('general_error', { error: error.message }) + ctx.botUsernameSuffix(), replyOpts());
      }
    } else {
      console.log(`[message:text] User ${userId} sent text: "${messageText.substring(0, 50)}..."`);
      if (!messageText.startsWith('/')) {
        await ctx.reply(ctx.t('invalid_url'), replyOpts());
      }
    }
  });

  bot.callbackQuery(/^fmt_tk:([a-zA-Z0-9_]+):(mp3|mp4)$/, async (ctx) => {
    const tiktokVideoId = ctx.match[1];
    const formatString = ctx.match[2];
    const userId = ctx.from.id;
    console.log(`[Callback fmt_tk] User ${userId} chose format ${formatString} for TikTok ${tiktokVideoId}. Starting download process (normal chat).`);

    await ctx.answerCallbackQuery();

    const message = ctx.callbackQuery.message;
    if (!message) {
      console.error(`[Callback fmt_tk] User ${userId} - CRITICAL: Cannot process format callback for TikTok ${tiktokVideoId}: message context missing.`);
      await ctx.answerCallbackQuery({ text: ctx.t('error_unexpected_action'), show_alert: true }).catch(() => {});
      return;
    }

    const originalMessageText = message.reply_to_message?.text || message.text;
    let tiktokUrl = null;
    if (originalMessageText && isTikTokUrl(originalMessageText)) {
      tiktokUrl = originalMessageText;
    } else {
      tiktokUrl = `https://www.tiktok.com/video/${tiktokVideoId}`;
      console.warn(`[Callback fmt_tk] User ${userId} - Could not reliably get original TikTok URL for ${tiktokVideoId}. Using fallback: ${tiktokUrl}`);
    }

    if (!tiktokUrl) {
      console.error(`[Callback fmt_tk] User ${userId} - CRITICAL: Could not determine TikTok URL for ${tiktokVideoId}.`);
      await ctx.answerCallbackQuery({ text: ctx.t('error_unexpected_action'), show_alert: true }).catch(() => {});
      try {
        await ctx.editMessageText(ctx.t('error_unexpected_action'), { parse_mode: undefined, reply_markup: undefined });
      } catch (error) {
        // no-op
      }
      return;
    }

    const editTarget = { chatId: message.chat.id, messageId: message.message_id };
    await processTikTokDownloadRequestNormalWithCache(ctx, tiktokVideoId, tiktokUrl, formatString, editTarget);
  });
};

export { registerMessageHandlers };
