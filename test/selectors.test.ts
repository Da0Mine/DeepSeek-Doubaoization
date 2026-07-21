/**
 * deepseek-selectors 单元测试。
 * 该模块维护所有 DOM 候选选择器（脆弱点唯一收口），本身是纯数据导出，无需 electron。
 * 重点验证：每个操作的候选都是「非空数组」，且元素均为非空字符串（至少有 1 个候选）。
 */
import {
  TEXT_INPUT_SELECTORS,
  SEND_BUTTON_SELECTORS,
  FILE_INPUT_SELECTORS,
  UPLOAD_BUTTON_SELECTORS,
  SEND_BUTTON_ENABLED_HINT,
  DEEP_THINK_SELECTORS,
  VISION_TOGGLE_SELECTORS,
  MODEL_SWITCH_SELECTORS,
  ASSISTANT_MESSAGE_SELECTORS,
  LOGIN_BUTTON_TEXTS,
} from '../src/main/inject/deepseek-selectors';

/** 断言一个候选数组：数组、非空、每项为非空字符串。 */
function expectNonEmptyStringArray(arr: unknown, label: string): void {
  expect(Array.isArray(arr)).toBe(true);
  const list = arr as unknown[];
  expect(list.length).toBeGreaterThanOrEqual(1);
  for (const item of list) {
    expect(typeof item).toBe('string');
    expect((item as string).trim().length).toBeGreaterThan(0);
  }
  // 每个操作的候选不应有重复（去重后数量不变）
  const uniq = new Set(list as string[]);
  expect(uniq.size).toBe(list.length);
}

describe('deepseek-selectors - 输入框', () => {
  test('TEXT_INPUT_SELECTORS 提供非空候选', () => {
    expectNonEmptyStringArray(TEXT_INPUT_SELECTORS, 'TEXT_INPUT_SELECTORS');
    expect(TEXT_INPUT_SELECTORS).toContain('textarea');
  });
});

describe('deepseek-selectors - 发送按钮', () => {
  test('SEND_BUTTON_SELECTORS 提供非空候选', () => {
    expectNonEmptyStringArray(SEND_BUTTON_SELECTORS, 'SEND_BUTTON_SELECTORS');
    expect(SEND_BUTTON_SELECTORS).toContain('button[type="submit"]');
  });
});

describe('deepseek-selectors - 文件输入', () => {
  test('FILE_INPUT_SELECTORS 提供非空候选', () => {
    expectNonEmptyStringArray(FILE_INPUT_SELECTORS, 'FILE_INPUT_SELECTORS');
    expect(FILE_INPUT_SELECTORS).toContain('input[type="file"]');
  });
});

describe('deepseek-selectors - 深度思考开关', () => {
  test('DEEP_THINK_SELECTORS 提供非空候选', () => {
    expectNonEmptyStringArray(DEEP_THINK_SELECTORS, 'DEEP_THINK_SELECTORS');
  });
});

describe('deepseek-selectors - 视觉/图片模型切换', () => {
  test('VISION_TOGGLE_SELECTORS 提供非空候选', () => {
    expectNonEmptyStringArray(VISION_TOGGLE_SELECTORS, 'VISION_TOGGLE_SELECTORS');
    expect(VISION_TOGGLE_SELECTORS.some((s) => s.includes('图片'))).toBe(true);
  });
});

describe('deepseek-selectors - 模型切换', () => {
  test('MODEL_SWITCH_SELECTORS 提供非空候选', () => {
    expectNonEmptyStringArray(MODEL_SWITCH_SELECTORS, 'MODEL_SWITCH_SELECTORS');
  });
});

describe('deepseek-selectors - 最新 AI 回复', () => {
  test('ASSISTANT_MESSAGE_SELECTORS 提供非空候选', () => {
    expectNonEmptyStringArray(ASSISTANT_MESSAGE_SELECTORS, 'ASSISTANT_MESSAGE_SELECTORS');
    expect(ASSISTANT_MESSAGE_SELECTORS.some((s) => s.toLowerCase().includes('assistant'))).toBe(true);
  });
});

describe('deepseek-selectors - 登录态文本', () => {
  test('LOGIN_BUTTON_TEXTS 提供非空候选且含中文「登录」', () => {
    expectNonEmptyStringArray(LOGIN_BUTTON_TEXTS, 'LOGIN_BUTTON_TEXTS');
    expect(LOGIN_BUTTON_TEXTS).toContain('登录');
  });
});

describe('deepseek-selectors - 增量：上传按钮锚点（I-01）', () => {
  test('UPLOAD_BUTTON_SELECTORS 提供非空候选数组，元素非空字符串、无重复', () => {
    expectNonEmptyStringArray(UPLOAD_BUTTON_SELECTORS, 'UPLOAD_BUTTON_SELECTORS');
    expect(UPLOAD_BUTTON_SELECTORS.length).toBeGreaterThanOrEqual(1);
  });

  test('FILE_INPUT_SELECTORS 锚点含 input[type="file"]（与既有同标准）', () => {
    expectNonEmptyStringArray(FILE_INPUT_SELECTORS, 'FILE_INPUT_SELECTORS');
    expect(FILE_INPUT_SELECTORS).toContain('input[type="file"]');
  });
});

describe('deepseek-selectors - 增量：发送按钮可用态判定（I-06）', () => {
  test('SEND_BUTTON_ENABLED_HINT 为非空字符串且说明按 disabled 判定', () => {
    expect(typeof SEND_BUTTON_ENABLED_HINT).toBe('string');
    expect(SEND_BUTTON_ENABLED_HINT.trim().length).toBeGreaterThan(0);
    expect(SEND_BUTTON_ENABLED_HINT.toLowerCase()).toContain('disabled');
  });

  test('SEND_BUTTON_SELECTORS 含提交类候选（与 clickSend 跳过 disabled 逻辑一致）', () => {
    expectNonEmptyStringArray(SEND_BUTTON_SELECTORS, 'SEND_BUTTON_SELECTORS');
    expect(SEND_BUTTON_SELECTORS.some((s) => s.includes('submit') || s.includes('发送'))).toBe(true);
  });
});
