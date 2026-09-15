import { Errors } from '../utils/errors.js';

/**
 * Validate request bằng zod. Tách schema khỏi controller => controller sạch,
 * và MỌI input đều đi qua cùng một cửa (không ai quên validate).
 *
 * Mặc định strip unknown keys => chống mass-assignment
 * (client gửi thêm { role: 'admin' } sẽ bị loại bỏ).
 */
export const validate =
  (schema, source = 'body') =>
  (req, _res, next) => {
    const result = schema.safeParse(req[source] ?? {});
    if (!result.success) {
      const details = result.error.issues.map((i) => ({
        field: i.path.join('.') || source,
        message: i.message,
        code: i.code,
      }));
      return next(Errors.validation('Dữ liệu không hợp lệ', details));
    }
    req[source] = result.data;
    req.validated = { ...(req.validated || {}), [source]: result.data };
    next();
  };

export const validateAll = (schemas) => [
  schemas.params && validate(schemas.params, 'params'),
  schemas.query && validate(schemas.query, 'query'),
  schemas.body && validate(schemas.body, 'body'),
].filter(Boolean);
