/**
 * 提示词模板与占位符渲染。
 * 模板文本来自 ConfigStore（即 PRD 的 26 项配置中的 *_PromptTemplate）。
 * 占位符约定：{content}、{targetLang}，由 render() 渲染。
 */
import type { ConfigStore } from '../config/ConfigStore';

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

  /** 识图提示词（v3 视觉模型）。 */
  public visionPrompt(): string {
    return this.render(this.config.get('visionPromptTemplate'), {});
  }

  /** 提取文字提示词。 */
  public extractTextPrompt(): string {
    return this.render(this.config.get('extractTextPromptTemplate'), {});
  }

  /**
   * 翻译提示词（仅填充 {targetLang}，{content} 留待实际文本注入）。
   * @param lang 目标语言
   */
  public translatePrompt(lang: string): string {
    return this.render(this.config.get('translatePromptTemplate'), { targetLang: lang });
  }

  /**
   * 解释提示词（仅保留 {content} 占位）。
   */
  public explainPrompt(): string {
    return this.render(this.config.get('explainPromptTemplate'), {});
  }
}
