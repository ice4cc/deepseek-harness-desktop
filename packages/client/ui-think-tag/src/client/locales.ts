/** Locale dictionaries for the think-tag composer control. */

/** The thinkTag locale namespace's key type. */
export type ThinkTagKey =
  | 'control.aria'
  | 'control.title'
  | 'menu.aria'
  | 'option.default'
  | 'option.off'
  | 'option.low'
  | 'option.medium'
  | 'option.xhigh'
  | 'option.default.desc'
  | 'option.off.desc'
  | 'option.low.desc'
  | 'option.medium.desc'
  | 'option.xhigh.desc'

/** Chinese dictionary. */
export const zh: Record<ThinkTagKey, string> = {
  'control.aria': '思考强度选择',
  'control.title': '选择这条消息的思考强度',
  'menu.aria': '思考强度选项',
  'option.default': '跟随会话设置',
  'option.off': '关闭思考',
  'option.low': '简洁思考',
  'option.medium': '标准思考',
  'option.xhigh': '深度思考',
  'option.default.desc': '使用会话默认的思考强度',
  'option.off.desc': '直接回答，不进行推理',
  'option.low.desc': '简要推理，快速给出结论',
  'option.medium.desc': '标准推理深度',
  'option.xhigh.desc': '深度推理，验证假设并考虑替代方案',
}

/** English dictionary. */
export const en: Record<ThinkTagKey, string> = {
  'control.aria': 'Thinking effort selector',
  'control.title': 'Choose the thinking effort for this message',
  'menu.aria': 'Thinking effort options',
  'option.default': 'Session default',
  'option.off': 'No thinking',
  'option.low': 'Brief thinking',
  'option.medium': 'Standard thinking',
  'option.xhigh': 'Deep thinking',
  'option.default.desc': 'Use the session default effort',
  'option.off.desc': 'Answer directly without reasoning',
  'option.low.desc': 'Concise reasoning, straight to the point',
  'option.medium.desc': 'Standard reasoning depth',
  'option.xhigh.desc': 'Deep reasoning with hypothesis validation',
}
