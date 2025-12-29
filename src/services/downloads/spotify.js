import pkg from 'grammy';
import { downloadSpotifyTrack, getTrackMetadata } from '@opexdevelop/spotify-dl';

const { GrammyError, InputFile } = pkg;

const createSpotifyDownloads = ({
  bot,
  getFileIdCache,
  saveFileCache,
  botAdminId,
  targetChannelId,
  botUsernameSuffix,
  replyOpts,
  editInlineMessageWithFileId,
}) => {
  const handleSpotifyDownloadNormal = async (ctx, trackUrl) => {
    const userId = ctx.from.id;
    const logPrefix = `[Spotify Normal ${userId}]`;
    let statusMessage = null;
    let trackStreamResponse = null;

    try {
      statusMessage = await ctx.reply(ctx.t('processing_spotify'), { parse_mode: undefined });
      await ctx.replyWithChatAction('upload_audio');

      console.log(`${logPrefix} Fetching metadata for ${trackUrl}...`);
      const metadata = await getTrackMetadata(trackUrl, { enableLogging: false });
      if (!metadata || !metadata.name || !metadata.artist) {
        throw new Error(ctx.t('spotify_metadata_failed'));
      }
      console.log(`${logPrefix} Metadata found: "${metadata.name}" by ${metadata.artist}`);

      console.log(`${logPrefix} Requesting download stream...`);
      trackStreamResponse = await downloadSpotifyTrack(trackUrl, null, { enableLogging: false });

      if (!trackStreamResponse || !trackStreamResponse.ok || !trackStreamResponse.body) {
        let errorDetail = `Status: ${trackStreamResponse?.status || 'N/A'}`;
        if (trackStreamResponse && !trackStreamResponse.ok) {
          try {
            errorDetail += `, Body: ${(await trackStreamResponse.text()).substring(0, 100)}`;
          } catch (error) {
            // no-op
          }
        }
        throw new Error(`${ctx.t('spotify_download_failed', { error: 'API stream error' })} (${errorDetail})`);
      }
      console.log(`${logPrefix} Download stream obtained (Content-Type: ${trackStreamResponse.headers.get('content-type')}).`);

      const safeTitle = (metadata.name || ctx.t('fallback_track_title')).replace(/[/\\?%*:|"<>]/g, '-').substring(0, 100);
      const safeArtist = (metadata.artist || 'Unknown Artist').replace(/[/\\?%*:|"<>]/g, '-').substring(0, 50);
      const filename = `${safeArtist} - ${safeTitle}.mp3`;

      const caption = `${metadata.name} - ${metadata.artist}${botUsernameSuffix()}`;

      console.log(`${logPrefix} Sending audio stream as "${filename}"...`);
      await ctx.replyWithAudio(new InputFile(trackStreamResponse.body, filename), {
        caption,
        parse_mode: 'HTML',
        title: metadata.name,
        performer: metadata.artist,
        thumbnail: metadata.cover_url ? new InputFile({ url: metadata.cover_url }) : undefined,
      });
      console.log(`${logPrefix} Successfully sent Spotify track ${metadata.name}`);

      if (statusMessage) {
        await ctx.api.deleteMessage(statusMessage.chat.id, statusMessage.message_id).catch((deleteError) => {
          if (!deleteError.description?.includes('not found')) {
            console.warn(`${logPrefix} Failed to delete status message ${statusMessage.message_id}:`, deleteError.description || deleteError);
          }
        });
      }
    } catch (error) {
      console.error(`${logPrefix} Error processing Spotify link ${trackUrl}:`, error);
      const errorMessage = error.message?.includes('extract metadata') || error.message?.includes('Spotify track details')
        ? ctx.t('spotify_metadata_failed')
        : error.message?.includes('download file') || error.message?.includes('API stream error')
        ? ctx.t('spotify_download_failed', { error: error.message })
        : ctx.t('spotify_api_error', { error: error.message });

      if (statusMessage) {
        await ctx.api
          .editMessageText(statusMessage.chat.id, statusMessage.message_id, errorMessage + botUsernameSuffix(), replyOpts())
          .catch((editError) => {
            console.error(`${logPrefix} Failed to edit status message with error:`, editError);
            ctx.reply(errorMessage + botUsernameSuffix(), replyOpts()).catch((replyError) => console.error(`${logPrefix} Failed even to send error reply:`, replyError));
          });
      } else {
        await ctx.reply(errorMessage + botUsernameSuffix(), replyOpts());
      }
    } finally {
      if (trackStreamResponse?.body && !trackStreamResponse.body.locked && trackStreamResponse.body.cancel) {
        trackStreamResponse.body.cancel().catch((cancelError) => console.warn(`${logPrefix} Error cancelling stream body:`, cancelError));
      }
    }
  };

  const processSpotifyDownloadAndCache = async (ctx, spotifyTrackId, inlineMessageId, cacheKey, metadata) => {
    const userId = ctx.from?.id || ctx.chosenInlineResult?.from?.id || ctx.callbackQuery?.from?.id || 'N/A';
    const logPrefix = `[Spotify Download&Cache ${userId}]`;
    const trackUrl = `https://open.spotify.com/track/${spotifyTrackId}`;
    let trackStreamResponse = null;
    console.log(`${logPrefix} Starting Spotify process for ${spotifyTrackId}. Target: ${targetChannelId}, InlineMsgID: ${inlineMessageId}, CacheKey: ${cacheKey}`);

    if (!metadata) {
      console.error(`${logPrefix} Cannot process Spotify download/cache for ${inlineMessageId}: metadata missing.`);
      try {
        await ctx.api.editMessageTextInline(inlineMessageId, ctx.t('spotify_metadata_failed'), { reply_markup: undefined, parse_mode: undefined });
      } catch (error) {
        return;
      }
      return;
    }

    const setInlineError = async (errorKey = 'inline_error_general', templateData = {}) => {
      console.error(`${logPrefix} Setting inline message ${inlineMessageId} to Spotify error state (${errorKey})`);
      try {
        await ctx.api.editMessageTextInline(inlineMessageId, ctx.t(errorKey, templateData), { reply_markup: undefined, parse_mode: 'HTML' });
      } catch (error) {
        if (!error.description?.includes('not found') && !error.description?.includes("can't be edited")) {
          console.error(`${logPrefix} Failed to edit inline message ${inlineMessageId} to Spotify error state '${errorKey}':`, error.description || error);
        }
      }
    };

    try {
      console.log(`${logPrefix} Requesting Spotify download stream for ${trackUrl}...`);
      trackStreamResponse = await downloadSpotifyTrack(trackUrl, null, { enableLogging: false });

      if (!trackStreamResponse || !trackStreamResponse.ok || !trackStreamResponse.body) {
        let errorDetail = `Status: ${trackStreamResponse?.status || 'N/A'}`;
        if (trackStreamResponse && !trackStreamResponse.ok) {
          try {
            errorDetail += `, Body: ${(await trackStreamResponse.text()).substring(0, 100)}`;
          } catch (error) {
            // no-op
          }
        }
        throw new Error(`Spotify Download service failed. ${errorDetail}`);
      }
      console.log(`${logPrefix} Spotify stream obtained (Content-Type: ${trackStreamResponse.headers.get('content-type')}).`);

      const safeTitle = (metadata.name || ctx.t('fallback_track_title')).replace(/[/\\?%*:|"<>]/g, '-').substring(0, 100);
      const safeArtist = (metadata.artist || 'Unknown Artist').replace(/[/\\?%*:|"<>]/g, '-').substring(0, 50);
      const filename = `${safeArtist} - ${safeTitle}.mp3`;
      console.log(`${logPrefix} Using filename for Spotify channel upload: ${filename}`);

      const inputFile = new InputFile(trackStreamResponse.body, filename);
      const channelCaption = `Cache Spotify: ${spotifyTrackId}`;
      const sendOptions = {
        caption: channelCaption,
        disable_notification: true,
        parse_mode: undefined,
        title: metadata.name,
        performer: metadata.artist,
        thumbnail: metadata.cover_url ? new InputFile({ url: metadata.cover_url }) : undefined,
      };

      console.log(`${logPrefix} Sending Spotify audio to channel ${targetChannelId}...`);
      const sentMessage = await ctx.api.sendAudio(targetChannelId, inputFile, sendOptions);
      console.log(`${logPrefix} Successfully sent Spotify file to channel. Message ID: ${sentMessage.message_id}`);

      const fileId = sentMessage.audio?.file_id;
      if (!fileId) {
        throw new Error('Failed to get Spotify file_id after channel upload.');
      }
      console.log(`${logPrefix} Extracted Spotify file_id: ${fileId}`);

      const fileIdCache = getFileIdCache();
      fileIdCache[cacheKey] = fileId;
      await saveFileCache();
      console.log(`${logPrefix} Saved Spotify file_id ${fileId} to cache with key ${cacheKey}.`);

      await editInlineMessageWithFileId(ctx, inlineMessageId, fileId, 'spotify', metadata);
    } catch (error) {
      console.error(`${logPrefix} FAILED during Spotify download/cache process for ${spotifyTrackId} (InlineMsgID: ${inlineMessageId}):`, error);
      let userErrorKey = 'inline_cache_upload_failed';
      let errorData = { error: error.message };
      if (error.message?.includes('Download service failed')) {
        userErrorKey = 'spotify_download_failed';
        errorData = { error: error.message };
      } else if (error instanceof GrammyError && (error.error_code === 413 || error.description?.includes('too large'))) {
        userErrorKey = 'error_telegram_size';
        errorData = {};
      } else if (error instanceof GrammyError && error.description?.includes('wrong file identifier')) {
        userErrorKey = 'inline_cache_upload_failed';
        errorData = { error: 'Internal cache error.' };
      } else if (error instanceof GrammyError && (error.description?.includes('chat not found') || error.description?.includes('bot is not a participant'))) {
        console.error(`${logPrefix} CRITICAL: Cannot send Spotify to target channel ${targetChannelId}. Check permissions/ID.`, error);
        userErrorKey = 'inline_error_general';
        errorData = { error: 'Bot configuration error.' };
        await bot.api
          .sendMessage(botAdminId, `🚨 CRITICAL ERROR: Cannot send Spotify cache file to channel ${targetChannelId}. Check bot permissions/ID. Error: ${error.description || error.message}`)
          .catch(() => {});
      }
      await setInlineError(userErrorKey, errorData);
    } finally {
      if (trackStreamResponse?.body?.cancel) trackStreamResponse.body.cancel().catch((error) => console.warn(`${logPrefix} Error closing Spotify stream body via cancel():`, error));
      else if (trackStreamResponse?.body?.destroy)
        try {
          trackStreamResponse.body.destroy();
        } catch (error) {
          console.warn(`${logPrefix} Error destroying Spotify stream body:`, error);
        }
      else if (trackStreamResponse?.body?.abort)
        try {
          trackStreamResponse.body.abort();
        } catch (error) {
          console.warn(`${logPrefix} Error aborting Spotify stream body:`, error);
        }
      console.log(`${logPrefix} Finished Spotify processing request for ${spotifyTrackId} (InlineMsgID: ${inlineMessageId}).`);
    }
  };

  return { handleSpotifyDownloadNormal, processSpotifyDownloadAndCache };
};

export { createSpotifyDownloads };
