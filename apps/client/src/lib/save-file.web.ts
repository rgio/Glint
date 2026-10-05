/** Downloads text as a file. */
export async function saveTextFile(content: string, filename: string, { mimeType }: { mimeType: string; uti: string; dialogTitle: string }): Promise<void> {
  const url = URL.createObjectURL(new Blob([content], { type: mimeType }));
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  // Give the browser a moment to start the download before releasing the URL.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
