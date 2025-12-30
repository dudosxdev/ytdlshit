import { Api } from 'telegram';
import { InlineKeyboard } from '../bot/gramjs/inline-keyboard.js';
import { parseSerializedDocument } from '../bot/gramjs/file-cache.js';
import { parseTextEntities } from '../bot/gramjs/message-utils.js';

const createInlineEditor = ({ userLanguages, defaultLocale, botUsernameSuffix }) => {
  const editInlineMessageWithFileId = async (ctx, inlineMessageId, fileId, formatString, detailsObject) => {
    const userId = ctx.from?.id || ctx.chosenInlineResult?.from?.id || ctx.callbackQuery?.from?.id || 'N/A';
    const logPrefix = `[Edit Inline ${userId}]`;
    console.log(`${logPrefix} Attempting to edit inline message ${inlineMessageId} using file_id ${fileId} (Format: ${formatString})`);

    if (!detailsObject) {
      console.error(`${logPrefix} Cannot edit inline message ${inlineMessageId}: detailsObject is missing.`);
      let errorKey = 'general_error';
      if (formatString.startsWith('yt_')) errorKey = 'error_fetching_title';
      else if (formatString === 'spotify') errorKey = 'spotify_metadata_failed';
      else if (formatString.startsWith('tk_')) errorKey = 'tiktok_metadata_failed';
      try {
        await ctx.api.editMessageTextInline(inlineMessageId, ctx.t(errorKey), { reply_markup: undefined, parse_mode: undefined });
      } catch (error) {
        return;
      }
      return;
    }

    try {
      let caption = '';
      let inputMedia;
      const baseMediaOptions = { parse_mode: 'HTML' };
      const inputDocument = parseSerializedDocument(fileId);
      if (!inputDocument) {
        throw new Error('Invalid cached document payload.');
      }

      if (formatString === 'spotify') {
        const metadata = detailsObject;
        const trackTitle = metadata.name || ctx.t('fallback_track_title');
        const artistName = metadata.artist || 'Unknown Artist';
        caption = `${trackTitle} - ${artistName}${botUsernameSuffix()}`;
        inputMedia = new Api.InputMediaDocument({
          id: inputDocument,
        });
        console.log(`${logPrefix} Preparing InputMediaAudio for Spotify track "${trackTitle}"`);
      } else if (formatString === 'yt_mp3') {
        const videoDetails = detailsObject;
        const videoTitle = videoDetails.title || ctx.t('fallback_video_title');
        const videoUrl = `https://www.youtube.com/watch?v=${videoDetails.videoId}`;
        caption = `${videoTitle}\n${videoUrl}${botUsernameSuffix()}`;
        inputMedia = new Api.InputMediaDocument({
          id: inputDocument,
        });
        console.log(`${logPrefix} Preparing InputMediaAudio for YT "${videoTitle}", Duration: ${videoDetails.seconds}`);
      } else if (formatString === 'yt_mp4') {
        const videoDetails = detailsObject;
        const videoTitle = videoDetails.title || ctx.t('fallback_video_title');
        const videoUrl = `https://www.youtube.com/watch?v=${videoDetails.videoId}`;
        caption = `${videoTitle}\n${videoUrl}${botUsernameSuffix()}`;
        inputMedia = new Api.InputMediaDocument({
          id: inputDocument,
        });
        console.log(`${logPrefix} Preparing InputMediaVideo for YT "${videoTitle}", Duration: ${videoDetails.seconds}`);
      } else if (formatString === 'tk_mp3') {
        const tiktokInfo = detailsObject;
        const videoTitle = tiktokInfo.description?.substring(0, 150) || ctx.t('fallback_tiktok_title');
        const videoUrl = `https://www.tiktok.com/video/${tiktokInfo.videoId}`;
        caption = `${videoTitle}\n${videoUrl}${botUsernameSuffix()}`;
        inputMedia = new Api.InputMediaDocument({
          id: inputDocument,
        });
        console.log(`${logPrefix} Preparing InputMediaAudio for TikTok "${videoTitle}"`);
      } else if (formatString === 'tk_mp4') {
        const tiktokInfo = detailsObject;
        const videoTitle = tiktokInfo.description?.substring(0, 150) || ctx.t('fallback_tiktok_title');
        const videoUrl = `https://www.tiktok.com/video/${tiktokInfo.videoId}`;
        caption = `${videoTitle}\n${videoUrl}${botUsernameSuffix()}`;
        inputMedia = new Api.InputMediaDocument({
          id: inputDocument,
        });
        console.log(`${logPrefix} Preparing InputMediaVideo for TikTok "${videoTitle}"`);
      } else {
        console.error(`${logPrefix} Unknown formatString "${formatString}" in editInlineMessageWithFileId.`);
        throw new Error('Internal error: Unknown format for editing.');
      }

      console.log(`${logPrefix} Calling editMessageMediaInline for ${inlineMessageId}.`);
      const { message, entities } = await parseTextEntities(ctx.api.client, caption, baseMediaOptions.parse_mode);
      await ctx.api.editMessageMediaInline(
        inlineMessageId,
        {
          media: inputMedia,
          caption: message,
          parse_mode: baseMediaOptions.parse_mode,
          entities,
        },
        { reply_markup: new InlineKeyboard() },
      );
      console.log(`${logPrefix} Successfully edited inline message ${inlineMessageId} with file ${fileId}.`);
    } catch (error) {
      console.error(`${logPrefix} FAILED to edit inline message ${inlineMessageId} with file_id ${fileId} (Format: ${formatString}):`, error.description || error);
      try {
        await ctx.api.editMessageTextInline(inlineMessageId, ctx.t('inline_edit_failed'), {
          reply_markup: undefined,
          parse_mode: undefined,
        });
      } catch (editError) {
        if (
          !editError.description?.includes('not found') &&
          !editError.description?.includes("can't be edited") &&
          !editError.description?.includes('is invalid')
        ) {
          console.error(`${logPrefix} Failed even to edit inline message ${inlineMessageId} to error text:`, editError.description || editError);
        }
      }
    }
  };

  return { editInlineMessageWithFileId };
};

export { createInlineEditor };
