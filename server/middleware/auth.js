/**
 * Authentication middleware
 * Protects all routes except /login, /api/auth/*, and /api/webhook/vapi
 */

export function requireAuth(req, res, next) {
  if (req.session?.authenticated) return next();
  // API requests → 401 JSON (so frontend can handle gracefully)
  if (req.path.startsWith('/api/')) return res.status(401).json({ error: 'Unauthorized' });
  // Page requests → redirect to login
  res.redirect('/login');
}
