/** `docPanel` namespace dictionaries: panel controls, tabs, and empty/error states. */

/** Simplified Chinese dictionary (the key-set source of truth). */
export const zh = {
  'panel.title': '文档',
  'panel.expand': '打开文档面板',
  'panel.collapse': '收起文档面板',
  'follow.toggle': '跟随',
  'tab.changes': '变更',
  'changes.empty': '本会话还没有文件变更',
  'file.loading': '读取中…',
  'file.error': '无法读取该文件',
  'file.close': '关闭页签',
  'follow.on': '自动跟随文件变更',
  'follow.off': '关闭自动跟随',
  'view.markdown': '渲染',
  'view.source': '源码',
  'conflict.changed': '该文件已在磁盘上被修改',
  'conflict.reload': '重新加载',
  'conflict.overwrite': '覆盖',
  'conflict.cancel': '取消',
  'save.error': '保存失败',
  'tab.discard.title': '未保存的更改',
  'tab.discard.body': '关闭该页签将丢弃尚未保存的更改。',
  'tab.discard.confirm': '丢弃并关闭',
} satisfies Record<string, string>

/** The docPanel namespace key union. */
export type DocPanelKey = keyof typeof zh

/** English dictionary, checked complete against the zh key set. */
export const en = {
  'panel.title': 'Documents',
  'panel.expand': 'Open document panel',
  'panel.collapse': 'Collapse document panel',
  'follow.toggle': 'Follow',
  'tab.changes': 'Changes',
  'changes.empty': 'No file changes in this session yet',
  'file.loading': 'Reading…',
  'file.error': 'Could not read this file',
  'file.close': 'Close tab',
  'follow.on': 'Follow file changes automatically',
  'follow.off': 'Stop following file changes',
  'view.markdown': 'Rendered',
  'view.source': 'Source',
  'conflict.changed': 'This file was modified on disk',
  'conflict.reload': 'Reload',
  'conflict.overwrite': 'Overwrite',
  'conflict.cancel': 'Cancel',
  'save.error': 'Save failed',
  'tab.discard.title': 'Unsaved changes',
  'tab.discard.body': 'Closing this tab discards changes that have not been saved.',
  'tab.discard.confirm': 'Discard and close',
} satisfies Record<DocPanelKey, string>
