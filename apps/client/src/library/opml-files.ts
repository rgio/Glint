import * as DocumentPicker from 'expo-document-picker';
import { File } from 'expo-file-system';

import { saveTextFile } from '@/lib/save-file';

/** Lets the listener pick an OPML file; resolves to its text, or null if they cancel. */
export async function pickOpmlText(): Promise<string | null> {
  const result = await DocumentPicker.getDocumentAsync({ type: '*/*', copyToCacheDirectory: true });
  if (result.canceled || !result.assets[0]) return null;
  return new File(result.assets[0].uri).text();
}

/** Saves the OPML: the share sheet on phones, a download on the web. */
export function saveOpml(xml: string, filename: string): Promise<void> {
  return saveTextFile(xml, filename, { mimeType: 'text/x-opml', uti: 'public.xml', dialogTitle: 'Export subscriptions' });
}
