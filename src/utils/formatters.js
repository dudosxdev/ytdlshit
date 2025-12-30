const audioQualityStrings = ['96kbps', '128kbps', '256kbps', '320kbps'];
const videoQualityStrings = ['360p', '480p', '720p', '1080p'];

const getQualityDisplay = (ctx, qualityString) => ctx.t(qualityString, qualityString);

const replyOpts = () => ({ parse_mode: 'HTML', disable_web_page_preview: true });

export { audioQualityStrings, videoQualityStrings, getQualityDisplay, replyOpts };
