import { getVideo } from 'opex-yt-info';
import { getTikTokInfo } from '@opexdevelop/tiktok-dl';

const getVideoDetailsSafe = async (youtubeId) => {
  try {
    const videoInfo = await getVideo(youtubeId);
    if (videoInfo) {
      return videoInfo;
    }
    console.warn(`[Video Details Fetch] getVideo(${youtubeId}) returned null.`);
    return null;
  } catch (error) {
    console.error(`[Video Details Fetch] Failed for ${youtubeId} using getVideo:`, error.message);
    return null;
  }
};

const getTikTokDetailsSafe = async (tiktokUrl) => {
  try {
    const videoInfo = await getTikTokInfo(tiktokUrl, { enableLogging: false });
    if (videoInfo && videoInfo.videoId) {
      return videoInfo;
    }
    console.warn(`[TikTok Details Fetch] getTikTokInfo(${tiktokUrl}) returned null or missing videoId.`);
    return null;
  } catch (error) {
    console.error(`[TikTok Details Fetch] Failed for ${tiktokUrl} using getTikTokInfo:`, error.message);
    return null;
  }
};

export { getVideoDetailsSafe, getTikTokDetailsSafe };
