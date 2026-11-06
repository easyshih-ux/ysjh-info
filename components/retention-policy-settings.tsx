"use client";

import { RETENTION_POLICIES, RETENTION_POLICY_DESCRIPTIONS, RETENTION_POLICY_LABELS, isRetentionPolicy, type RetentionPolicy } from "@/lib/announcementRetention";
import styles from "./retention-policy-settings.module.css";

/**
 * 公告保存方式選擇。value 為 undefined 代表舊公告尚未審查：不預選任何選項，
 * 使用者未明確選擇時，儲存其他修改不會寫入保存方式。
 */
export function RetentionPolicySettings({
  idPrefix,
  value,
  error,
  onChange,
}: {
  idPrefix: string;
  value: RetentionPolicy | undefined;
  error?: string;
  onChange: (value: RetentionPolicy) => void;
}) {
  const selected = isRetentionPolicy(value) ? value : undefined;
  return <section className={styles.settings} aria-labelledby={`${idPrefix}-retention-title`} data-validation-field="retentionPolicy">
    <div className={styles.heading}><h3 id={`${idPrefix}-retention-title`}>公告保存方式</h3><p className={styles.notEnabled} role="note">ⓘ 目前只記錄保存方式，自動清理功能尚未啟用，不會刪除任何公告。</p><p>下架、復原與管理員手動刪除不受影響。</p></div>
    {!selected && <p className={styles.unreviewed} role="status">此為舊公告，尚未設定保存方式（待管理員審查），不會被自動清理。若不選擇，儲存其他修改不會變更保存方式。</p>}
    <fieldset className={styles.options}>
      <legend className={styles.srOnly}>保存方式</legend>
      <div className={styles.grid}>{RETENTION_POLICIES.map(policy => <label key={policy} className={`${styles.option} ${selected === policy ? styles.selected : ""}`}><input type="radio" name={`${idPrefix}-retention-policy`} value={policy} checked={selected === policy} onChange={() => onChange(policy)} /><span><strong>{RETENTION_POLICY_LABELS[policy]}{policy === "autoCleanup" ? "（新公告預設）" : ""}</strong><small>{RETENTION_POLICY_DESCRIPTIONS[policy]}</small></span></label>)}</div>
    </fieldset>
    {error && <small className={styles.error}>{error}</small>}
  </section>;
}
