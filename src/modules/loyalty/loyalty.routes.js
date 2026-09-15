import { Router } from 'express';
import { requireAuth } from '../../middlewares/auth.js';
import { asyncHandler, ok } from '../../utils/http.js';
import { getSummary } from '../../services/loyalty.service.js';

const router = Router();

/**
 * LOYALTY — chương trình thành viên (phía khách).
 * GET /api/loyalty/me : hạng thẻ, điểm, tiến trình lên hạng, lịch sử gần nhất.
 */
router.get('/me', requireAuth, asyncHandler(async (req, res) => {
  ok(res, getSummary(req.user.id));
}));

export default router;
