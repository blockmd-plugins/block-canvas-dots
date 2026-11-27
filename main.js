import { serve, callHost } from '/runtime/block-sdk.js';

const STORAGE_KEY = 'config';
const SETTINGS_PAGE_SURFACE = 'settings_page';
const SUPPORTED_SURFACES = new Set([SETTINGS_PAGE_SURFACE]);

const GRID_MODES = ['off', 'grid', 'dots'];
const GRID_STRENGTHS = ['standard', 'high'];
const DISPLAY_SCOPES = ['editor', 'window'];
const LEGACY_STRENGTH_MAP = {
  normal: 'standard',
  strong: 'high',
};
const LEGACY_SCOPE_MAP = {
  fullscreen: 'window',
  full: 'window',
};
const DEFAULT_CONFIG = { grid_mode: 'dots', grid_strength: 'standard', display_scope: 'editor' };
const CHINESE_TEXT = /[\u3000-\u303f\u4e00-\u9fff\uff00-\uffef]/;

const TEXTS = {
  zh: {
    page_title: '编辑器背景',
    card_title: '背景样式',
    reset_default: '恢复默认',
    reset_done: '已恢复默认设置',
    grid_mode_label: '背景网格',
    grid_modes: { off: '无', grid: '方格', dots: '点阵' },
    grid_strength_label: '对比度',
    grid_strengths: { standard: '标准', high: '高对比' },
    display_scope_label: '显示范围',
    display_scopes: { editor: '正文区域', window: '铺满编辑区' },
    unknown_action: '未知操作：{action}',
    unsupported_surface: '不支持的界面：{surface}',
    unsupported_method: '不支持的方法：{method}',
  },
  en: {
    page_title: 'Editor Background',
    card_title: 'Background Style',
    reset_default: 'Reset Default',
    reset_done: 'Reset to default settings',
    grid_mode_label: 'Background Grid',
    grid_modes: { off: 'Off', grid: 'Grid', dots: 'Dots' },
    grid_strength_label: 'Contrast',
    grid_strengths: { standard: 'Standard', high: 'High' },
    display_scope_label: 'Display Scope',
    display_scopes: { editor: 'Text Column', window: 'Full Editor' },
    unknown_action: 'Unknown action: {action}',
    unsupported_surface: 'Unsupported surface: {surface}',
    unsupported_method: 'Unsupported method: {method}',
  },
};

let locale = 'zh';
let hostSupportsScope = null;

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isEn() {
  return String(locale || '').trim().toLowerCase().startsWith('en');
}

function text() {
  return isEn() ? TEXTS.en : TEXTS.zh;
}

function localizeError(message) {
  const raw = String(message || '').trim();
  if (isEn() && CHINESE_TEXT.test(raw)) {
    return 'Operation failed';
  }
  return raw || (isEn() ? 'Operation failed' : '操作失败');
}

function normalize(cfg) {
  const out = { ...DEFAULT_CONFIG };
  if (!isPlainObject(cfg)) {
    return out;
  }
  const mode = String(cfg.grid_mode ?? '').trim().toLowerCase();
  if (GRID_MODES.includes(mode)) {
    out.grid_mode = mode;
  }
  let strength = String(cfg.grid_strength ?? '').trim().toLowerCase();
  strength = LEGACY_STRENGTH_MAP[strength] || strength;
  if (GRID_STRENGTHS.includes(strength)) {
    out.grid_strength = strength;
  }
  let scope = String(cfg.display_scope ?? '').trim().toLowerCase();
  scope = LEGACY_SCOPE_MAP[scope] || scope;
  if (DISPLAY_SCOPES.includes(scope)) {
    out.display_scope = scope;
  }
  return out;
}

function mergeValues(cfg, values) {
  if (!isPlainObject(values)) {
    return normalize(cfg);
  }
  const merged = { ...cfg };
  for (const key of ['grid_mode', 'grid_strength', 'display_scope']) {
    if (typeof values[key] === 'string') {
      merged[key] = values[key];
    }
  }
  return normalize(merged);
}

function loadConfig() {
  try {
    const res = callHost('host.storage.get', { key: STORAGE_KEY });
    if (isPlainObject(res) && res.found && isPlainObject(res.value)) {
      return normalize(res.value);
    }
  } catch (err) {
    if (!err || err.code !== -32601) {
      throw err;
    }
  }
  return { ...DEFAULT_CONFIG };
}

function saveConfig(cfg) {
  try {
    callHost('host.storage.set', { key: STORAGE_KEY, value: cfg });
  } catch (err) {
    if (!err || err.code !== -32601) {
      throw err;
    }
  }
}

function updateScopeSupport(res) {
  if (isPlainObject(res)) {
    hostSupportsScope = typeof res.scope === 'string' && res.scope.trim() !== '';
  }
}

function probeScopeSupport() {
  if (hostSupportsScope !== null) {
    return hostSupportsScope;
  }
  try {
    const res = callHost('host.ui.backdrop', {});
    updateScopeSupport(res);
  } catch (err) {
    if (err && err.code === -32601) {
      return true;
    }
    throw err;
  }
  return hostSupportsScope !== false;
}

function effectiveConfig(cfg) {
  if (hostSupportsScope === false && cfg.display_scope !== 'editor') {
    return { ...cfg, display_scope: 'editor' };
  }
  return cfg;
}

function syncHostBackground(cfg) {
  const isGrid = cfg.grid_mode === 'grid';
  try {
    const res = callHost('host.ui.set_backdrop', {
      id: isGrid ? 'paper-grid' : 'paper-dots',
      enabled: cfg.grid_mode !== 'off',
      pattern: isGrid ? 'paper_grid' : 'paper_dots',
      contrast: cfg.grid_strength,
      scope: cfg.display_scope,
    });
    updateScopeSupport(res);
    return res;
  } catch (err) {
    if (err && err.code === -32601) {
      return null;
    }
    throw err;
  }
}

function validateSurface(params) {
  const surface = String((params && params.surface) || SETTINGS_PAGE_SURFACE).trim() || SETTINGS_PAGE_SURFACE;
  if (!SUPPORTED_SURFACES.has(surface)) {
    throw new Error(text().unsupported_surface.replace('{surface}', surface));
  }
  return surface;
}

function buildPage(cfg, status = '') {
  const t = text();
  const visibleCfg = effectiveConfig(cfg);
  const items = [
    {
      kind: 'segmented',
      id: 'grid_mode',
      label: t.grid_mode_label,
      value: visibleCfg.grid_mode,
      options: GRID_MODES.map((k) => ({ value: k, label: t.grid_modes[k] })),
    },
    {
      kind: 'segmented',
      id: 'grid_strength',
      label: t.grid_strength_label,
      value: visibleCfg.grid_strength,
      options: GRID_STRENGTHS.map((k) => ({ value: k, label: t.grid_strengths[k] })),
    },
  ];
  if (hostSupportsScope !== false) {
    items.push({
      kind: 'segmented',
      id: 'display_scope',
      label: t.display_scope_label,
      value: visibleCfg.display_scope,
      options: DISPLAY_SCOPES.map((k) => ({ value: k, label: t.display_scopes[k] })),
    });
  }
  return {
    title: t.page_title,
    status,
    header_actions: [
      { id: 'reset_default', label: t.reset_default, variant: 'secondary' },
    ],
    cards: [
      {
        id: 'canvas-card',
        title: t.card_title,
        items,
      },
    ],
  };
}

function handle(method, params) {
  if (method === 'plugin.initialize') {
    const rawLocale = String(params.locale || '').trim().toLowerCase();
    locale = rawLocale.startsWith('en') ? 'en' : 'zh';
    const cfg = loadConfig();
    syncHostBackground(cfg);
    return { ready: true };
  }

  if (method === 'plugin.render') {
    validateSurface(params);
    let cfg = loadConfig();
    const values = params.values;
    if (
      isPlainObject(values) &&
      ('grid_mode' in values || 'grid_strength' in values || 'display_scope' in values)
    ) {
      cfg = mergeValues(cfg, values);
      syncHostBackground(cfg);
      cfg = effectiveConfig(cfg);
      saveConfig(cfg);
    } else {
      probeScopeSupport();
      cfg = effectiveConfig(cfg);
    }
    return { page: buildPage(cfg), values: cfg };
  }

  if (method === 'plugin.action') {
    validateSurface(params);
    const t = text();
    const actionId = String(params.action_id || '').trim();
    if (actionId === 'reset_default') {
      let cfg = { ...DEFAULT_CONFIG };
      syncHostBackground(cfg);
      cfg = effectiveConfig(cfg);
      saveConfig(cfg);
      const status = t.reset_done;
      return {
        ok: true,
        tone: 'success',
        status,
        values: cfg,
        page: buildPage(cfg, status),
      };
    }

    const cfg = effectiveConfig(loadConfig());
    const status = t.unknown_action.replace('{action}', actionId);
    return {
      ok: false,
      tone: 'warning',
      status,
      values: cfg,
      page: buildPage(cfg),
    };
  }

  if (method === 'plugin.event') {
    const eventName = String(params.event || '');
    if (eventName === 'locale.changed' && params.locale) {
      const rawLocale = String(params.locale).trim().toLowerCase();
      locale = rawLocale.startsWith('en') ? 'en' : 'zh';
      return { handled: true };
    }
    return { handled: false };
  }

  if (method === 'plugin.shutdown') {
    return { ok: true };
  }

  throw new Error(text().unsupported_method.replace('{method}', String(method || '')));
}

serve((method, params) => {
  try {
    return handle(method, params);
  } catch (err) {
    const localized = new Error(localizeError(err && err.message ? err.message : err));
    if (err && typeof err.code === 'number') {
      localized.code = err.code;
    }
    throw localized;
  }
});
