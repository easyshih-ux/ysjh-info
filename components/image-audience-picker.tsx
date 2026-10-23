"use client";

import { USER_IDENTITIES, type UserIdentity } from "@/lib/announcements";
import { hasInvalidImageAudienceSelection, shouldShowImageAudiencePicker } from "@/lib/imageAudiences";
import styles from "./image-audience-picker.module.css";

/** 圖片適用身分勾選：未勾選＝共用；只列出公告接收對象，既有但已不在對象內的勾選會保留並標示，須由行政人員取消。 */
export function ImageAudiencePicker({
  imageId,
  allowed,
  selected,
  onChange,
}: {
  imageId: string;
  allowed: readonly UserIdentity[];
  selected: UserIdentity[] | "invalid" | undefined;
  onChange: (next: UserIdentity[]) => void;
}) {
  if (!shouldShowImageAudiencePicker(allowed, selected)) return null;
  const current = selected === "invalid" ? [] : selected ?? [];
  const options = USER_IDENTITIES.filter(identity => allowed.includes(identity) || current.includes(identity));
  const invalid = hasInvalidImageAudienceSelection(allowed, selected);
  const toggle = (identity: UserIdentity, checked: boolean) => onChange(checked ? USER_IDENTITIES.filter(value => value === identity || current.includes(value)) : current.filter(value => value !== identity));
  return <fieldset className={`${styles.picker} ${invalid ? styles.invalid : ""}`}>
    <legend>適用身分<small>未勾選＝共用</small></legend>
    <div className={styles.options}>{options.map(identity => <label key={identity} className={allowed.includes(identity) ? "" : styles.outside}><input type="checkbox" name={`image-audience-${imageId}`} checked={current.includes(identity)} onChange={event => toggle(identity, event.target.checked)} />{identity}{!allowed.includes(identity) && <em>不在公告對象中</em>}</label>)}</div>
    {invalid && <p role="alert">{selected === "invalid" ? "⚠ 身分設定異常，請重新勾選，或" : "⚠ 已勾選不在公告對象中的身分，請取消，或"}<button type="button" onClick={() => onChange([])}>改為共用</button></p>}
  </fieldset>;
}
