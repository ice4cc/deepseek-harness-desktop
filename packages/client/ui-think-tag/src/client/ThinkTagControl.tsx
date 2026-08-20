/**
 * ThinkTagControl: the composer tool-row seat (`conversation.input.right`
 * list entry). Renders the think-effort trigger (the standard Think icon,
 * highlighted while a tag rides the draft) and a small dropdown over the
 * four inline levels plus "session default". Choosing a level rewrites the
 * draft's trailing `<|think_*|>` tag through the public setDraft action —
 * the tag is visible in the textarea (model-visible ⟺ logged) and ships
 * with the message; the template strips it at render time.
 */
import { useEffect, useId, useRef, useState } from 'react'
import clsx from 'clsx'
import { IconCheckOutline14, IconChevronDownOutline14, IconThinkOutline16 } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
// Type-only: pulls the ui-conversation SlotMap merge (the input.right seat).
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import { setThinkLevel, thinkLevelOf, THINK_LEVELS, type ThinkLevel } from './core.ts'
import css from './ThinkTagControl.module.css'

/** Full think-tag control props: runtime share (owner InputZone + standard kit) & locale seat. */
export type ThinkTagControlProps = PropsRuntime<'conversation.input.right'> & PropsLocale<'thinkTag'>

/**
 * Render the composer think-tag control.
 * @param props - owner share (session/input snapshots) + standard kit
 * (useInput + inputActions) + the standard locale seat.
 * @returns the trigger and, while open, the level dropdown.
 */
export function ThinkTagControl({ useInput, input, inputActions, t }: ThinkTagControlProps) {
  const live = useInput(state => thinkLevelOf(state.draft))
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement | null>(null)
  const id = useId()

  useEffect(() => {
    if (!open) return
    const onDown = (event: MouseEvent): void => {
      if (rootRef.current !== null && !rootRef.current.contains(event.target as Node)) setOpen(false)
    }
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const pick = (level: ThinkLevel | null): void => {
    if (inputActions !== undefined) {
      // The owner snapshot is fresh: the skeleton re-renders on every input
      // store change, so event-handler reads of it are point-in-time current.
      const next = setThinkLevel(input.draft, level)
      if (next !== input.draft) inputActions.setDraft(next)
    }
    setOpen(false)
  }

  return (
    <div className={css.root} ref={rootRef}>
      <button
        type="button"
        className={clsx(css.trigger, live !== null && css.active)}
        aria-label={t('control.aria')}
        title={t('control.title')}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        onClick={() => setOpen(v => !v)}
      >
        <IconThinkOutline16 />
        <span className={css.level}>{live === null ? t('option.default') : t(`option.${live}`)}</span>
        <IconChevronDownOutline14 />
      </button>
      {open && (
        <div className={css.menu} role="menu" aria-label={t('menu.aria')} id={id}>
          <button
            type="button"
            role="menuitemradio"
            aria-checked={live === null}
            className={css.item}
            onClick={() => { pick(null) }}
          >
            <span className={css.itemText}>
              <span className={css.label}>{t('option.default')}</span>
              <span className={css.desc}>{t('option.default.desc')}</span>
            </span>
            {live === null && <IconCheckOutline14 />}
          </button>
          {THINK_LEVELS.map(level => (
            <button
              key={level}
              type="button"
              role="menuitemradio"
              aria-checked={live === level}
              className={css.item}
              onClick={() => { pick(level) }}
            >
              <span className={css.itemText}>
                <span className={css.label}>{t(`option.${level}`)}</span>
                <span className={css.desc}>{t(`option.${level}.desc`)}</span>
              </span>
              {live === level && <IconCheckOutline14 />}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
