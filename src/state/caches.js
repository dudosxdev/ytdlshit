import fs from 'fs/promises';

const createCacheStore = (cachePath, label) => {
  let cache = {};

  const load = async () => {
    try {
      const data = await fs.readFile(cachePath, 'utf-8');
      cache = JSON.parse(data);
      console.log(`[${label}] Loaded ${Object.keys(cache).length} entries from ${cachePath}`);
    } catch (error) {
      if (error.code === 'ENOENT') {
        console.log(`[${label}] Cache file ${cachePath} not found. Starting with empty cache.`);
        cache = {};
      } else {
        console.error(`[${label}] Error loading cache file ${cachePath}:`, error);
        cache = {};
      }
    }
  };

  const save = async () => {
    try {
      await fs.writeFile(cachePath, JSON.stringify(cache, null, 2));
    } catch (error) {
      console.error(`[${label}] Error saving cache file ${cachePath}:`, error);
    }
  };

  const getCache = () => cache;
  const setCache = (nextCache) => {
    cache = nextCache;
  };

  return {
    getCache,
    setCache,
    load,
    save,
    cachePath,
  };
};

const createCaches = ({ fileCachePath, langCachePath }) => {
  const fileIdCache = createCacheStore(fileCachePath, 'File Cache');
  const userLangCache = createCacheStore(langCachePath, 'Lang Cache');

  return {
    fileIdCache,
    userLangCache,
  };
};

export { createCaches };
