import * as DocumentPicker from 'expo-document-picker';
import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';

/** Lets the listener pick an OPML file; resolves to its text, or null if they cancel. */
export async function pickOpmlText(): Promise<string | null> {
  const result = await DocumentPicker.getDocumentAsync({ type: '*/*', copyToCacheDirectory: true });
  if (result.canceled || !result.assets[0]) return null;
  return new File(result.assets[0].uri).text();
}

/** Writes the OPML to a temporary file and opens the share sheet so the listener can save or send it. */
export async function saveOpml(xml: string, filename: string): Promise<void> {
  const file = new File(Paths.cache, filename);
  file.write(xml);
  await Sharing.shareAsync(file.uri, { mimeType: 'text/x-opml', UTI: 'public.xml', dialogTitle: 'Export subscriptions' });
}
