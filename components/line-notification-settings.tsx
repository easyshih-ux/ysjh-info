"use client";

import { LINE_NOTIFICATION_LEVELS, LINE_NOTIFICATION_LEVEL_DESCRIPTIONS, LINE_NOTIFICATION_LEVEL_LABELS, MAX_AUDIENCE_NOTE_LENGTH, needsSchoolwideAudienceReminder, resolveLineNotificationLevel, type Audience, type LineNotificationLevel } from "@/lib/announcements";
import { Input } from "@/components/ui/input";
import styles from "./line-notification-settings.module.css";

export function LineNotificationSettings({
  idPrefix,
  level,
  audienceNote,
  audiences,
  audienceNoteError,
  onLevelChange,
  onAudienceNoteChange,
}: {
  idPrefix: string;
  level: LineNotificationLevel | undefined;
  audienceNote: string | undefined;
  audiences: readonly Audience[];
  audienceNoteError?: string;
  onLevelChange: (level: LineNotificationLevel) => void;
  onAudienceNoteChange: (value: string) => void;
}) {
  const selected = resolveLineNotificationLevel(level);
  const showSchoolwideReminder = needsSchoolwideAudienceReminder(selected, audiences);
  return <section className={styles.settings} aria-labelledby={`${idPrefix}-line-settings-title`}>
    <div className={styles.heading}><h3 id={`${idPrefix}-line-settings-title`}>LINE 通知設定</h3><p>不改變公告接收對象。全校必讀、重要必讀於首頁提醒 7 天。</p></div>
    <fieldset className={styles.levels}>
      <legend>通知等級</legend>
      <div className={styles.levelGrid}>{LINE_NOTIFICATION_LEVELS.map(value => <label key={value} className={`${styles.level} ${styles[value]} ${selected === value ? styles.selected : ""}`}><input type="radio" name={`${idPrefix}-line-level`} value={value} checked={selected === value} onChange={() => onLevelChange(value)} /><span><strong>{LINE_NOTIFICATION_LEVEL_LABELS[value]}</strong><small>{LINE_NOTIFICATION_LEVEL_DESCRIPTIONS[value]}</small></span></label>)}</div>
      {showSchoolwideReminder && <p className={styles.reminder} role="status">⚠️ 已選擇「全校必讀」，但接收對象不是「全校教師」。仍可發布；若需要全校同仁都看到，請將適用對象改為「全校教師」。</p>}
    </fieldset>
    <label className={styles.note}><span>實際辦理對象（選填）</span><Input name="audienceNote" maxLength={MAX_AUDIENCE_NOTE_LENGTH} value={audienceNote ?? ""} onChange={event => onAudienceNoteChange(event.target.value)} placeholder="例如：尚未完成雙因子驗證設定的同仁" aria-invalid={!!audienceNoteError} />{audienceNoteError ? <small className={styles.error}>{audienceNoteError}</small> : <small>LINE 會優先顯示這裡的文字；未填寫時顯示上方適用對象。</small>}</label>
  </section>;
}
