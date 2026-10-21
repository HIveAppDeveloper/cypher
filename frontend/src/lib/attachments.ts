import type { Attachment } from './types';

export function readAttachment(file: File, mime: string, timeoutMs = 15000): Promise<Attachment> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    const fail = (message: string) => { clearTimeout(timer); reject(new Error(`${file.name}: ${message}`)); };
    const timer = setTimeout(() => { fail('File reading timed out. Select the file again.'); reader.abort(); }, timeoutMs);
    reader.onerror = () => fail('File could not be read. Select it again.');
    reader.onabort = () => fail('File reading was interrupted. Select it again.');
    reader.onload = () => {
      clearTimeout(timer);
      const data = typeof reader.result === 'string' ? reader.result.split(',')[1] : '';
      if (!data) { reject(new Error(`${file.name}: The file is empty or unreadable.`)); return; }
      resolve({ name: file.name, mime, data });
    };
    try { reader.readAsDataURL(file); } catch { fail('File could not be opened. Select it again.'); }
  });
}
