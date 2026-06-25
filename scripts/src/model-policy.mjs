export const MODEL_REGISTRY = {
  'volcano-glm-5.2': {
    aliases: ['volcano', 'volcengine', 'ark', 'huoshan', '火山', '火山引擎', 'glm-5.2'],
    provider: '火山引擎',
    model: 'glm-5.2',
    displayName: '火山引擎 / glm-5.2',
    billing: 'prepaid',
    priority: 95,
    strengths: ['complex_coding', 'reasoning', 'planning', 'architecture', 'less_restricted', 'chinese', 'budget']
  },
  'minimax-m3': {
    aliases: ['minimax', 'minimax-m3', 'MiniMax-M3'],
    provider: '4f5661f7-460f-497d-9f3d-14534925244f',
    model: '4f5661f7-460f-497d-9f3d-14534925244f/MiniMax-M3',
    displayName: 'minimax / MiniMax-M3',
    billing: 'prepaid',
    priority: 100,
    strengths: ['default_worker', 'dirty_work', 'routine', 'batch_scan', 'simple_tests', 'well_scoped_patch', 'largest_quota', 'budget']
  },
  'deepseek-v4-flash': {
    aliases: ['deepseek-flash', 'deepseek-v4-flash'],
    provider: 'deepseek',
    model: 'deepseek-v4-flash',
    displayName: 'deepseek / deepseek-v4-flash',
    billing: 'pay_as_you_go',
    priority: 40,
    strengths: ['fast', 'fallback']
  },
  'deepseek-v4-pro': {
    aliases: ['deepseek-pro', 'deepseek-v4-pro'],
    provider: 'deepseek',
    model: 'deepseek-v4-pro',
    displayName: 'deepseek / deepseek-v4-pro',
    billing: 'pay_as_you_go',
    priority: 35,
    strengths: ['reasoning', 'fallback']
  }
};

const ALIAS_TO_KEY = new Map(
  Object.entries(MODEL_REGISTRY).flatMap(([key, entry]) => [
    [key.toLowerCase(), key],
    ...entry.aliases.map(alias => [alias.toLowerCase(), key])
  ])
);

function words(text = '') {
  return String(text).toLowerCase();
}

export function resolveModelAlias(input) {
  if (!input) return null;
  const normalized = String(input).trim();
  const key = ALIAS_TO_KEY.get(normalized.toLowerCase());
  if (!key) {
    const provider = normalized.includes('/') ? normalized.split('/')[0] : undefined;
    return {
      key: normalized,
      requested: normalized,
      provider,
      model: normalized,
      displayName: normalized,
      billing: 'unknown',
      source: 'custom'
    };
  }

  const entry = MODEL_REGISTRY[key];
  return {
    key,
    requested: normalized,
    provider: entry.provider,
    model: entry.model,
    displayName: entry.displayName,
    billing: entry.billing,
    source: 'registry'
  };
}

export function chooseModel({ requested, taskProfile, content = '' } = {}) {
  const explicit = resolveModelAlias(requested);
  if (explicit) {
    return {
      ...explicit,
      policyReason: 'Explicit model request.'
    };
  }

  const profile = words(taskProfile);
  const body = words(content);
  const combined = `${profile}\n${body}`;

  if (/(architecture|architect|design|complex|hard|reason|deep|ambiguous|multi[- ]?step|cross[- ]?module|security|algorithm|performance|concurrency|migration|系统设计|架构|复杂|困难|推理|多步|跨模块|安全|算法|性能|并发|迁移|聪明|限制少)/i.test(combined)) {
    return {
      ...resolveModelAlias('volcano-glm-5.2'),
      policyReason: 'Complex, reasoning-heavy, cross-module, or less-restricted task; use stronger prepaid Volcano glm-5.2.'
    };
  }

  return {
    ...resolveModelAlias('minimax-m3'),
    policyReason: 'Default worker model and largest quota; use MiniMax-M3 for routine or dirty work with a precise prompt.'
  };
}

export function fallbackModelKeys(selectedKey) {
  if (selectedKey === 'volcano-glm-5.2') {
    return ['volcano-glm-5.2', 'minimax-m3', 'deepseek-v4-flash', 'deepseek-v4-pro'];
  }
  if (selectedKey === 'minimax-m3') {
    return ['minimax-m3', 'volcano-glm-5.2', 'deepseek-v4-flash', 'deepseek-v4-pro'];
  }
  if (selectedKey === 'deepseek-v4-pro') {
    return ['deepseek-v4-pro', 'deepseek-v4-flash'];
  }
  if (selectedKey === 'deepseek-v4-flash') {
    return ['deepseek-v4-flash', 'deepseek-v4-pro'];
  }
  return [selectedKey].filter(Boolean);
}

function paidFallbackAllowed() {
  const value = String(process.env.ZCODE_ALLOW_PAID_FALLBACK || '').trim().toLowerCase();
  return value === '1' || value === 'true' || value === 'yes';
}

export function candidateModelsForSelection(selection, { allowPaidFallback = paidFallbackAllowed() } = {}) {
  const keys = fallbackModelKeys(selection?.key);
  let candidates = keys
    .map(key => resolveModelAlias(key))
    .filter(Boolean);

  if (!candidates.some(candidate => candidate.key === selection?.key)) {
    candidates.unshift(selection);
  }

  if (!allowPaidFallback && selection?.billing !== 'pay_as_you_go') {
    candidates = candidates.filter(candidate => candidate.billing !== 'pay_as_you_go');
  }

  return candidates.map((candidate, index) => ({
    ...candidate,
    fallbackRank: index,
    isPrimary: index === 0
  }));
}

export function modelSelectionFromArgs(args = {}, { content = '' } = {}) {
  const requested = args.model || process.env.ZCODE_PREFERRED_MODEL || '';
  return chooseModel({
    requested,
    taskProfile: args.profile || args['task-profile'] || process.env.ZCODE_TASK_PROFILE || '',
    content
  });
}
