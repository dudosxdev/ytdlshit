import { downloadTikTok } from '@opexdevelop/tiktok-dl';
import { extractDocumentFromMessage, parseSerializedDocument, serializeInputDocument } from '../../bot/gramjs/file-cache.js';

const createTikTokDownloads = ({
  bot,
  getFileIdCache,
  saveFileCache,
  botAdminId,
  targetChannelId,
  botUsernameSuffix,
  replyOpts,
  getTikTokDetailsSafe,
  editInlineMessageWithFileId,
}) => {
  const processTikTokDownloadAndCache = async (
    ctx,
    tiktokVideoId,
    tiktokUrl,
    formatString,
    inlineMessageId,
    cacheKey,
    tiktokInfo,
  ) => {
    const userId = ctx.from?.id || ctx.chosenInlineResult?.from?.id || ctx.callbackQuery?.from?.id || 'N/A';
    const logPrefix = `[TikTok Download&Cache ${userId}]`;
    let fileStreamResponse = null;
    console.log(`${logPrefix} Starting TikTok process for ${tiktokVideoId}, format: ${formatString}. Target: ${targetChannelId}, InlineMsgID: ${inlineMessageId}, CacheKey: ${cacheKey}`);

    if (!tiktokInfo) {
      console.error(`${logPrefix} Cannot process TikTok download/cache for ${inlineMessageId}: tiktokInfo missing.`);
      try {
        await ctx.api.editMessageTextInline(inlineMessageId, ctx.t('tiktok_metadata_failed'), { reply_markup: undefined, parse_mode: undefined });
      } catch (error) {
        return;
      }
      return;
    }

    const setInlineError = async (errorKey = 'inline_error_general', templateData = {}) => {
      console.error(`${logPrefix} Setting inline message ${inlineMessageId} to TikTok error state (${errorKey})`);
      try {
        await ctx.api.editMessageTextInline(inlineMessageId, ctx.t(errorKey, templateData), { reply_markup: undefined, parse_mode: 'HTML' });
      } catch (error) {
        if (!error.description?.includes('not found') && !error.description?.includes("can't be edited")) {
          console.error(`${logPrefix} Failed to edit inline message ${inlineMessageId} to TikTok error state '${errorKey}':`, error.description || error);
        }
      }
    };

    try {
      console.log(`${logPrefix} Calling downloadTikTok(${tiktokUrl}, null, { format: ${formatString}, provider: 'auto' })`);
      fileStreamResponse = await downloadTikTok(tiktokUrl, null, { format: formatString, provider: 'auto', enableLogging: false });
      console.log(`${logPrefix} Received response from downloadTikTok. Status: ${fileStreamResponse?.status}`);

      if (!fileStreamResponse || !fileStreamResponse.body || !fileStreamResponse.ok) {
        let apiErrorMsg = `Status: ${fileStreamResponse?.status || 'N/A'}`;
        if (fileStreamResponse && !fileStreamResponse.ok) {
          try {
            apiErrorMsg += `, Body: ${(await fileStreamResponse.text()).substring(0, 100)}`;
          } catch (error) {
            // no-op
          }
        }
        throw new Error(`TikTok Download service failed. ${apiErrorMsg}`);
      }

      console.log(`${logPrefix} TikTok File stream obtained. Sending to channel ${targetChannelId}...`);
      const safeTitle = (tiktokInfo.description || `tiktok_${tiktokVideoId}`).replace(/[/\\?%*:|"<>]/g, '-').substring(0, 100);
      const filename = `${safeTitle}.${formatString}`;
      console.log(`${logPrefix} Using filename for TikTok channel upload: ${filename}`);

      const fileBuffer = Buffer.from(await fileStreamResponse.arrayBuffer());
      const uploadFile = { name: filename, size: fileBuffer.length, path: '', buffer: fileBuffer };
      const channelCaption = `Cache TikTok: ${tiktokVideoId} | ${formatString}`;
      const sendOptions = { caption: channelCaption, disable_notification: true, parse_mode: undefined };

      let sentMessage;
      console.log(`${logPrefix} Sending TikTok ${formatString} to channel...`);
      if (formatString === 'mp3') {
        sentMessage = await ctx.api.sendAudio(targetChannelId, uploadFile, {
          ...sendOptions,
          title: safeTitle,
        });
      } else {
        sentMessage = await ctx.api.sendVideo(targetChannelId, uploadFile, {
          ...sendOptions,
          supports_streaming: true,
        });
      }
      console.log(`${logPrefix} Successfully sent TikTok file to channel ${targetChannelId}. Message ID: ${sentMessage.message_id}`);

      const document = extractDocumentFromMessage(sentMessage);
      if (!document) throw new Error('Failed to get TikTok document after channel upload.');
      const fileId = serializeInputDocument(document);
      console.log(`${logPrefix} Extracted TikTok document: ${document.id}`);

      const fileIdCache = getFileIdCache();
      fileIdCache[cacheKey] = fileId;
      await saveFileCache();
      console.log(`${logPrefix} Saved TikTok file_id ${fileId} to cache with key ${cacheKey}.`);

      await editInlineMessageWithFileId(ctx, inlineMessageId, fileId, `tk_${formatString}`, tiktokInfo);
    } catch (error) {
      console.error(`${logPrefix} FAILED during TikTok download/cache for ${tiktokVideoId} (InlineMsgID: ${inlineMessageId}):`, error);
      let userErrorKey = 'inline_cache_upload_failed';
      let errorData = { error: error.message };
      if (error.message?.includes('Download service failed')) {
        userErrorKey = 'tiktok_download_failed';
        errorData = { error: error.message };
      } else if (error?.errorMessage?.includes('FILE_PARTS_INVALID') || error?.message?.includes('too large')) {
        userErrorKey = 'error_telegram_size';
        errorData = {};
      } else if (error?.errorMessage?.includes('FILE_ID_INVALID')) {
        userErrorKey = 'inline_cache_upload_failed';
        errorData = { error: 'Internal cache error.' };
      } else if (error?.errorMessage?.includes('CHAT_NOT_FOUND')) {
        console.error(`${logPrefix} CRITICAL: Cannot send TikTok to target channel ${targetChannelId}. Check permissions/ID.`, error);
        userErrorKey = 'inline_error_general';
        errorData = { error: 'Bot configuration error.' };
        await bot.api
          .sendMessage(botAdminId, `🚨 CRITICAL ERROR: Cannot send TikTok cache file to channel ${targetChannelId} during normal download. Check permissions/ID. Error: ${error.description || error.message}`)
          .catch(() => {});
      }
      await setInlineError(userErrorKey, errorData);
    } finally {
      if (fileStreamResponse?.body?.cancel) fileStreamResponse.body.cancel().catch((error) => console.warn(`${logPrefix} Error closing TikTok stream body via cancel():`, error));
      else if (fileStreamResponse?.body?.destroy)
        try {
          fileStreamResponse.body.destroy();
        } catch (error) {
          console.warn(`${logPrefix} Error destroying TikTok stream body:`, error);
        }
      else if (fileStreamResponse?.body?.abort)
        try {
          fileStreamResponse.body.abort();
        } catch (error) {
          console.warn(`${logPrefix} Error aborting TikTok stream body:`, error);
        }
      console.log(`${logPrefix} Finished TikTok processing request for ${tiktokVideoId} (InlineMsgID: ${inlineMessageId}).`);
    }
  };

  const processTikTokDownloadRequestNormalWithCache = async (ctx, tiktokVideoId, tiktokUrl, formatString, editTarget) => {
    const userId = ctx.from?.id || 'N/A';
    const logPrefix = `[ProcessDL TikTok Normal ${userId}]`;
    const targetId = `${editTarget.chatId}/${editTarget.messageId}`;
    const cacheKey = `tk:${tiktokVideoId}:${formatString}`;

    console.log(`${logPrefix} Starting TikTok process for ${tiktokVideoId}, format: ${formatString}. Target: ${targetId}. Cache key: ${cacheKey}`);

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
      console.error(`${logPrefix} Sending TikTok error to ${userId} (target: ${targetId}): ${ctx.t(translationKey, templateData)}`);
      try {
        if (statusMessageExists) {
          await ctx.api.editMessageText(editTarget.chatId, editTarget.messageId, errorMessage, { ...replyOpts(), reply_markup: undefined });
          statusMessageExists = false;
        } else {
          await ctx.reply(errorMessage, replyOpts()).catch((replyError) => console.error(`${logPrefix} Failed even to send new TikTok error reply:`, replyError));
        }
      } catch (error) {
        console.error(`${logPrefix} Failed to edit TikTok message ${targetId} with error '${translationKey}':`, error.description || error);
        if (ctx.chat?.id && !error.description?.includes('not found')) {
          await ctx.reply(errorMessage, replyOpts()).catch((replyError) => console.error(`${logPrefix} Failed fallback TikTok error reply:`, replyError));
        }
        statusMessageExists = false;
      }
    };

    const sendFileToUser = async (fileId, tiktokInfo) => {
      if (!tiktokInfo) {
        console.error(`${logPrefix} Cannot send TikTok file ${fileId}: tiktokInfo missing.`);
        await sendErrorReply('tiktok_metadata_failed');
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

        const videoTitle = tiktokInfo.description?.substring(0, 150) || ctx.t('fallback_tiktok_title');
        const displayUrl = tiktokUrl || `https://www.tiktok.com/video/${tiktokVideoId}`;
        const caption = `${videoTitle}\n${displayUrl}${botUsernameSuffix()}`;
        const baseOptions = { caption, ...replyOpts() };

        if (formatString === 'mp3') {
          await ctx.api.sendAudio(ctx.chat.id, fileId, {
            ...baseOptions,
            title: videoTitle,
          });
        } else {
          await ctx.api.sendVideo(ctx.chat.id, fileId, {
            ...baseOptions,
            supports_streaming: true,
          });
        }
        console.log(`${logPrefix} Successfully sent TikTok file ${fileId} for ${tiktokVideoId} to user ${userId}.`);
      } catch (telegramError) {
        const errorDescription = telegramError?.errorMessage || telegramError?.description || telegramError?.message;
        console.error(`${logPrefix} Telegram send TikTok file_id error for ${tiktokVideoId} (FileID: ${fileId}):`, errorDescription || telegramError);
        let errorKey = 'general_error';
        let errorData = { error: `Send failed: ${errorDescription || 'unknown error'}` };
        if (telegramError?.errorMessage) {
          if (telegramError.errorMessage.includes('FILE_ID_INVALID')) {
            errorKey = 'inline_cache_upload_failed';
            errorData = { error: 'Invalid cached file.' };
            console.warn(`${logPrefix} Removing invalid TikTok file_id ${fileId} from cache for key ${cacheKey}.`);
            const fileIdCache = getFileIdCache();
            delete fileIdCache[cacheKey];
            await saveFileCache();
          } else if (telegramError.errorMessage.includes('FILE_PARTS_INVALID') || telegramError.message?.includes('too large')) {
            errorKey = 'error_telegram_size';
            errorData = {};
          } else if (
            telegramError.errorMessage.includes('INPUT_USER_DEACTIVATED') ||
            telegramError.errorMessage.includes('BOT_BLOCKED') ||
            telegramError.errorMessage.includes('USER_IS_BLOCKED')
          ) {
            console.warn(`${logPrefix} User ${userId} interaction blocked (${errorDescription}).`);
            return;
          }
        }
        await sendErrorReply(errorKey, errorData);
      }
    };

    try {
      const tiktokInfo = await getTikTokDetailsSafe(tiktokUrl);
      if (!tiktokInfo) {
        await sendErrorReply('tiktok_metadata_failed');
        return;
      }

      const cachedFileId = getFileIdCache()[cacheKey];
      if (cachedFileId && parseSerializedDocument(cachedFileId)) {
        console.log(`${logPrefix} Cache HIT for TikTok ${cacheKey}. Sending directly.`);
        await editStatus('sending_file');
        await sendFileToUser(cachedFileId, tiktokInfo);
        return;
      }
      if (cachedFileId && !parseSerializedDocument(cachedFileId)) {
        delete getFileIdCache()[cacheKey];
        await saveFileCache();
      }

      console.log(`${logPrefix} Cache MISS for TikTok ${cacheKey}. Starting download & cache process.`);
      const formatDisplayString = formatString.toUpperCase();
      await editStatus('processing_tiktok', { format: formatDisplayString });
      await editStatus('requesting_download');
      await ctx.replyWithChatAction(formatString === 'mp3' ? 'upload_audio' : 'upload_video').catch(() => {});

      let fileStreamResponse = null;

      try {
        console.log(`${logPrefix} Calling downloadTikTok(${tiktokUrl}, null, { format: ${formatString}, provider: 'auto' })`);
        fileStreamResponse = await downloadTikTok(tiktokUrl, null, { format: formatString, provider: 'auto', enableLogging: false });
        console.log(`${logPrefix} Received response from downloadTikTok. Status: ${fileStreamResponse?.status}`);

        if (!fileStreamResponse || !fileStreamResponse.body || !fileStreamResponse.ok) {
          let apiErrorMsg = `Status: ${fileStreamResponse?.status || 'N/A'}`;
          if (fileStreamResponse && !fileStreamResponse.ok) {
            try {
              apiErrorMsg += `, Body: ${(await fileStreamResponse.text()).substring(0, 100)}`;
            } catch (error) {
              // no-op
            }
          }
          throw new Error(`TikTok Download service failed. ${apiErrorMsg}`);
        }

        console.log(`${logPrefix} TikTok File stream obtained. Sending to channel ${targetChannelId}...`);
        const safeTitle = (tiktokInfo.description || `tiktok_${tiktokVideoId}`).replace(/[/\\?%*:|"<>]/g, '-').substring(0, 100);
        const filename = `${safeTitle}.${formatString}`;
        console.log(`${logPrefix} Using filename for TikTok channel upload: ${filename}`);

        const fileBuffer = Buffer.from(await fileStreamResponse.arrayBuffer());
        const uploadFile = { name: filename, size: fileBuffer.length, path: '', buffer: fileBuffer };
        const channelCaption = `Cache TikTok: ${tiktokVideoId} | ${formatString}`;
        const sendOptions = { caption: channelCaption, disable_notification: true, parse_mode: undefined };

        let sentMessage;
        console.log(`${logPrefix} Sending TikTok ${formatString} to channel...`);
        if (formatString === 'mp3') {
          sentMessage = await ctx.api.sendAudio(targetChannelId, uploadFile, {
            ...sendOptions,
            title: safeTitle,
          });
        } else {
          sentMessage = await ctx.api.sendVideo(targetChannelId, uploadFile, {
            ...sendOptions,
            supports_streaming: true,
          });
        }
        console.log(`${logPrefix} Successfully sent TikTok file to channel ${targetChannelId}. Message ID: ${sentMessage.message_id}`);

        const document = extractDocumentFromMessage(sentMessage);
        if (!document) throw new Error('Failed to get TikTok document after channel upload.');
        const newFileId = serializeInputDocument(document);
        console.log(`${logPrefix} Extracted TikTok document: ${document.id}`);
        const fileIdCache = getFileIdCache();
        fileIdCache[cacheKey] = newFileId;
        await saveFileCache();
        console.log(`${logPrefix} Saved TikTok file_id ${newFileId} to cache with key ${cacheKey}.`);

        await editStatus('sending_file');
        await sendFileToUser(newFileId, tiktokInfo);
      } catch (error) {
        console.error(`${logPrefix} FAILED during TikTok download/cache for ${tiktokVideoId} (Target: ${targetId}):`, error);
        let userErrorKey = 'inline_cache_upload_failed';
        let errorData = { error: error.message };
        if (error.message?.includes('Download service failed')) {
          userErrorKey = 'tiktok_download_failed';
          errorData = { error: error.message };
        } else if (error?.errorMessage?.includes('FILE_PARTS_INVALID') || error?.message?.includes('too large')) {
          userErrorKey = 'error_telegram_size';
          errorData = {};
        } else if (error?.errorMessage?.includes('FILE_ID_INVALID')) {
          userErrorKey = 'inline_cache_upload_failed';
          errorData = { error: 'Internal cache error.' };
        } else if (error?.errorMessage?.includes('CHAT_NOT_FOUND')) {
          console.error(`${logPrefix} CRITICAL: Cannot send TikTok to target channel ${targetChannelId}. Check permissions/ID.`, error);
          userErrorKey = 'general_error';
          errorData = { error: 'Bot configuration error.' };
          await bot.api
            .sendMessage(botAdminId, `🚨 CRITICAL ERROR: Cannot send TikTok cache file to channel ${targetChannelId} during normal download. Check permissions/ID. Error: ${error.description || error.message}`)
            .catch(() => {});
        }
        await sendErrorReply(userErrorKey, errorData);
      } finally {
        if (fileStreamResponse?.body?.cancel) fileStreamResponse.body.cancel().catch((error) => console.warn(`${logPrefix} Error closing TikTok stream body via cancel():`, error));
        else if (fileStreamResponse?.body?.destroy)
          try {
            fileStreamResponse.body.destroy();
          } catch (error) {
            console.warn(`${logPrefix} Error destroying TikTok stream body:`, error);
          }
        else if (fileStreamResponse?.body?.abort)
          try {
            fileStreamResponse.body.abort();
          } catch (error) {
            console.warn(`${logPrefix} Error aborting TikTok stream body:`, error);
          }
      }
    } catch (error) {
      console.error(`${logPrefix} UNEXPECTED error before TikTok download for ${tiktokVideoId} (Target: ${targetId}):`, error);
      if (error.message?.includes('getTikTokDetailsSafe')) {
        await sendErrorReply('tiktok_metadata_failed', { error: error.message });
      } else {
        await sendErrorReply('general_error', { error: error.message });
      }
    } finally {
      console.log(`${logPrefix} Finished TikTok processing request for ${tiktokVideoId} (Target: ${targetId}).`);
    }
  };

  return { processTikTokDownloadAndCache, processTikTokDownloadRequestNormalWithCache };
};

export { createTikTokDownloads };
