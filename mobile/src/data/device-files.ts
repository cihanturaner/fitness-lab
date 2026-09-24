import { getDocumentAsync } from 'expo-document-picker';
import { File, Paths } from 'expo-file-system';
import { isAvailableAsync, shareAsync } from 'expo-sharing';

/**
 * The only place the app touches files outside its database: picking an export to import
 * and handing an export to the system share sheet (Files, AirDrop, …). No network.
 */

export type PickedFile = { name: string; text: string };

/** Lets the lifter choose a JSON export; null when they cancel. */
export async function pickExportFile(): Promise<PickedFile | null> {
  const result = await getDocumentAsync({ type: ['application/json', 'public.json', '*/*'], copyToCacheDirectory: true, multiple: false });
  if (result.canceled || !result.assets?.length) return null;
  const asset = result.assets[0];
  // The browser preview hands over a web File; the device gives a file URI in the cache.
  const text = asset.file ? await asset.file.text() : await new File(asset.uri).text();
  return { name: asset.name, text };
}

/** Writes the export to the cache and opens the share sheet. */
export async function shareExportFile(name: string, text: string): Promise<'shared' | 'unavailable'> {
  if (!(await isAvailableAsync())) return 'unavailable';
  const file = new File(Paths.cache, name);
  if (file.exists) file.delete();
  file.create();
  file.write(text);
  await shareAsync(file.uri, { mimeType: 'application/json', UTI: 'public.json', dialogTitle: 'Save Fitness Lab export' });
  return 'shared';
}
