import pkg from 'grammy';
import { getYouTubeVideoId } from 'opex-yt-id';
import { getTrackMetadata } from '@opexdevelop/spotify-dl';
import { searchVideos } from 'opex-yt-info';

const { InlineKeyboard } = pkg;

const registerInlineHandlers = ({
  bot,
  config,
  inlineSearchLimit,
  audioQualityStrings,
  videoQualityStrings,
  getQualityDisplay,
  getVideoDetailsSafe,
  getTikTokDetailsSafe,
  getSpotifyTrackId,
  isTikTokUrl,
  fileIdCacheStore,
  processYouTubeDownloadAndCache,
  processSpotifyDownloadAndCache,
  processTikTokDownloadAndCache,
  editInlineMessageWithFileId,
}) => {
  const processingKeyboard = new InlineKeyboard().text('⏳', 'inline_ignore');

  bot.on('inline_query', async (ctx) => {
    const query = ctx.inlineQuery.query.trim();
    const userId = ctx.inlineQuery.from.id;
    const offset = Number.parseInt(ctx.inlineQuery.offset, 10) || 0;
    const lang = ctx.lang || 'en';

    if (!query) {
      try {
        await ctx.answerInlineQuery([], {
          cache_time: 10,
          switch_pm_text: ctx.t('inline_search_prompt'),
          switch_pm_parameter: 'inline_help',
        });
      } catch (error) {
        console.error(`[Inline Query ${userId}] Error answering empty query prompt:`, error);
      }
      return;
    }

    const youtubeId = getYouTubeVideoId(query);
    const spotifyTrackId = getSpotifyTrackId(query);
    const isTikTok = isTikTokUrl(query);

    if (youtubeId) {
      console.log(`[Inline Query ${userId}] Received valid YouTube URL for ID: ${youtubeId}. Generating YT results...`);
      try {
        const videoDetails = await getVideoDetailsSafe(youtubeId);
        const videoTitle = videoDetails?.title || ctx.t('fallback_video_title');

        if (!videoDetails) {
          console.warn(`[Inline Query ${userId}] Could not fetch YT details for ${youtubeId}. Sending error.`);
          await ctx.answerInlineQuery([
            {
              type: 'article',
              id: `error_yt:${youtubeId}`,
              title: ctx.t('error_fetching_title'),
              input_message_content: { message_text: ctx.t('error_fetching_title'), parse_mode: undefined },
            },
          ], { cache_time: 5 });
          return;
        }

        const results = [];
        const initialMessageText = ctx.t('inline_processing');

        [...audioQualityStrings].sort((a, b) => Number.parseInt(a, 10) - Number.parseInt(b, 10)).forEach((qualityString) => {
          const qualityName = getQualityDisplay(ctx, qualityString);
          const resultId = `dl_yt:${youtubeId}:mp3:${qualityString}`;
          results.push({
            type: 'article',
            id: resultId,
            title: ctx.t('inline_result_title', { format: 'MP3', quality: qualityName }),
            description: ctx.t('inline_description_direct', { title: videoTitle, format: 'MP3', quality: qualityName }),
            reply_markup: processingKeyboard,
            input_message_content: { message_text: initialMessageText, parse_mode: 'HTML', disable_web_page_preview: true },
            thumbnail_url: videoDetails.thumbnail || undefined,
          });
        });

        [...videoQualityStrings].sort((a, b) => Number.parseInt(a, 10) - Number.parseInt(b, 10)).forEach((qualityString) => {
          const qualityName = getQualityDisplay(ctx, qualityString);
          const resultId = `dl_yt:${youtubeId}:mp4:${qualityString}`;
          results.push({
            type: 'article',
            id: resultId,
            title: ctx.t('inline_result_title', { format: 'MP4', quality: qualityName }),
            description: ctx.t('inline_description_direct', { title: videoTitle, format: 'MP4', quality: qualityName }),
            reply_markup: processingKeyboard,
            input_message_content: { message_text: initialMessageText, parse_mode: 'HTML', disable_web_page_preview: true },
            thumbnail_url: videoDetails.thumbnail || undefined,
          });
        });

        await ctx.answerInlineQuery(results, { cache_time: 60 });
        console.log(`[Inline Query ${userId}] Sent ${results.length} YT download results for ${youtubeId}`);
      } catch (error) {
        console.error(`[Inline Query ${userId}] Error processing YT link ${youtubeId}:`, error);
        try {
          await ctx.answerInlineQuery([], { cache_time: 5 });
        } catch (replyError) {
          // no-op
        }
      }
      return;
    }

    if (spotifyTrackId) {
      console.log(`[Inline Query ${userId}] Received valid Spotify URL for ID: ${spotifyTrackId}. Generating Spotify result...`);
      try {
        const metadata = await getTrackMetadata(query, { enableLogging: false });
        if (!metadata || !metadata.name || !metadata.artist) {
          console.warn(`[Inline Query ${userId}] Could not fetch Spotify details for ${spotifyTrackId}. Sending error.`);
          await ctx.answerInlineQuery([
            {
              type: 'article',
              id: `error_spotify:${spotifyTrackId}`,
              title: ctx.t('spotify_metadata_failed'),
              input_message_content: { message_text: ctx.t('spotify_metadata_failed'), parse_mode: undefined },
            },
          ], { cache_time: 5 });
          return;
        }

        const resultId = `dl_spotify:${spotifyTrackId}`;
        const trackTitle = metadata.name || ctx.t('fallback_track_title');
        const artistName = metadata.artist || 'Unknown Artist';

        const result = {
          type: 'article',
          id: resultId,
          title: trackTitle,
          description: ctx.t('inline_description_spotify', { title: trackTitle, artist: artistName }),
          thumbnail_url: metadata.cover_url || undefined,
          reply_markup: processingKeyboard,
          input_message_content: {
            message_text: ctx.t('inline_processing'),
            parse_mode: 'HTML',
            disable_web_page_preview: true,
          },
        };

        await ctx.answerInlineQuery([result], { cache_time: 60 });
        console.log(`[Inline Query ${userId}] Sent Spotify download result for ${spotifyTrackId}`);
      } catch (error) {
        console.error(`[Inline Query ${userId}] Error processing Spotify link ${spotifyTrackId}:`, error);
        await ctx
          .answerInlineQuery([
            {
              type: 'article',
              id: `error_spotify:${spotifyTrackId}`,
              title: ctx.t('spotify_api_error', { error: '' }),
              input_message_content: { message_text: ctx.t('spotify_api_error', { error: error.message }), parse_mode: undefined },
            },
          ], { cache_time: 5 })
          .catch(() => {});
      }
      return;
    }

    if (isTikTok) {
      console.log(`[Inline Query ${userId}] Received valid TikTok URL: ${query}. Generating TikTok results...`);
      try {
        const tiktokInfo = await getTikTokDetailsSafe(query);
        if (!tiktokInfo || !tiktokInfo.videoId) {
          console.warn(`[Inline Query ${userId}] Could not fetch TikTok details for ${query}. Sending error.`);
          await ctx.answerInlineQuery([
            {
              type: 'article',
              id: `error_tk:${Date.now()}`,
              title: ctx.t('tiktok_metadata_failed'),
              input_message_content: { message_text: ctx.t('tiktok_metadata_failed'), parse_mode: undefined },
            },
          ], { cache_time: 5 });
          return;
        }

        const tiktokVideoId = tiktokInfo.videoId;
        const videoTitle = tiktokInfo.description?.substring(0, 70) || ctx.t('fallback_tiktok_title');
        const results = [];
        const initialMessageText = ctx.t('inline_processing');

        results.push({
          type: 'article',
          id: `dl_tk:${tiktokVideoId}:mp3`,
          title: ctx.t('inline_result_title_tiktok', { format: 'MP3' }),
          description: ctx.t('inline_description_tiktok', { title: videoTitle, format: 'MP3' }),
          reply_markup: processingKeyboard,
          input_message_content: { message_text: initialMessageText, parse_mode: 'HTML', disable_web_page_preview: true },
          thumbnail_url: tiktokInfo.thumbnailUrl || undefined,
        });

        results.push({
          type: 'article',
          id: `dl_tk:${tiktokVideoId}:mp4`,
          title: ctx.t('inline_result_title_tiktok', { format: 'MP4' }),
          description: ctx.t('inline_description_tiktok', { title: videoTitle, format: 'MP4' }),
          reply_markup: processingKeyboard,
          input_message_content: { message_text: initialMessageText, parse_mode: 'HTML', disable_web_page_preview: true },
          thumbnail_url: tiktokInfo.thumbnailUrl || undefined,
        });

        await ctx.answerInlineQuery(results, { cache_time: 60 });
        console.log(`[Inline Query ${userId}] Sent ${results.length} TikTok download results for ${tiktokVideoId}`);
      } catch (error) {
        console.error(`[Inline Query ${userId}] Error processing TikTok link ${query}:`, error);
        await ctx
          .answerInlineQuery([
            {
              type: 'article',
              id: `error_tk:${Date.now()}`,
              title: ctx.t('tiktok_api_error', { error: '' }),
              input_message_content: { message_text: ctx.t('tiktok_api_error', { error: error.message }), parse_mode: undefined },
            },
          ], { cache_time: 5 })
          .catch(() => {});
      }
      return;
    }

    console.log(`[Inline Query ${userId}] Received YT search query: "${query}". Offset: ${offset}. Searching videos...`);
    try {
      const searchResults = await searchVideos(query, { hl: lang, gl: config.DEFAULT_GL || 'US', pageEnd: 1 });

      if (!searchResults || searchResults.length === 0) {
        console.log(`[Inline Query ${userId}] No YT search results found for "${query}".`);
        await ctx.answerInlineQuery([
          {
            type: 'article',
            id: 'no_results',
            title: ctx.t('inline_search_no_results', { query }),
            input_message_content: { message_text: ctx.t('inline_search_no_results', { query }), parse_mode: undefined },
          },
        ], { cache_time: 10 });
        return;
      }

      console.log(`[Inline Query ${userId}] Found ${searchResults.length} YT videos for "${query}". Mapping...`);

      const results = searchResults.slice(0, inlineSearchLimit).map((video) => {
        const resultId = `srch_res_yt:${video.videoId}`;
        const viewsText = video.views?.toLocaleString(lang === 'ru' ? 'ru-RU' : 'en-US') ?? '?';
        const videoTitle = video.title || ctx.t('fallback_video_title');

        const combinedKeyboard = new InlineKeyboard();
        const buttonRows = [];
        audioQualityStrings.forEach((q) => buttonRows.push({ text: `MP3 ${getQualityDisplay(ctx, q)}`, callback_data: `inline_dl_yt:${video.videoId}:mp3:${q}` }));
        videoQualityStrings.forEach((q) => buttonRows.push({ text: `MP4 ${getQualityDisplay(ctx, q)}`, callback_data: `inline_dl_yt:${video.videoId}:mp4:${q}` }));
        for (let i = 0; i < buttonRows.length; i += 2) {
          combinedKeyboard.row(...buttonRows.slice(i, i + 2).map((btn) => InlineKeyboard.text(btn.text, btn.callback_data)));
        }

        return {
          type: 'article',
          id: resultId,
          title: videoTitle,
          description: ctx.t('inline_search_result_description', {
            author: video.author?.name || 'Unknown',
            views: viewsText,
            duration: video.timestamp || '?:??',
          }),
          thumbnail_url: video.thumbnail || undefined,
          input_message_content: {
            message_text: ctx.t('inline_search_select_final', { title: videoTitle }),
            parse_mode: 'HTML',
            disable_web_page_preview: true,
          },
          reply_markup: combinedKeyboard,
        };
      });

      await ctx.answerInlineQuery(results, { cache_time: 30 });
      console.log(`[Inline Query ${userId}] Sent ${results.length} YT search results for "${query}".`);
    } catch (error) {
      console.error(`[Inline Query ${userId}] Error during YouTube search for "${query}":`, error);
      try {
        await ctx.answerInlineQuery([
          {
            type: 'article',
            id: 'search_error',
            title: ctx.t('inline_search_error'),
            input_message_content: { message_text: ctx.t('inline_search_error'), parse_mode: undefined },
          },
        ], { cache_time: 5 });
      } catch (replyError) {
        console.error(`[Inline Query ${userId}] Failed to answer with search error:`, replyError);
      }
    }
  });

  bot.on('chosen_inline_result', async (ctx) => {
    const resultId = ctx.chosenInlineResult.result_id;
    const inlineMessageId = ctx.chosenInlineResult.inline_message_id;
    const userId = ctx.chosenInlineResult.from.id;
    const query = ctx.chosenInlineResult.query;
    const lang = ctx.lang || 'en';

    console.log(`[Chosen Inline ${userId}] Result ID: ${resultId}, InlineMsgID: ${inlineMessageId}, Query: "${query}"`);

    if (!inlineMessageId) {
      console.error(`[Chosen Inline ${userId}] CRITICAL: No inline_message_id received for result_id: ${resultId}. Cannot proceed.`);
      return;
    }

    const directDownloadMatchYT = resultId.match(/^dl_yt:([a-zA-Z0-9_-]{11}):(mp3|mp4):([a-zA-Z0-9]+(?:kbps|p))$/);
    if (directDownloadMatchYT) {
      const [, youtubeId, formatString, chosenQualityString] = directDownloadMatchYT;
      const cacheKey = `yt:${youtubeId}:${formatString}:${chosenQualityString}`;
      console.log(`[Chosen Inline ${userId}] YT Direct DL chosen - ID: ${youtubeId}, Format: ${formatString}, Quality: ${chosenQualityString}. Cache key: ${cacheKey}`);

      const videoDetails = await getVideoDetailsSafe(youtubeId);
      const videoTitle = videoDetails?.title || ctx.t('fallback_video_title');
      const qualityDisplayName = getQualityDisplay(ctx, chosenQualityString);

      try {
        await ctx.api
          .editMessageTextInline(
            inlineMessageId,
            ctx.t('inline_processing_final', { title: videoTitle, format: formatString.toUpperCase(), quality: qualityDisplayName }),
            { reply_markup: processingKeyboard, parse_mode: 'HTML' },
          )
          .catch((error) => {
            if (!error.description?.includes('modified')) console.warn('[Chosen Inline YT dl:] Edit failed:', error.description || error);
          });
      } catch (editError) {
        console.error(`[Chosen Inline YT dl:] Error editing message ${inlineMessageId}:`, editError);
      }

      const cachedFileId = fileIdCacheStore.getCache()[cacheKey];
      if (cachedFileId && videoDetails) {
        console.log(`[Chosen Inline ${userId}] Cache HIT for YT ${cacheKey}. Editing message.`);
        await editInlineMessageWithFileId(ctx, inlineMessageId, cachedFileId, `yt_${formatString}`, videoDetails);
      } else {
        console.log(`[Chosen Inline ${userId}] Cache MISS for YT ${cacheKey}. Starting download & cache.`);
        if (videoDetails) {
          await processYouTubeDownloadAndCache(ctx, youtubeId, formatString, chosenQualityString, inlineMessageId, cacheKey, videoDetails);
        } else {
          console.error(`[Chosen Inline ${userId}] Cannot process YT ${cacheKey}: Failed to get video details.`);
          await ctx.api.editMessageTextInline(inlineMessageId, ctx.t('error_fetching_title'), { reply_markup: undefined, parse_mode: undefined }).catch(() => {});
        }
      }
      return;
    }

    const spotifyDownloadMatch = resultId.match(/^dl_spotify:([a-zA-Z0-9]+)$/);
    if (spotifyDownloadMatch) {
      const [, spotifyTrackId] = spotifyDownloadMatch;
      const cacheKey = `spotify:${spotifyTrackId}`;
      console.log(`[Chosen Inline ${userId}] Spotify DL chosen - ID: ${spotifyTrackId}. Cache key: ${cacheKey}`);

      let metadata;
      try {
        metadata = await getTrackMetadata(`https://open.spotify.com/track/${spotifyTrackId}`, { enableLogging: false });
      } catch (metaError) {
        console.error(`[Chosen Inline Spotify] Failed to get metadata for ${spotifyTrackId}:`, metaError);
        await ctx.api.editMessageTextInline(inlineMessageId, ctx.t('spotify_metadata_failed'), { reply_markup: undefined, parse_mode: undefined }).catch(() => {});
        return;
      }

      const trackTitle = metadata?.name || ctx.t('fallback_track_title');

      try {
        await ctx.api
          .editMessageTextInline(inlineMessageId, ctx.t('inline_processing_spotify', { title: trackTitle }), { reply_markup: processingKeyboard, parse_mode: 'HTML' })
          .catch((error) => {
            if (!error.description?.includes('modified')) console.warn('[Chosen Inline Spotify dl:] Edit failed:', error.description || error);
          });
      } catch (editError) {
        console.error(`[Chosen Inline Spotify dl:] Error editing message ${inlineMessageId}:`, editError);
      }

      const cachedFileId = fileIdCacheStore.getCache()[cacheKey];
      if (cachedFileId && metadata) {
        console.log(`[Chosen Inline ${userId}] Cache HIT for Spotify ${cacheKey}. Editing message.`);
        await editInlineMessageWithFileId(ctx, inlineMessageId, cachedFileId, 'spotify', metadata);
      } else {
        console.log(`[Chosen Inline ${userId}] Cache MISS for Spotify ${cacheKey}. Starting download & cache.`);
        if (metadata) {
          await processSpotifyDownloadAndCache(ctx, spotifyTrackId, inlineMessageId, cacheKey, metadata);
        } else {
          console.error(`[Chosen Inline ${userId}] Cannot process Spotify ${cacheKey}: Metadata missing.`);
          await ctx.api.editMessageTextInline(inlineMessageId, ctx.t('spotify_metadata_failed'), { reply_markup: undefined, parse_mode: undefined }).catch(() => {});
        }
      }
      return;
    }

    const directDownloadMatchTK = resultId.match(/^dl_tk:([a-zA-Z0-9_]+):(mp3|mp4)$/);
    if (directDownloadMatchTK) {
      const [, tiktokVideoId, formatString] = directDownloadMatchTK;
      const cacheKey = `tk:${tiktokVideoId}:${formatString}`;
      console.log(`[Chosen Inline ${userId}] TikTok Direct DL chosen - ID: ${tiktokVideoId}, Format: ${formatString}. Cache key: ${cacheKey}`);

      let tiktokInfo;
      let tiktokUrl = query;
      try {
        if (!isTikTokUrl(tiktokUrl)) {
          tiktokUrl = `https://www.tiktok.com/video/${tiktokVideoId}`;
          console.warn(`[Chosen Inline TikTok dl:] Query "${query}" is not a TikTok URL. Using fallback: ${tiktokUrl}`);
        }
        tiktokInfo = await getTikTokDetailsSafe(tiktokUrl);
      } catch (infoError) {
        console.error(`[Chosen Inline TikTok dl:] Failed to get TikTok info for ${tiktokVideoId} using URL ${tiktokUrl}:`, infoError);
        await ctx.api.editMessageTextInline(inlineMessageId, ctx.t('tiktok_metadata_failed'), { reply_markup: undefined, parse_mode: undefined }).catch(() => {});
        return;
      }

      if (!tiktokInfo) {
        console.error(`[Chosen Inline TikTok dl:] getTikTokDetailsSafe returned null for ${tiktokVideoId}.`);
        await ctx.api.editMessageTextInline(inlineMessageId, ctx.t('tiktok_metadata_failed'), { reply_markup: undefined, parse_mode: undefined }).catch(() => {});
        return;
      }

      const videoTitle = tiktokInfo.description?.substring(0, 70) || ctx.t('fallback_tiktok_title');

      try {
        await ctx.api
          .editMessageTextInline(
            inlineMessageId,
            ctx.t('inline_processing_tiktok', { title: videoTitle, format: formatString.toUpperCase() }),
            { reply_markup: processingKeyboard, parse_mode: 'HTML' },
          )
          .catch((error) => {
            if (!error.description?.includes('modified')) console.warn('[Chosen Inline TikTok dl:] Edit failed:', error.description || error);
          });
      } catch (editError) {
        console.error(`[Chosen Inline TikTok dl:] Error editing message ${inlineMessageId}:`, editError);
      }

      const cachedFileId = fileIdCacheStore.getCache()[cacheKey];
      if (cachedFileId) {
        console.log(`[Chosen Inline ${userId}] Cache HIT for TikTok ${cacheKey}. Editing message.`);
        await editInlineMessageWithFileId(ctx, inlineMessageId, cachedFileId, `tk_${formatString}`, tiktokInfo);
      } else {
        console.log(`[Chosen Inline ${userId}] Cache MISS for TikTok ${cacheKey}. Starting download & cache.`);
        await processTikTokDownloadAndCache(ctx, tiktokVideoId, tiktokUrl, formatString, inlineMessageId, cacheKey, tiktokInfo);
      }
      return;
    }

    const searchResultMatchYT = resultId.match(/^srch_res_yt:([a-zA-Z0-9_-]{11})$/);
    if (searchResultMatchYT) {
      const [, youtubeId] = searchResultMatchYT;
      console.log(`[Chosen Inline ${userId}] YT Search result chosen for ${youtubeId}. Message ${inlineMessageId} now shows quality options.`);
      return;
    }

    console.error(`[Chosen Inline ${userId}] Invalid or unexpected result_id format: ${resultId}. Editing message to error.`);
    try {
      await ctx.api.editMessageTextInline(inlineMessageId, ctx.t('error_unexpected_action'), { reply_markup: undefined, parse_mode: undefined });
    } catch (error) {
      if (
        !error.description?.includes('not found') &&
        !error.description?.includes("can't be edited") &&
        !error.description?.includes('is invalid')
      ) {
        console.error(`[Chosen Inline ${userId}] Failed to edit inline message [${inlineMessageId}] with error:`, error.description || error);
      }
    }
  });

  bot.callbackQuery(/^inline_dl_yt:([a-zA-Z0-9_-]{11}):(mp3|mp4):([a-zA-Z0-9]+(?:kbps|p))$/, async (ctx) => {
    const youtubeId = ctx.match[1];
    const formatString = ctx.match[2];
    const chosenQualityString = ctx.match[3];
    const userId = ctx.from.id;
    const inlineMessageId = ctx.callbackQuery.inline_message_id;

    if (!inlineMessageId) {
      console.error(`[Callback inline_dl_yt] User ${userId} - CRITICAL: No inline_message_id for YT ${youtubeId}:${formatString}:${chosenQualityString}.`);
      await ctx.answerCallbackQuery({ text: ctx.t('error_unexpected_action'), show_alert: true });
      return;
    }

    console.log(`[Callback inline_dl_yt] User ${userId} chose quality ${chosenQualityString} (Format: ${formatString}) for YT ${youtubeId} via inline msg ${inlineMessageId}.`);

    await ctx.answerCallbackQuery({ text: ctx.t('requesting_download') });

    try {
      const videoDetails = await getVideoDetailsSafe(youtubeId);
      const videoTitle = videoDetails?.title || ctx.t('fallback_video_title');
      const qualityDisplayName = getQualityDisplay(ctx, chosenQualityString);

      await ctx.api
        .editMessageTextInline(
          inlineMessageId,
          ctx.t('inline_processing_final', { title: videoTitle, format: formatString.toUpperCase(), quality: qualityDisplayName }),
          { reply_markup: processingKeyboard, parse_mode: 'HTML' },
        )
        .catch((error) => {
          if (!error.description?.includes('modified')) console.warn('[Callback inline_dl_yt] Edit failed:', error.description || error);
        });

      const cacheKey = `yt:${youtubeId}:${formatString}:${chosenQualityString}`;
      const cachedFileId = fileIdCacheStore.getCache()[cacheKey];

      if (cachedFileId && videoDetails) {
        console.log(`[Callback inline_dl_yt] Cache HIT for ${cacheKey}. Editing message ${inlineMessageId}.`);
        await editInlineMessageWithFileId(ctx, inlineMessageId, cachedFileId, `yt_${formatString}`, videoDetails);
      } else {
        console.log(`[Callback inline_dl_yt] Cache MISS for ${cacheKey}. Starting download & cache for ${inlineMessageId}.`);
        if (videoDetails) {
          await processYouTubeDownloadAndCache(ctx, youtubeId, formatString, chosenQualityString, inlineMessageId, cacheKey, videoDetails);
        } else {
          console.error(`[Callback inline_dl_yt] Cannot process ${cacheKey}: Failed to get YT details.`);
          await ctx.api.editMessageTextInline(inlineMessageId, ctx.t('error_fetching_title'), { reply_markup: undefined, parse_mode: undefined }).catch(() => {});
        }
      }
    } catch (error) {
      console.error(`[Callback inline_dl_yt] User ${userId} - Error handling YT quality selection for ${inlineMessageId}:`, error);
      try {
        await ctx.api.editMessageTextInline(inlineMessageId, ctx.t('inline_error_general'), { reply_markup: undefined, parse_mode: undefined });
      } catch (editError) {
        if (!editError.description?.includes('not found')) {
          console.error(`[Callback inline_dl_yt] Failed to set error state for ${inlineMessageId}:`, editError.description || editError);
        }
      }
    }
  });

  bot.callbackQuery('inline_ignore', async (ctx) => {
    await ctx.answerCallbackQuery();
  });
};

export { registerInlineHandlers };
