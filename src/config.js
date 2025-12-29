import fs from 'fs/promises';
import path from 'path';

const REQUIRED_CONFIG_KEYS = [
  'BOT_TOKEN',
  'DB_HOST',
  'DB_PORT',
  'DB_USER',
  'DB_PASSWORD',
  'DB_NAME',
  'CA_CERT_PATH',
  'BOT_ADMIN_ID',
];

const BASE_DIR = process.cwd();

const loadConfig = async () => {
  let config;
  try {
    const configPath = path.resolve(BASE_DIR, 'env.json');
    const configFile = await fs.readFile(configPath, 'utf-8');
    config = JSON.parse(configFile);
  } catch (error) {
    console.error('CRITICAL: Error reading or parsing env.json:', error);
    console.error('Please ensure env.json exists in the project root and contains all required fields (BOT_TOKEN, DB_*, CA_CERT_PATH, BOT_ADMIN_ID).');
    process.exit(1);
  }

  for (const key of REQUIRED_CONFIG_KEYS) {
    if (!config[key]) {
      console.error(`CRITICAL: Configuration key "${key}" is missing in env.json!`);
      process.exit(1);
    }
  }

  const botAdminId = Number.parseInt(config.BOT_ADMIN_ID, 10);
  if (Number.isNaN(botAdminId)) {
    console.error(`CRITICAL: BOT_ADMIN_ID ("${config.BOT_ADMIN_ID}") in env.json is not a valid number!`);
    process.exit(1);
  }

  return {
    config,
    constants: {
      botToken: config.BOT_TOKEN,
      botAdminId,
      targetChannelId: -1002505399520,
      expressPort: 30077,
      inlineSearchLimit: 20,
    },
    paths: {
      baseDir: BASE_DIR,
      cacheFilePath: path.resolve(BASE_DIR, 'file_id_cache.json'),
      userLangCachePath: path.resolve(BASE_DIR, 'user_languages.json'),
    },
  };
};

export { loadConfig };
