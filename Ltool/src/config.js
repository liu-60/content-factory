import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';
import { randomBytes } from 'node:crypto';

const CONFIG_PATH = join(homedir(), '.ltool', 'config.json');

const DEFAULT_CONFIG = {
  wsPort: 9527,
  token: '',
  requestTimeoutMs: 360000,
};

export function showConfigPath() {
  return CONFIG_PATH;
}

export function getConfig() {
  if (!existsSync(CONFIG_PATH)) {
    const config = { ...DEFAULT_CONFIG, token: randomBytes(24).toString('hex') };
    saveConfig(config);
    return config;
  }
  try {
    return { ...DEFAULT_CONFIG, ...JSON.parse(readFileSync(CONFIG_PATH, 'utf8')) };
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

export function saveConfig(config) {
  mkdirSync(dirname(CONFIG_PATH), { recursive: true });
  writeFileSync(CONFIG_PATH, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
}

export function setToken(token) {
  saveConfig({ ...getConfig(), token });
}

export function clearToken() {
  saveConfig({ ...getConfig(), token: '' });
}
