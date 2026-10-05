import * as DocumentPicker from 'expo-document-picker';

import { saveTextFile } from '@/lib/save-file';

/** Lets the listener pick an OPML file; resolves to its text, or null if they cancel. */
export async function pickOpmlText(): Promise<string | null> {
  const result = await DocumentPicker.getDocumentAsync({ type: ['.opml', '.xml', 'text/xml', 'text/x-opml'] });
  const file = result.canceled ? null : result.assets[0]?.file;
  return file ? file.text() : null;
}

/** Saves the OPML: the share sheet on phones, a download on the web. */
export function saveOpml(xml: string, filename: string): Promise<void> {
  return saveTextFile(xml, filename, { mimeType: 'text/x-opml', uti: 'public.xml', dialogTitle: 'Export subscriptions' });
}
