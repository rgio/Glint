import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';

/** Writes text to a temporary file and opens the share sheet, so the listener can save or send it. */
export async function saveTextFile(
  content: string,
  filename: string,
  { mimeType, uti, dialogTitle }: { mimeType: string; uti: string; dialogTitle: string },
): Promise<void> {
  const file = new File(Paths.cache, filename);
  file.write(content);
  await Sharing.shareAsync(file.uri, { mimeType, UTI: uti, dialogTitle });
}
