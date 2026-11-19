/**
 * GET /api/diag  - diagnostic endpoint (CommonJS).
 * Reports how the serverless runtime loads the function bundle.
 */
const fs = require('fs');

module.exports = async function handler(req, res) {
  try {
    res.status(200).json({
      format: 'cjs-js',
      node: process.version,
      hasModule: typeof module,
      hasExports: typeof exports,
      cwd: process.cwd(),
      files: fs.readdirSync(process.cwd()).slice(0, 50),
      env: {
        hasKeyId: !!process.env.RAZORPAY_KEY_ID,
        hasSecret: !!process.env.RAZORPAY_KEY_SECRET,
        hasViteKeyId: !!process.env.VITE_RAZORPAY_KEY_ID,
      },
    });
  } catch (err) {
    res.status(500).json({ error: (err && err.message) || 'diag failed' });
  }
};
