/**
 * GET /api/diag-esm  - diagnostic endpoint (TypeScript / ESM, fully self-contained).
 * Reports how the serverless runtime loads the function bundle.
 */
export default async function handler(req: any, res: any) {
  try {
    const fs = await import('fs');
    const g: any = globalThis as any;
    res.status(200).json({
      format: 'esm-ts',
      node: process.version,
      hasModule: typeof g.module,
      hasExports: typeof g.exports,
      cwd: process.cwd(),
      files: fs.readdirSync(process.cwd()).slice(0, 50),
      env: {
        hasKeyId: !!process.env.RAZORPAY_KEY_ID,
        hasSecret: !!process.env.RAZORPAY_KEY_SECRET,
        hasViteKeyId: !!process.env.VITE_RAZORPAY_KEY_ID,
      },
    });
  } catch (err: any) {
    res.status(500).json({ error: err?.message || 'diag failed' });
  }
}
