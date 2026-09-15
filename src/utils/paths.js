import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * ============================================================================
 *  ĐƯỜNG DẪN CROSS-PLATFORM (Windows-safe)
 * ============================================================================
 *  VÌ SAO KHÔNG DÙNG `.pathname` của URL object cho đường dẫn file:
 *   - Trên Windows pathname trả về `/C:/foo/bar` (thừa `/` đầu) → Node ghép
 *     thành `C:\C:\foo\bar` → ENOENT khi mkdir.
 *   - Khoảng trắng bị percent-encode (`protect code` → `protect%20code`).
 *  `fileURLToPath()` xử lý đúng cả hai (drive letter + giải mã %20).
 * ============================================================================
 */

/** Thư mục chứa file đang gọi: dirOf(import.meta.url) */
export const dirOf = (metaUrl) => path.dirname(fileURLToPath(metaUrl));

/** Đường dẫn tuyệt đối tính từ thư mục của file đang gọi: fromHere(import.meta.url, '..', 'data') */
export const fromHere = (metaUrl, ...segments) => path.resolve(dirOf(metaUrl), ...segments);
