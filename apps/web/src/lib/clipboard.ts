/*
 * The guarded clipboard write: true when the text landed. The clipboard
 * may be absent (insecure contexts, old browsers) or refuse — both answer
 * false instead of throwing, so the caller's toast names a copy that
 * actually happened.
 */
export async function writeClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    return false
  }
}
