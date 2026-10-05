import * as DocumentPicker from 'expo-document-picker';

/** Lets the listener pick an OPML file; resolves to its text, or null if they cancel. */
export async function pickOpmlText(): Promise<string | null> {
  const result = await DocumentPicker.getDocumentAsync({ type: ['.opml', '.xml', 'text/xml', 'text/x-opml'] });
  const file = result.canceled ? null : result.assets[0]?.file;
  return file ? file.text() : null;
}

/** Downloads the OPML as a file. */
export async function saveOpml(xml: string, filename: string): Promise<void> {
  const url = URL.createObjectURL(new Blob([xml], { type: 'text/x-opml' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  // Give the browser a moment to start the download before releasing the URL.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
