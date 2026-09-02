/**
 * 提示词模板与占位符渲染。
 * 模板文本来自 ConfigStore（即 PRD 的 26 项配置中的 *_PromptTemplate）。
 * 占位符约定：{content}、{targetLang}，由 render() 渲染。
 */
import type { ConfigStore } from '../config/ConfigStore';

/**
 * 截图功能按钮（screenshotButtons）的固定标签与旧提示词模板键的对应关系。
 * promptTemplates.ts 的截图提示词方法统一从 screenshotButtons 读取对应按钮的 prompt。
 */
export class PromptTemplates {
  constructor(private readonly config: ConfigStore) {}

  /**
   * 渲染模板：将 {key} 替换为 vars[key]，未提供的占位符原样保留。
   * @param tpl 模板字符串
   * @param vars 变量表
   */
  public render(tpl: string, vars: Record<string, string>): string {
    return tpl.replace(/\{(\w+)\}/g, (match: string, key: string): string => {
      return Object.prototype.hasOwnProperty.call(vars, key) ? (vars[key] ?? match) : match;
    });
  }

  /** 读取截图按钮（screenshotButtons）中指定标签的 prompt，找不到时返回空串。 */
  public screenshotButtonPrompt(label: string): string {
    try {
      const btns = JSON.parse(this.config.get('screenshotButtons') || '[]') as { label?: string; prompt?: string }[];
      const b = btns.find((x) => x.label === label);
      return b && typeof b.prompt === 'string' ? b.prompt : '';
    } catch {
      return '';
    }
  }

  /** 识图提示词（v3 视觉模型）。 */
  public visionPrompt(): string {
    return this.render(this.config.get('visionPromptTemplate'), {});
  }

  /** 提取文字提示词（来自截图按钮「提取文字」）。 */
  public extractTextPrompt(): string {
    return this.render(this.screenshotButtonPrompt('提取文字'), {});
  }

  /**
   * 翻译提示词（来自截图按钮「翻译」，仅填充 {targetLang}，{content} 留待实际文本注入）。
   * @param lang 目标语言
   */
  public translatePrompt(lang: string): string {
    return this.render(this.screenshotButtonPrompt('翻译'), { targetLang: lang });
  }

  /**
   * 解释提示词（来自截图按钮「解释」，仅保留 {content} 占位）。
   */
  public explainPrompt(): string {
    return this.render(this.screenshotButtonPrompt('解释'), {});
  }
}
