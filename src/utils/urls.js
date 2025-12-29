const getSpotifyTrackId = (url) => {
  try {
    const trackUrl = new URL(url);
    if (trackUrl.hostname === 'open.spotify.com' && trackUrl.pathname.startsWith('/track/')) {
      const parts = trackUrl.pathname.split('/');
      if (parts.length >= 3 && parts[2]) {
        return parts[2];
      }
    }
  } catch (error) {
    return null;
  }
  return null;
};

const isTikTokUrl = (url) => {
  try {
    const parsedUrl = new URL(url);
    return parsedUrl.hostname.endsWith('tiktok.com');
  } catch (error) {
    return false;
  }
};

export { getSpotifyTrackId, isTikTokUrl };
