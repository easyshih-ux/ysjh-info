import styles from "./important-date-reminder.module.css";

/** 非阻擋式提醒：只提示補填重要日期，不影響發布或儲存。 */
export function ImportantDateReminder({ show }: { show: boolean }) {
  if (!show) return null;
  return <aside className={styles.reminder} role="status"><strong className={styles.title}>📅 是否需要填寫重要日期？</strong><span>此公告提及活動或會議，尚未填寫<b>「重要日期／活動」</b>。填寫後才會顯示於首頁<b>「本週／下週重要事項」</b>。</span></aside>;
}
