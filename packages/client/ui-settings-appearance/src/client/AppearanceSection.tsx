/** Appearance settings section: the chat content width level as one row. */

import clsx from 'clsx'
import type { SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
// Type-only: pulls the settings shell's SlotMap merge (the 'settings.section' entry).
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import { CONTENT_WIDTH_LEVELS, type ContentWidthLevel } from '../appearance-settings.ts'
import { levelKey } from './locales.ts'
import css from './AppearanceSection.module.css'

/** Registration-side business face for the appearance section. */
export interface AppearanceSectionInjected {
  hooks: {
    /** Persisted width level bound as useContentWidth. */
    contentWidth: SnapshotStore<ContentWidthLevel>
  }
  /** Change the persisted chat content width level. */
  setWidth: (level: ContentWidthLevel) => void
}

/** Full component props. */
export type AppearanceSectionProps =
  PropsRuntime<'settings.section'>
  & PropsLocale<'settings.appearance'>
  & InjectFace<AppearanceSectionInjected>

/**
 * Render the appearance section content column.
 * @param props - composed settings slot props (owner share, standard kit, locale seat, inject face).
 * @returns the width preference row.
 */
export function AppearanceSection({ useContentWidth, setWidth, t }: AppearanceSectionProps) {
  const level = useContentWidth(value => value)

  return (
    <div className={css.section}>
      <div className={css.row}>
        <div className={css.rowText}>
          <div className={css.title}>{t('title')}</div>
          <div className={css.desc}>{t('description')}</div>
        </div>
        <div className={css.segmented} role="group" aria-label={t('title')}>
          {CONTENT_WIDTH_LEVELS.map(option => (
            <button
              key={option}
              type="button"
              className={clsx(css.option, level === option && css.active)}
              aria-pressed={level === option}
              onClick={() => { setWidth(option) }}
            >
              {t(levelKey(option))}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
