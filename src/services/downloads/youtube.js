import pkg from 'grammy';
import { downloadYouTubeVideo } from '../../ytdl.js';

const { GrammyError, InputFile } = pkg;

const createYouTubeDownloads = ({
  bot,
  getFileIdCache,
  saveFileCache,
  botAdminId,
  targetChannelId,
  botUsernameSuffix,
  replyOpts,
  getVideoDetailsSafe,
  getQualityDisplay,
  editInlineMessageWithFileId,
}) => {
  const processYouTubeDownloadAndCache = async (
    ctx,
    youtubeId,
    formatString,
    chosenQualityString,
    inlineMessageId,
    cacheKey,
    videoDetails,
  ) => {
    const userId = ctx.from?.id || ctx.chosenInlineResult?.from?.id || ctx.callbackQuery?.from?.id || 'N/A';
    const logPrefix = `[YT Download&Cache ${userId}]`;
    const canonicalUrl = `https://www.youtube.com/watch?v=${youtubeId}`;
    let fileStreamResponse = null;
    console.log(`${logPrefix} Starting YT process for ${youtubeId}, format: ${formatString}, quality: ${chosenQualityString}. Target: ${targetChannelId}, InlineMsgID: ${inlineMessageId}, CacheKey: ${cacheKey}`);

    if (!videoDetails) {
      console.error(`${logPrefix} Cannot process YT download/cache for ${inlineMessageId}: videoDetails missing.`);
      try {
        await ctx.api.editMessageTextInline(inlineMessageId, ctx.t('error_fetching_title'), { reply_markup: undefined, parse_mode: undefined });
      } catch (error) {
        return;
      }
      return;
    }

    const setInlineError = async (errorKey = 'inline_error_general', templateData = {}) => {
      console.error(`${logPrefix} Setting inline message ${inlineMessageId} to YT error state (${errorKey})`);
      try {
        await ctx.api.editMessageTextInline(inlineMessageId, ctx.t(errorKey, templateData), { reply_markup: undefined, parse_mode: 'HTML' });
      } catch (error) {
        if (!error.description?.includes('not found') && !error.description?.includes("can't be edited")) {
          console.error(`${logPrefix} Failed to edit inline message ${inlineMessageId} to YT error state '${errorKey}':`, error.description || error);
        }
      }
    };

    try {
      console.log(`${logPrefix} Calling downloadYouTubeVideo(${canonicalUrl}, ${formatString}, ${chosenQualityString})`);
      fileStreamResponse = await downloadYouTubeVideo(canonicalUrl, formatString, chosenQualityString, null, { enableLogging: true });
      console.log(`${logPrefix} Received response from downloadYouTubeVideo. Status: ${fileStreamResponse?.status}`);

      if (!fileStreamResponse || !fileStreamResponse.body || !fileStreamResponse.ok) {
        let apiErrorMsg = `Status: ${fileStreamResponse?.status || 'N/A'}`;
        if (fileStreamResponse && !fileStreamResponse.ok) {
          try {
            apiErrorMsg += `, Body: ${(await fileStreamResponse.text()).substring(0, 100)}`;
          } catch (error) {
            // no-op
          }
        }
        if (apiErrorMsg.includes('Video is too long')) throw new Error('Video is too long');
        throw new Error(`YT Download service failed. ${apiErrorMsg}`);
      }

      console.log(`${logPrefix} YT File stream obtained. Sending to channel ${targetChannelId}...`);
      let filename = `${(videoDetails.title || youtubeId).substring(0, 100)}_${formatString}_${chosenQualityString}.${formatString}`;
      const contentDisposition = fileStreamResponse.headers.get('content-disposition');
      if (contentDisposition) {
        const utf8Match = contentDisposition.match(/filename\*=UTF-8''([^;]+)/i);
        if (utf8Match?.[1]) {
          try {
            filename = decodeURIComponent(utf8Match[1]);
          } catch (error) {
            // no-op
          }
        } else {
          const asciiMatch = contentDisposition.match(/filename="?([^";]+)"?/i);
          if (asciiMatch?.[1]) filename = asciiMatch[1];
        }
      }
      filename = filename.replace(/[/\\?%*:|"<>]/g, '-').substring(0, 200);
      console.log(`${logPrefix} Using filename for YT channel upload: ${filename}`);

      const inputFile = new InputFile(fileStreamResponse.body, filename);
      const channelCaption = `Cache YT: ${youtubeId} | ${formatString} | ${chosenQualityString}`;
      const sendOptions = { caption: channelCaption, disable_notification: true, parse_mode: undefined };

      let sentMessage;
      console.log(`${logPrefix} Sending YT ${formatString} to channel...`);
      if (formatString === 'mp3') {
        sentMessage = await ctx.api.sendAudio(targetChannelId, inputFile, {
          ...sendOptions,
          duration: videoDetails.seconds,
          performer: videoDetails.author?.name,
          title: videoDetails.title,
        });
      } else {
        sentMessage = await ctx.api.sendVideo(targetChannelId, inputFile, {
          ...sendOptions,
          duration: videoDetails.seconds,
          supports_streaming: true,
          thumbnail: videoDetails.thumbnail ? new InputFile({ url: videoDetails.thumbnail }) : undefined,
        });
      }
      console.log(`${logPrefix} Successfully sent YT file to channel ${targetChannelId}. Message ID: ${sentMessage.message_id}`);

      const fileId = formatString === 'mp3' ? sentMessage.audio?.file_id : sentMessage.video?.file_id;
      if (!fileId) throw new Error('Failed to get YT file_id after channel upload.');
      console.log(`${logPrefix} Extracted YT file_id: ${fileId}`);

      const fileIdCache = getFileIdCache();
      fileIdCache[cacheKey] = fileId;
      await saveFileCache();
      console.log(`${logPrefix} Saved YT file_id ${fileId} to cache with key ${cacheKey}.`);

      await editInlineMessageWithFileId(ctx, inlineMessageId, fileId, `yt_${formatString}`, videoDetails);
    } catch (error) {
      console.error(`${logPrefix} FAILED during YT download/cache for ${youtubeId} (InlineMsgID: ${inlineMessageId}):`, error);
      let userErrorKey = 'inline_cache_upload_failed';
      let errorData = { error: error.message };
      if (error.message?.includes('Video is too long')) {
        userErrorKey = 'length_limit_error';
        errorData = {};
      } else if (error.message?.includes('Download service failed')) {
        userErrorKey = 'api_error_fetch';
        errorData = { error: error.message };
      } else if (error instanceof GrammyError && (error.error_code === 413 || error.description?.includes('too large'))) {
        userErrorKey = 'error_telegram_size';
        errorData = {};
      } else if (error instanceof GrammyError && error.description?.includes('wrong file identifier')) {
        userErrorKey = 'inline_cache_upload_failed';
        errorData = { error: 'Internal cache error.' };
      } else if (error instanceof GrammyError && (error.description?.includes('chat not found') || error.description?.includes('bot is not a participant'))) {
        console.error(`${logPrefix} CRITICAL: Cannot send YT to target channel ${targetChannelId}. Check permissions/ID.`, error);
        userErrorKey = 'inline_error_general';
        errorData = { error: 'Bot configuration error.' };
        await bot.api
          .sendMessage(botAdminId, `🚨 CRITICAL ERROR: Cannot send YT cache file to channel ${targetChannelId}. Check bot permissions/ID. Error: ${error.description || error.message}`)
          .catch(() => {});
      }
      await setInlineError(userErrorKey, errorData);
    } finally {
      if (fileStreamResponse?.body?.cancel) fileStreamResponse.body.cancel().catch((error) => console.warn(`${logPrefix} Error closing YT stream body via cancel():`, error));
      else if (fileStreamResponse?.body?.destroy)
        try {
          fileStreamResponse.body.destroy();
        } catch (error) {
          console.warn(`${logPrefix} Error destroying YT stream body:`, error);
        }
      else if (fileStreamResponse?.body?.abort)
        try {
          fileStreamResponse.body.abort();
        } catch (error) {
          console.warn(`${logPrefix} Error aborting YT stream body:`, error);
        }
      console.log(`${logPrefix} Finished YT processing request for ${youtubeId} (InlineMsgID: ${inlineMessageId}).`);
    }
  };

  const processYouTubeDownloadRequestNormalWithCache = async (
    ctx,
    youtubeId,
    youtubeUrl,
    formatString,
    chosenQualityString,
    editTarget,
  ) => {
    const userId = ctx.from?.id || 'N/A';
    const logPrefix = `[ProcessDL YT Normal ${userId}]`;
    const targetId = `${editTarget.chatId}/${editTarget.messageId}`;
    const cacheKey = `yt:${youtubeId}:${formatString}:${chosenQualityString}`;

    console.log(`${logPrefix} Starting YT process for ${youtubeId}, format: ${formatString}, quality: ${chosenQualityString}. Target: ${targetId}. Cache key: ${cacheKey}`);

    let statusMessageExists = true;

    const editStatus = async (textKey, templateData = {}, extra = {}) => {
      if (!statusMessageExists) return;
      try {
        await ctx.api.editMessageText(editTarget.chatId, editTarget.messageId, ctx.t(textKey, templateData), { parse_mode: undefined, ...extra });
      } catch (error) {
        if (error.description?.includes('not found')) {
          statusMessageExists = false;
          console.warn(`${logPrefix} Status message ${targetId} not found during edit.`);
        } else if (!error.description?.includes('modified')) {
          console.warn(`${logPrefix} Failed to edit status msg ${targetId} to "${ctx.t(textKey, templateData).substring(0, 50)}...":`, error.description || error);
        }
      }
    };

    const sendErrorReply = async (translationKey, templateData = {}) => {
      const suffix = botUsernameSuffix();
      const errorMessage = ctx.t(translationKey, templateData) + suffix;
      console.error(`${logPrefix} Sending YT error to ${userId} (target: ${targetId}): ${ctx.t(translationKey, templateData)}`);
      try {
        if (statusMessageExists) {
          await ctx.api.editMessageText(editTarget.chatId, editTarget.messageId, errorMessage, { ...replyOpts(), reply_markup: undefined });
          statusMessageExists = false;
        } else {
          await ctx.reply(errorMessage, replyOpts()).catch((replyError) => console.error(`${logPrefix} Failed even to send new YT error reply:`, replyError));
        }
      } catch (error) {
        console.error(`${logPrefix} Failed to edit YT message ${targetId} with error '${translationKey}':`, error.description || error);
        if (ctx.chat?.id && !error.description?.includes('not found')) {
          await ctx.reply(errorMessage, replyOpts()).catch((replyError) => console.error(`${logPrefix} Failed fallback YT error reply:`, replyError));
        }
        statusMessageExists = false;
      }
    };

    const sendFileToUser = async (fileId, videoDetails) => {
      if (!videoDetails) {
        console.error(`${logPrefix} Cannot send YT file ${fileId}: videoDetails missing.`);
        await sendErrorReply('error_fetching_title');
        return;
      }
      try {
        if (statusMessageExists) {
          try {
            await ctx.api.deleteMessage(editTarget.chat.id, editTarget.message_id);
            statusMessageExists = false;
            console.log(`${logPrefix} Deleted status message ${targetId}.`);
          } catch (deleteError) {
            if (deleteError.description?.includes('not found')) statusMessageExists = false;
            else {
              console.warn(`${logPrefix} Could not delete status msg ${targetId}:`, deleteError.description || deleteError);
              statusMessageExists = false;
            }
          }
        }

        const videoTitle = videoDetails.title || ctx.t('fallback_video_title');
        const caption = `${videoTitle}\n${youtubeUrl}${botUsernameSuffix()}`;
        const baseOptions = { caption, ...replyOpts() };

        if (formatString === 'mp3') {
          await ctx.replyWithAudio(fileId, {
            ...baseOptions,
            duration: videoDetails.seconds,
            performer: videoDetails.author?.name,
            title: videoDetails.title,
          });
        } else {
          await ctx.replyWithVideo(fileId, {
            ...baseOptions,
            duration: videoDetails.seconds,
            supports_streaming: true,
          });
        }
        console.log(`${logPrefix} Successfully sent YT file ${fileId} for ${youtubeId} to user ${userId}.`);
      } catch (telegramError) {
        console.error(`${logPrefix} Telegram send YT file_id error for ${youtubeId} (FileID: ${fileId}):`, telegramError.description || telegramError);
        let errorKey = 'general_error';
        let errorData = { error: `Send failed: ${telegramError.description || telegramError.message}` };
        if (telegramError instanceof GrammyError) {
          if (telegramError.error_code === 400 && telegramError.description?.includes('wrong file identifier')) {
            errorKey = 'inline_cache_upload_failed';
            errorData = { error: 'Invalid cached file.' };
            console.warn(`${logPrefix} Removing invalid YT file_id ${fileId} from cache for key ${cacheKey}.`);
            const fileIdCache = getFileIdCache();
            delete fileIdCache[cacheKey];
            await saveFileCache();
          } else if (telegramError.error_code === 413 || telegramError.description?.includes('too large')) {
            errorKey = 'error_telegram_size';
            errorData = {};
          } else if (
            telegramError.description?.includes('INPUT_USER_DEACTIVATED') ||
            telegramError.description?.includes('BOT_IS_BLOCKED') ||
            telegramError.description?.includes('USER_IS_BLOCKED')
          ) {
            console.warn(`${logPrefix} User ${userId} interaction blocked (${telegramError.description}).`);
            return;
          }
        }
        await sendErrorReply(errorKey, errorData);
      }
    };

    try {
      const videoDetails = await getVideoDetailsSafe(youtubeId);
      if (!videoDetails) {
        await sendErrorReply('error_fetching_title');
        return;
      }

      const cachedFileId = getFileIdCache()[cacheKey];
      if (cachedFileId) {
        console.log(`${logPrefix} Cache HIT for YT ${cacheKey}. Sending directly.`);
        await editStatus('sending_file');
        await sendFileToUser(cachedFileId, videoDetails);
        return;
      }

      console.log(`${logPrefix} Cache MISS for YT ${cacheKey}. Starting download & cache process.`);
      const qualityDisplayName = getQualityDisplay(ctx, chosenQualityString);
      const formatDisplayString = formatString.toUpperCase();
      await editStatus('processing_detailed', { format: formatDisplayString, quality: qualityDisplayName });
      await editStatus('requesting_download');
      await ctx.replyWithChatAction(formatString === 'mp3' ? 'upload_audio' : 'upload_video').catch(() => {});

      let fileStreamResponse = null;

      try {
        console.log(`${logPrefix} Calling downloadYouTubeVideo(${youtubeUrl}, ${formatString}, ${chosenQualityString})`);
        fileStreamResponse = await downloadYouTubeVideo(youtubeUrl, formatString, chosenQualityString, null, { enableLogging: true });
        console.log(`${logPrefix} Received response from downloadYouTubeVideo. Status: ${fileStreamResponse?.status}`);

        if (!fileStreamResponse || !fileStreamResponse.body || !fileStreamResponse.ok) {
          let apiErrorMsg = `Status: ${fileStreamResponse?.status || 'N/A'}`;
          if (fileStreamResponse && !fileStreamResponse.ok) {
            try {
              apiErrorMsg += `, Body: ${(await fileStreamResponse.text()).substring(0, 100)}`;
            } catch (error) {
              // no-op
            }
          }
          if (apiErrorMsg.includes('Video is too long')) throw new Error('Video is too long');
          throw new Error(`YT Download service failed. ${apiErrorMsg}`);
        }

        console.log(`${logPrefix} YT File stream obtained. Sending to channel ${targetChannelId}...`);
        let filename = `${(videoDetails.title || youtubeId).substring(0, 100)}_${formatString}_${chosenQualityString}.${formatString}`;
        const contentDisposition = fileStreamResponse.headers.get('content-disposition');
        if (contentDisposition) {
          const utf8Match = contentDisposition.match(/filename\*=UTF-8''([^;]+)/i);
          if (utf8Match?.[1]) {
            try {
              filename = decodeURIComponent(utf8Match[1]);
            } catch (error) {
              // no-op
            }
          } else {
            const asciiMatch = contentDisposition.match(/filename="?([^";]+)"?/i);
            if (asciiMatch?.[1]) filename = asciiMatch[1];
          }
        }
        filename = filename.replace(/[/\\?%*:|"<>]/g, '-').substring(0, 200);
        console.log(`${logPrefix} Using filename for YT channel upload: ${filename}`);

        const inputFile = new InputFile(fileStreamResponse.body, filename);
        const channelCaption = `Cache YT: ${youtubeId} | ${formatString} | ${chosenQualityString}`;
        const sendOptions = { caption: channelCaption, disable_notification: true, parse_mode: undefined };

        let sentMessage;
        console.log(`${logPrefix} Sending YT ${formatString} to channel...`);
        if (formatString === 'mp3') {
          sentMessage = await ctx.api.sendAudio(targetChannelId, inputFile, {
            ...sendOptions,
            duration: videoDetails.seconds,
            performer: videoDetails.author?.name,
            title: videoDetails.title,
          });
        } else {
          sentMessage = await ctx.api.sendVideo(targetChannelId, inputFile, {
            ...sendOptions,
            duration: videoDetails.seconds,
            supports_streaming: true,
            thumbnail: videoDetails.thumbnail ? new InputFile({ url: videoDetails.thumbnail }) : undefined,
          });
        }
        console.log(`${logPrefix} Successfully sent YT file to channel. Message ID: ${sentMessage.message_id}`);

        const newFileId = formatString === 'mp3' ? sentMessage.audio?.file_id : sentMessage.video?.file_id;
        if (!newFileId) throw new Error('Failed to get YT file_id after channel upload.');
        console.log(`${logPrefix} Extracted YT file_id: ${newFileId}`);
        const fileIdCache = getFileIdCache();
        fileIdCache[cacheKey] = newFileId;
        await saveFileCache();
        console.log(`${logPrefix} Saved YT file_id ${newFileId} to cache with key ${cacheKey}.`);

        await editStatus('sending_file');
        await sendFileToUser(newFileId, videoDetails);
      } catch (error) {
        console.error(`${logPrefix} FAILED during YT download/cache for ${youtubeId} (Target: ${targetId}):`, error);
        let userErrorKey = 'inline_cache_upload_failed';
        let errorData = { error: error.message };
        if (error.message?.includes('Video is too long')) {
          userErrorKey = 'length_limit_error';
          errorData = {};
        } else if (error.message?.includes('Download service failed')) {
          userErrorKey = 'api_error_fetch';
          errorData = { error: error.message };
        } else if (error instanceof GrammyError && (error.error_code === 413 || error.description?.includes('too large'))) {
          userErrorKey = 'error_telegram_size';
          errorData = {};
        } else if (error instanceof GrammyError && (error.description?.includes('chat not found') || error.description?.includes('bot is not a participant'))) {
          console.error(`${logPrefix} CRITICAL: Cannot send YT to target channel ${targetChannelId}. Check permissions/ID.`, error);
          userErrorKey = 'general_error';
          errorData = { error: 'Bot configuration error.' };
          await bot.api
            .sendMessage(botAdminId, `🚨 CRITICAL ERROR: Cannot send YT cache file to channel ${targetChannelId} during normal download. Check permissions/ID. Error: ${error.description || error.message}`)
            .catch(() => {});
        }
        await sendErrorReply(userErrorKey, errorData);
      } finally {
        if (fileStreamResponse?.body?.cancel) fileStreamResponse.body.cancel().catch((error) => console.warn(`${logPrefix} Error closing YT stream body via cancel():`, error));
        else if (fileStreamResponse?.body?.destroy)
          try {
            fileStreamResponse.body.destroy();
          } catch (error) {
            console.warn(`${logPrefix} Error destroying YT stream body:`, error);
          }
        else if (fileStreamResponse?.body?.abort)
          try {
            fileStreamResponse.body.abort();
          } catch (error) {
            console.warn(`${logPrefix} Error aborting YT stream body:`, error);
          }
      }
    } catch (error) {
      console.error(`${logPrefix} UNEXPECTED error before YT download for ${youtubeId} (Target: ${targetId}):`, error);
      await sendErrorReply('general_error', { error: error.message });
    } finally {
      console.log(`${logPrefix} Finished YT processing request for ${youtubeId} (Target: ${targetId}).`);
    }
  };

  return { processYouTubeDownloadAndCache, processYouTubeDownloadRequestNormalWithCache };
};

export { createYouTubeDownloads };
